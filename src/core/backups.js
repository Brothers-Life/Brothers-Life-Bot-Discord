import { gunzipSync, gzipSync } from 'node:zlib';
import { definePermission } from './permissions.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';
import { zonedParts } from './recurrence.js';

definePermission('backups.view', { label: 'Voir les sauvegardes des serveurs', category: 'Sauvegardes' });
definePermission('backups.manage', { label: 'Faire, supprimer et régler les sauvegardes', category: 'Sauvegardes' });
definePermission('backups.restore', { label: 'Restaurer un serveur depuis une sauvegarde', category: 'Sauvegardes' });

const SNOWFLAKE = /^\d{17,20}$/;
const TIME_ZONE = 'Europe/Paris';
export const DEFAULT_BACKUP_CONFIG = { enabled: true, guildIds: [], hour: 4, keep: 7 };

export function normalizeBackupConfig(input = {}) {
	const hour = Number(input.hour);
	const keep = Number(input.keep);
	return {
		enabled: input.enabled !== false,
		// [] = every active server of the network
		guildIds: [...new Set((Array.isArray(input.guildIds) ? input.guildIds : []).filter(id => SNOWFLAKE.test(id)))].slice(0, 100),
		hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULT_BACKUP_CONFIG.hour,
		keep: Number.isInteger(keep) && keep >= 1 && keep <= 60 ? keep : DEFAULT_BACKUP_CONFIG.keep,
	};
}

// Nightly photos of the servers (structure, panel configuration, members' roles), restored with the template engine
export function createBackups({ db, network, audit, executor, settings, templates, logs, logger = console, now = Date.now }) {
	logs.registerCategory('backups', 'Sauvegardes des serveurs');
	let running = false;

	const q = {
		insert: db.prepare('INSERT INTO server_backups (guild_id, name, kind, data, roles, channels, members, size, created_by, created_at) VALUES (@guildId, @name, @kind, @data, @roles, @channels, @members, @size, @by, @at)'),
		list: db.prepare('SELECT id, guild_id, name, kind, roles, channels, members, size, created_by, created_at FROM server_backups ORDER BY created_at DESC LIMIT 500'),
		listGuild: db.prepare('SELECT id, guild_id, name, kind, roles, channels, members, size, created_by, created_at FROM server_backups WHERE guild_id = ? ORDER BY created_at DESC'),
		get: db.prepare('SELECT * FROM server_backups WHERE id = ?'),
		delete: db.prepare('DELETE FROM server_backups WHERE id = ?'),
		autos: db.prepare('SELECT id FROM server_backups WHERE guild_id = ? AND kind = \'auto\' ORDER BY created_at DESC'),
		lastAuto: db.prepare('SELECT created_at FROM server_backups WHERE guild_id = ? AND kind = \'auto\' ORDER BY created_at DESC LIMIT 1'),
	};

	const toSummary = row => ({
		id: row.id, guildId: row.guild_id, guildName: network.find(row.guild_id)?.name ?? row.guild_id, name: row.name, kind: row.kind,
		roles: row.roles, channels: row.channels, members: row.members, size: row.size, createdBy: row.created_by, createdAt: row.created_at,
	});

	function getOrThrow(id) {
		const row = q.get.get(id);
		if (!row) throw new NotFoundError('Sauvegarde introuvable.');
		return row;
	}

	function need(actor, permission) {
		if (!actor.can(permission)) throw new ForbiddenError(`Permission manquante : ${permission}`);
	}

	function config() {
		return normalizeBackupConfig(settings.get('backups.config', DEFAULT_BACKUP_CONFIG));
	}

	function dataOf(row) {
		return JSON.parse(gunzipSync(row.data).toString('utf8'));
	}

	async function take(guildId, { name, kind, by }) {
		const guild = network.find(guildId);
		if (guild?.status !== 'active' || !guild.botPresent) throw new ValidationError('Serveur inactif ou sans le bot.');
		const snapshot = await templates.photo(guildId);
		const memberRoles = await executor.snapshotMemberRoles(guildId).catch((error) => {
			logger.warn(`Members' roles of ${guildId} not saved:`, error.message);
			return [];
		});
		const data = gzipSync(Buffer.from(JSON.stringify({ version: 1, snapshot, memberRoles })));
		const id = Number(q.insert.run({
			guildId, name, kind, data, roles: snapshot.guild.roles.filter(r => !r.everyone).length, channels: snapshot.guild.channels.length,
			members: memberRoles.length, size: data.length, by, at: now(),
		}).lastInsertRowid);
		// Automatic ones: only the last N are kept; manual ones stay until deleted
		if (kind === 'auto') for (const old of q.autos.all(guildId).slice(config().keep)) q.delete.run(old.id);
		return toSummary(getOrThrow(id));
	}

	function dateName(at) {
		return new Date(at).toLocaleString('fr-FR', { timeZone: TIME_ZONE, dateStyle: 'short', timeStyle: 'short' });
	}

	return {
		config,
		list: guildId => (guildId ? q.listGuild.all(guildId) : q.list.all()).map(toSummary),
		get: id => toSummary(getOrThrow(id)),

		// Content of a backup (download)
		content(actor, id) {
			need(actor, 'backups.manage');
			return dataOf(getOrThrow(id));
		},

		setConfig(actor, input) {
			need(actor, 'backups.manage');
			const c = normalizeBackupConfig(input);
			settings.set('backups.config', c);
			audit.record({ actorId: actor.id, source: 'panel', action: 'backups.config', target: 'backups', details: { enabled: c.enabled, hour: c.hour, keep: c.keep } });
			return c;
		},

		async create(actor, guildId, name = '') {
			need(actor, 'backups.manage');
			const backup = await take(guildId, { name: String(name).trim().slice(0, 80) || `Manuelle du ${dateName(now())}`, kind: 'manual', by: actor.id });
			audit.record({ actorId: actor.id, source: 'panel', action: 'backups.create', guildId, target: String(backup.id), details: { name: backup.name, roles: backup.roles, channels: backup.channels, members: backup.members } });
			return backup;
		},

		remove(actor, id) {
			need(actor, 'backups.manage');
			const row = getOrThrow(id);
			q.delete.run(id);
			audit.record({ actorId: actor.id, source: 'panel', action: 'backups.delete', guildId: row.guild_id, target: String(id), details: { name: row.name } });
		},

		// mode: "repair" (puts back what is missing, deletes nothing) or "restore" (also removes what the backup did not have)
		restore(actor, id, { mode = 'repair', panel = true, memberRoles = true, confirmName = '' } = {}) {
			need(actor, 'backups.restore');
			const row = getOrThrow(id);
			if (!['repair', 'restore'].includes(mode)) throw new ValidationError('Action inconnue.');
			const guild = network.find(row.guild_id);
			if (guild?.status !== 'active' || !guild.botPresent) throw new ValidationError('Le serveur n’est plus actif ou le bot n’y est plus.');
			if (mode === 'restore' && String(confirmName).trim().toLowerCase() !== String(guild.name).trim().toLowerCase()) {
				throw new ValidationError('Tape le nom exact du serveur pour confirmer la restauration complète.');
			}
			const data = dataOf(row);
			return templates.restoreBackup(actor, { backupId: row.id, name: row.name, snapshot: data.snapshot, guildId: row.guild_id, mode, panel, memberRoles: memberRoles ? data.memberRoles : null });
		},

		// Every 10 minutes: the nightly backup of each server, once a day at the chosen hour (Paris time)
		async tick() {
			const c = config();
			if (!c.enabled || running) return 0;
			const parts = zonedParts(now(), TIME_ZONE);
			if (parts.hour !== c.hour) return 0;
			running = true;
			let done = 0;
			try {
				const guilds = network.list().filter(g => g.status === 'active' && g.botPresent && (!c.guildIds.length || c.guildIds.includes(g.id)));
				for (const g of guilds) {
					const last = q.lastAuto.get(g.id)?.created_at;
					if (last && now() - last < 20 * 3_600_000) continue;
					await take(g.id, { name: `Automatique du ${dateName(now())}`, kind: 'auto', by: 'system' })
						.then(() => done++)
						.catch(error => logger.warn(`Backup of ${g.name} failed:`, error.message));
				}
				if (done) audit.record({ actorId: 'system', source: 'system', action: 'backups.auto', target: 'backups', details: { servers: done } });
			}
			finally {
				running = false;
			}
			return done;
		},
	};
}
