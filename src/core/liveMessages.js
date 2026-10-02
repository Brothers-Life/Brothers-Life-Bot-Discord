import { createHash } from 'node:crypto';
import { definePermission } from './permissions.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';
import { normalizePayload } from './announcements.js';
import { fillPayload } from './onboarding.js';
import { createVariables } from './variables.js';

definePermission('messages.view', { label: 'Voir les messages dynamiques', category: 'Messages' });
definePermission('messages.manage', { label: 'Créer, modifier et publier les messages dynamiques', category: 'Messages' });

const SNOWFLAKE = /^\d{17,20}$/;
const VAR_KEY = /^[a-z][a-z0-9_]{0,29}$/;

function normalizeTargets(input) {
	if (!Array.isArray(input)) return [];
	const seen = new Set();
	return input.filter((t) => {
		if (!SNOWFLAKE.test(t?.guildId) || !SNOWFLAKE.test(t?.channelId) || seen.has(t.channelId)) return false;
		seen.add(t.channelId);
		return true;
	}).slice(0, 50).map(t => ({ guildId: t.guildId, channelId: t.channelId }));
}

function normalizeVariables(input = {}) {
	const out = {};
	for (const [key, value] of Object.entries(input ?? {}).slice(0, 30)) {
		if (!VAR_KEY.test(key)) throw new ValidationError(`Nom de variable invalide : « ${key} » (minuscules, chiffres et _).`);
		out[key] = String(value ?? '').slice(0, 500);
	}
	return out;
}

const hash = payload => createHash('sha1').update(JSON.stringify(payload)).digest('hex');

// Messages kept up to date in several channels: edited in place, with live variables
export function createLiveMessages({ db, network, audit, executor, stats, logger = console, now = Date.now, variables = createVariables({ executor, logger, now }) }) {
	const q = {
		list: db.prepare('SELECT * FROM live_messages ORDER BY id DESC'),
		get: db.prepare('SELECT * FROM live_messages WHERE id = ?'),
		insert: db.prepare(`
			INSERT INTO live_messages (name, payload, refresh_minutes, variables, repost, created_by, created_at, updated_at)
			VALUES (@name, @payload, @refreshMinutes, @variables, @repost, @by, @at, @at)
		`),
		update: db.prepare('UPDATE live_messages SET name = @name, payload = @payload, refresh_minutes = @refreshMinutes, variables = @variables, repost = @repost, updated_at = @at WHERE id = @id'),
		setVariables: db.prepare('UPDATE live_messages SET variables = ?, updated_at = ? WHERE id = ?'),
		refreshed: db.prepare('UPDATE live_messages SET refreshed_at = ? WHERE id = ?'),
		remove: db.prepare('DELETE FROM live_messages WHERE id = ?'),
		targets: db.prepare('SELECT * FROM live_message_targets WHERE message_id = ? ORDER BY id'),
		insertTarget: db.prepare('INSERT OR IGNORE INTO live_message_targets (message_id, guild_id, channel_id) VALUES (?, ?, ?)'),
		deleteTarget: db.prepare('DELETE FROM live_message_targets WHERE id = ?'),
		targetDone: db.prepare('UPDATE live_message_targets SET discord_id = ?, last_hash = ?, last_error = NULL, updated_at = ? WHERE id = ?'),
		targetFailed: db.prepare('UPDATE live_message_targets SET last_error = ?, updated_at = ? WHERE id = ?'),
		due: db.prepare('SELECT * FROM live_messages WHERE refresh_minutes > 0 AND (refreshed_at IS NULL OR refreshed_at + refresh_minutes * 60000 <= ?)'),
		sanctionsToday: db.prepare('SELECT COUNT(*) AS n FROM sanctions WHERE created_at >= ?'),
		openTickets: db.prepare('SELECT COUNT(*) AS n FROM tickets WHERE status = \'open\' AND guild_id = ?'),
	};

	function toMessage(row) {
		return {
			id: row.id,
			name: row.name,
			payload: normalizePayload(JSON.parse(row.payload)),
			refreshMinutes: row.refresh_minutes,
			variables: JSON.parse(row.variables),
			repost: Boolean(row.repost),
			createdBy: row.created_by,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			refreshedAt: row.refreshed_at,
			targets: q.targets.all(row.id).map(t => ({ id: t.id, guildId: t.guild_id, channelId: t.channel_id, messageId: t.discord_id, error: t.last_error, updatedAt: t.updated_at })),
		};
	}

	function getOrThrow(id) {
		const row = q.get.get(id);
		if (!row) throw new NotFoundError('Message introuvable.');
		return toMessage(row);
	}

	function need(actor) {
		if (!actor.can('messages.manage')) throw new ForbiddenError('Permission manquante : messages.manage');
	}

	// Values of every variable for one server (network totals are the same everywhere)
	async function variablesFor(guildId, message, network_) {
		const own = await stats.variables(guildId).catch(() => ({}));
		const date = new Date(now());
		const custom = Object.fromEntries(Object.entries(message.variables).map(([k, v]) => [`var.${k}`, v]));
		return {
			...(await variables.server(guildId)),
			...own,
			...network_,
			...custom,
			'date': date.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' }),
			'time': date.toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }),
			'tickets.open': q.openTickets.get(guildId).n,
		};
	}

	async function networkVariables() {
		let members = 0;
		let voice = 0;
		for (const id of network.activeIds()) {
			const counts = await executor.getGuildCounts(id).catch(() => null);
			members += counts?.members ?? 0;
			voice += counts?.voice ?? 0;
		}
		const midnight = new Date(now());
		midnight.setHours(0, 0, 0, 0);
		return {
			'network.members': members.toLocaleString('fr-FR'),
			'network.voice': voice.toLocaleString('fr-FR'),
			'network.servers': network.activeIds().length,
			'sanctions.today': q.sanctionsToday.get(midnight.getTime()).n,
		};
	}

	// Sends or edits the message in each channel; only real changes reach Discord
	async function sync(message, { force = false } = {}) {
		const totals = await networkVariables();
		const results = [];
		for (const target of q.targets.all(message.id)) {
			try {
				const vars = await variablesFor(target.guild_id, message, totals);
				const payload = fillPayload(message.payload, vars);
				const h = hash(payload);
				if (!force && h === target.last_hash && target.discord_id) {
					results.push({ channelId: target.channel_id, ok: true, unchanged: true });
					continue;
				}
				const id = await executor.upsertMessage(target.channel_id, target.discord_id, payload, { repost: message.repost });
				q.targetDone.run(id, h, now(), target.id);
				results.push({ channelId: target.channel_id, ok: true });
			}
			catch (error) {
				q.targetFailed.run(error.message ?? String(error), now(), target.id);
				results.push({ channelId: target.channel_id, ok: false, error: error.message });
				logger.warn(`Live message #${message.id} in ${target.channel_id}:`, error.message);
			}
		}
		q.refreshed.run(now(), message.id);
		return results;
	}

	function validate(input) {
		const name = String(input.name ?? '').trim();
		if (!name || name.length > 100) throw new ValidationError('Le nom fait 1 à 100 caractères.');
		const refreshMinutes = input.refreshMinutes ?? 0;
		if (!Number.isInteger(refreshMinutes) || (refreshMinutes !== 0 && (refreshMinutes < 1 || refreshMinutes > 1440))) throw new ValidationError('Mise à jour : jamais, ou toutes les 1 à 1440 minutes.');
		return {
			name,
			payload: JSON.stringify(normalizePayload(input.payload)),
			refreshMinutes,
			variables: JSON.stringify(normalizeVariables(input.variables)),
			repost: input.repost === false ? 0 : 1,
		};
	}

	function setTargets(id, targets) {
		const wanted = normalizeTargets(targets);
		for (const t of wanted) {
			if (network.find(t.guildId)?.status !== 'active') throw new ValidationError('Un des serveurs ne fait pas partie du réseau.');
		}
		const current = q.targets.all(id);
		db.transaction(() => {
			for (const t of current.filter(c => !wanted.some(w => w.channelId === c.channel_id))) q.deleteTarget.run(t.id);
			for (const t of wanted) q.insertTarget.run(id, t.guildId, t.channelId);
		})();
		return current.filter(c => !wanted.some(w => w.channelId === c.channel_id));
	}

	const service = {
		list: () => q.list.all().map(toMessage),
		get: getOrThrow,

		async create(actor, input) {
			need(actor);
			const values = validate(input);
			const id = Number(q.insert.run({ ...values, by: actor.id, at: now() }).lastInsertRowid);
			setTargets(id, input.targets);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'messages.create', target: String(id), details: { name: values.name } });
			return getOrThrow(id);
		},

		// Saved and pushed to every channel right away
		async update(actor, id, input) {
			need(actor);
			getOrThrow(id);
			const values = validate(input);
			q.update.run({ ...values, id, at: now() });
			const removed = setTargets(id, input.targets ?? getOrThrow(id).targets);
			for (const t of removed) if (t.discord_id) await executor.deleteMessage(t.channel_id, t.discord_id).catch(() => null);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'messages.update', target: String(id), details: { name: values.name } });
			const results = await sync(getOrThrow(id));
			return { ...getOrThrow(id), results };
		},

		async publish(actor, id) {
			need(actor);
			const results = await sync(getOrThrow(id), { force: true });
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'messages.publish', target: String(id), details: { channels: results.length } });
			return { ...getOrThrow(id), results };
		},

		// Free variables ({var.xxx}) changed from the panel without editing the message
		async setVariables(actor, id, values) {
			need(actor);
			const message = getOrThrow(id);
			q.setVariables.run(JSON.stringify(normalizeVariables({ ...message.variables, ...values })), now(), id);
			const results = await sync(getOrThrow(id));
			return { ...getOrThrow(id), results };
		},

		async remove(actor, id, { deleteMessages = true } = {}) {
			need(actor);
			const message = getOrThrow(id);
			if (deleteMessages) {
				for (const t of message.targets) if (t.messageId) await executor.deleteMessage(t.channelId, t.messageId).catch(() => null);
			}
			q.remove.run(id);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'messages.delete', target: String(id), details: { name: message.name } });
		},

		// Every minute: dynamic messages whose refresh is due
		async tick() {
			for (const row of q.due.all(now())) await sync(toMessage(row)).catch(error => logger.warn(`Live message #${row.id} failed:`, error.message));
		},

		variablesPreview: async guildId => ({ ...await variablesFor(guildId, { variables: {} }, await networkVariables()) }),
	};
	return service;
}

