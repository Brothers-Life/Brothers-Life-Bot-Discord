import { definePermission } from '../permissions.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors.js';
import { plan, remapDeep } from './plan.js';
import { cleanGuildSnapshot, panelSnapshot, summary } from './snapshot.js';

definePermission('templates.view', { label: 'Voir les modèles de serveur et leurs applications', category: 'Modèles de serveur' });
definePermission('templates.manage', { label: 'Créer, reprendre la photo, renommer et supprimer des modèles', category: 'Modèles de serveur' });
definePermission('templates.apply', { label: 'Réparer ou réinitialiser un serveur à partir d’un modèle', category: 'Modèles de serveur' });

const SYSTEM = { id: 'system', source: 'system', isOwner: true, can: () => true };

// Several model Discords ("Entreprise", "Gang"…) photographed and rebuilt on other servers of the network
export function createTemplates({ db, network, audit, executor, events, automod, tickets, logs, settings, logger = console, now = Date.now }) {
	logs.registerCategory('templates', 'Modèles de serveur (applications)');
	let job = null;

	const q = {
		all: db.prepare('SELECT * FROM server_templates ORDER BY name COLLATE NOCASE'),
		get: db.prepare('SELECT * FROM server_templates WHERE id = ?'),
		insert: db.prepare('INSERT INTO server_templates (name, description, source_guild_id, snapshot, captured_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
		capture: db.prepare('UPDATE server_templates SET snapshot = ?, captured_at = ? WHERE id = ?'),
		rename: db.prepare('UPDATE server_templates SET name = ?, description = ? WHERE id = ?'),
		delete: db.prepare('DELETE FROM server_templates WHERE id = ?'),
		sources: db.prepare('SELECT DISTINCT source_guild_id FROM server_templates'),
		application: db.prepare('SELECT * FROM template_applications WHERE guild_id = ?'),
		applications: db.prepare('SELECT * FROM template_applications'),
		saveApplication: db.prepare(`
			INSERT INTO template_applications (guild_id, template_id, mapping, mode, status, report, applied_at, applied_by)
			VALUES (@guildId, @templateId, @mapping, @mode, @status, @report, @at, @by)
			ON CONFLICT (guild_id) DO UPDATE SET template_id = excluded.template_id, mapping = excluded.mapping, mode = excluded.mode,
				status = excluded.status, report = excluded.report, applied_at = excluded.applied_at, applied_by = excluded.applied_by
		`),
	};

	function toTemplate(row, { withSnapshot = false } = {}) {
		if (!row) return null;
		const snapshot = JSON.parse(row.snapshot);
		return {
			id: row.id, name: row.name, description: row.description, sourceGuildId: row.source_guild_id,
			sourceName: network.find(row.source_guild_id)?.name ?? snapshot.guild.name, capturedAt: row.captured_at, createdAt: row.created_at,
			summary: summary(snapshot), ...(withSnapshot ? { snapshot } : {}),
		};
	}

	function toApplication(row) {
		if (!row) return null;
		return { guildId: row.guild_id, templateId: row.template_id, mode: row.mode, status: row.status, report: JSON.parse(row.report), appliedAt: row.applied_at, appliedBy: row.applied_by };
	}

	function getOrThrow(id) {
		const row = q.get.get(id);
		if (!row) throw new NotFoundError('Modèle introuvable.');
		return row;
	}

	function need(actor, permission) {
		if (!actor.can(permission)) throw new ForbiddenError(`Permission manquante : ${permission}`);
	}

	function validName(name) {
		const n = String(name ?? '').trim();
		if (!n || n.length > 60) throw new ValidationError('Le nom du modèle fait 1 à 60 caractères.');
		return n;
	}

	async function takePhoto(guildId) {
		const guild = network.find(guildId);
		if (guild?.status !== 'active' || !guild.botPresent) throw new ValidationError('Le Discord modèle doit être un serveur actif du réseau, avec le bot dessus.');
		const snapshot = { guild: cleanGuildSnapshot(await executor.snapshotGuild(guildId)), panel: panelSnapshot(db, guildId) };
		return JSON.stringify(snapshot);
	}

	const sourceIds = () => new Set(q.sources.all().map(r => r.source_guild_id));

	// A job cut by a restart leaves the server half built: it is reported, and "Réparer" finishes it
	const interrupted = settings.get('templates.running', null);
	if (interrupted) {
		const report = { created: 0, edited: 0, deleted: 0, warnings: ['Interrompue par un redémarrage du bot : lance « Réparer » pour terminer.'], durationMs: 0 };
		const last = q.application.get(interrupted.guildId);
		q.saveApplication.run({
			guildId: interrupted.guildId, templateId: interrupted.templateId, mapping: last?.mapping ?? JSON.stringify({ roles: {}, channels: {} }),
			mode: interrupted.mode, status: 'failed', report: JSON.stringify(report), at: now(), by: interrupted.by,
		});
		settings.set('templates.running', null);
	}

	// --- Panel configuration of the model, rewritten with the target's ids -----------------------------
	function applyPanel(panel, guildId, mode, ids, warnings) {
		const remapRow = (row) => {
			const out = {};
			for (const [k, v] of Object.entries(row)) {
				if (k === 'id') continue;
				out[k] = k === 'guild_id' ? guildId : remapDeep(v, ids);
			}
			return out;
		};
		const insert = (table, row, orIgnore = false) => {
			const cols = Object.keys(row);
			return db.prepare(`INSERT ${orIgnore ? 'OR IGNORE ' : ''}INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(c => `@${c}`).join(', ')})`).run(row);
		};
		const existing = table => db.prepare(`SELECT * FROM ${table} WHERE guild_id = ?`).all(guildId);
		const categoryIds = new Map();
		const toPublish = [];

		db.transaction(() => {
			// Ticket settings (one row)
			if (panel.ticket_settings.length && (mode === 'reset' || !existing('ticket_settings').length)) {
				db.prepare('DELETE FROM ticket_settings WHERE guild_id = ?').run(guildId);
				insert('ticket_settings', { ...remapRow(panel.ticket_settings[0]), panel_message_id: null });
			}
			// Ticket types, matched by name
			const current = existing('ticket_categories');
			for (const row of panel.ticket_categories) {
				const data = remapRow(row);
				const match = current.find(c => c.name === row.name);
				if (match) {
					categoryIds.set(row.id, match.id);
					if (mode === 'reset') {
						const cols = Object.keys(data).filter(c => c !== 'guild_id' && c !== 'created_at');
						db.prepare(`UPDATE ticket_categories SET ${cols.map(c => `${c} = @${c}`).join(', ')} WHERE id = @id`).run({ ...data, id: match.id });
					}
				}
				else {
					categoryIds.set(row.id, Number(insert('ticket_categories', { ...data, created_at: now() }).lastInsertRowid));
				}
			}
			if (mode === 'reset') {
				const keep = new Set(panel.ticket_categories.map(c => c.name));
				for (const c of current) if (!keep.has(c.name)) db.prepare('DELETE FROM ticket_categories WHERE id = ?').run(c.id);
			}
			// Statuses
			if (mode === 'reset' && panel.ticket_statuses.length) db.prepare('DELETE FROM ticket_statuses WHERE guild_id = ?').run(guildId);
			for (const row of panel.ticket_statuses) insert('ticket_statuses', remapRow(row), true);
			// Panels (published again below)
			const currentPanels = existing('ticket_panels');
			if (mode === 'reset' && panel.ticket_panels.length) db.prepare('DELETE FROM ticket_panels WHERE guild_id = ?').run(guildId);
			for (const row of panel.ticket_panels) {
				if (mode === 'repair' && currentPanels.some(p => p.name === row.name)) continue;
				const data = remapRow(row);
				const cats = JSON.parse(data.category_ids || '[]').map(id => categoryIds.get(id)).filter(Boolean);
				const id = Number(insert('ticket_panels', { ...data, message_id: null, category_ids: JSON.stringify(cats), created_at: now() }).lastInsertRowid);
				if (data.channel_id && data.channel_id !== row.channel_id) toPublish.push(id);
			}
			// Log channels: only when the model's channel exists on the target
			if (mode === 'reset' && panel.log_routes.length) db.prepare('DELETE FROM log_routes WHERE guild_id = ?').run(guildId);
			for (const row of panel.log_routes) {
				if (!ids.has(row.channel_id)) {
					warnings.push(`Logs « ${row.category} » : salon du modèle introuvable, ignoré.`);
					continue;
				}
				insert('log_routes', remapRow(row), true);
			}
			// Staff roles: rank -> role of the target
			if (mode === 'reset' && panel.rank_roles.length) db.prepare('DELETE FROM rank_roles WHERE guild_id = ?').run(guildId);
			for (const row of panel.rank_roles) if (ids.has(row.role_id)) insert('rank_roles', remapRow(row), true);
		})();

		// Automod through its service (it keeps a cache)
		const auto = panel.automod_config[0];
		if (auto && (mode === 'reset' || !existing('automod_config').length)) {
			try {
				automod.setConfig(SYSTEM, guildId, JSON.parse(remapDeep(auto.config, ids)));
			}
			catch (error) {
				warnings.push(`Automod : ${error.message}`);
			}
		}
		return toPublish;
	}

	// --- The job: one at a time for the whole bot ---------------------------------------------------
	async function run(template, guildId, mode, actor) {
		const snapshot = JSON.parse(template.snapshot);
		const last = q.application.get(guildId);
		const saved = last ? JSON.parse(last.mapping) : { roles: {}, channels: {} };
		const roles = new Map([[snapshot.guild.id, guildId]]);
		const channels = new Map();
		const stats = { created: 0, edited: 0, deleted: 0 };
		const started = now();
		settings.set('templates.running', { guildId, templateId: template.id, mode, by: actor.id, startedAt: started });
		events.mute(guildId, true);
		try {
			const target = await executor.snapshotGuild(guildId);
			const { ops, warnings } = plan(snapshot, target, saved, mode);
			job.warnings.push(...warnings);
			job.total = ops.length;
			for (const op of ops) {
				job.step = label(op);
				try {
					await execute(op, { guildId, roles, channels, snapshot, mode, stats });
				}
				catch (error) {
					job.warnings.push(`${job.step} : ${error.message}`);
				}
				job.done++;
			}
			job.status = 'done';
		}
		catch (error) {
			logger.error('Template job failed:', error);
			job.status = 'failed';
			job.warnings.push(`Arrêt : ${error.message}`);
		}
		finally {
			events.mute(guildId, false);
			settings.set('templates.running', null);
		}
		job.finishedAt = now();
		job.step = job.status === 'done' ? 'Terminé' : 'Échec';
		const report = { ...stats, warnings: job.warnings.slice(0, 200), durationMs: job.finishedAt - started };
		job.report = report;
		const mapping = { roles: Object.fromEntries(roles), channels: Object.fromEntries(channels) };
		q.saveApplication.run({ guildId, templateId: template.id, mapping: JSON.stringify(mapping), mode, status: job.status, report: JSON.stringify(report), at: now(), by: actor.id });
		audit.record({
			actorId: actor.id, source: actor.source ?? 'panel', action: 'templates.apply', guildId, target: guildId,
			details: { template: template.name, mode: mode === 'reset' ? 'réinitialisation' : 'réparation', created: stats.created, edited: stats.edited, deleted: stats.deleted, warnings: report.warnings.length },
		});
	}

	function label(op) {
		switch (op.op) {
		case 'createRole': return `Création du rôle ${op.name}`;
		case 'editRole': return `Rôle ${op.name}`;
		case 'deleteRole': return `Suppression du rôle ${op.name}`;
		case 'createChannel': return `Création du salon ${op.name}`;
		case 'editChannel': return `Salon ${op.name}`;
		case 'deleteChannel': return `Suppression de l’ancien salon ${op.name}`;
		case 'settings': return 'Réglages du serveur';
		case 'rolePositions': return 'Ordre des rôles';
		default: return 'Configuration du panel';
		}
	}

	function resolveChannel(data, roles, channels, guildId) {
		return {
			...data,
			parentId: data.parentKey ? channels.get(data.parentKey) ?? null : null,
			overwrites: data.overwrites.map(o => ({ id: roles.get(o.id), allow: o.allow, deny: o.deny })).filter(o => o.id),
			guildId,
		};
	}

	async function execute(op, { guildId, roles, channels, snapshot, mode, stats }) {
		switch (op.op) {
		case 'createRole':
			roles.set(op.key, await executor.createRole(guildId, op.data));
			stats.created++;
			return;
		case 'editRole':
			await executor.editRole(guildId, op.targetId, op.data);
			roles.set(op.key, op.targetId);
			stats.edited++;
			return;
		case 'deleteRole':
			await executor.deleteRole(guildId, op.targetId);
			stats.deleted++;
			return;
		case 'createChannel':
			channels.set(op.key, await executor.createChannel(guildId, resolveChannel(op.data, roles, channels, guildId)));
			stats.created++;
			return;
		case 'editChannel':
			await executor.editChannel(guildId, op.targetId, resolveChannel(op.data, roles, channels, guildId));
			channels.set(op.key, op.targetId);
			stats.edited++;
			return;
		case 'deleteChannel':
			await executor.removeTemplateChannel(guildId, op.targetId);
			stats.deleted++;
			return;
		case 'settings': {
			const ch = key => (key ? channels.get(key) ?? null : null);
			const { afkChannelKey, systemChannelKey, rulesChannelKey, publicUpdatesChannelKey, ...rest } = op.data;
			await executor.editGuildSettings(guildId, {
				...rest, afkChannelId: ch(afkChannelKey), systemChannelId: ch(systemChannelKey),
				...(rulesChannelKey ? { rulesChannelId: ch(rulesChannelKey) } : {}),
				...(publicUpdatesChannelKey ? { publicUpdatesChannelId: ch(publicUpdatesChannelKey) } : {}),
			});
			return;
		}
		case 'rolePositions':
			await executor.setRolePositions(guildId, op.keys.map(k => roles.get(k)).filter(Boolean));
			return;
		case 'panel': {
			const ids = new Map([...roles, ...channels]);
			const toPublish = applyPanel(snapshot.panel, guildId, mode, ids, job.warnings);
			for (const panelId of toPublish) {
				await tickets.publishPanel(SYSTEM, guildId, panelId).catch(error => job.warnings.push(`Panneau de tickets : ${error.message}`));
			}
			return;
		}
		default:
		}
	}

	return {
		list: () => q.all.all().map(row => toTemplate(row)),
		get: id => toTemplate(getOrThrow(id), { withSnapshot: true }),

		async create(actor, { name, description = '', sourceGuildId }) {
			need(actor, 'templates.manage');
			const n = validName(name);
			if (network.find(sourceGuildId)?.isMain) throw new ValidationError('Le serveur principal ne peut pas servir de modèle.');
			const snapshot = await takePhoto(sourceGuildId);
			const id = Number(q.insert.run(n, String(description).slice(0, 300) || null, sourceGuildId, snapshot, now(), actor.id, now()).lastInsertRowid);
			audit.record({ actorId: actor.id, source: 'panel', action: 'templates.create', guildId: sourceGuildId, target: String(id), details: { name: n } });
			return toTemplate(q.get.get(id));
		},

		// New photo of the model server (after changes made on it)
		async capture(actor, id) {
			need(actor, 'templates.manage');
			const row = getOrThrow(id);
			q.capture.run(await takePhoto(row.source_guild_id), now(), id);
			audit.record({ actorId: actor.id, source: 'panel', action: 'templates.capture', guildId: row.source_guild_id, target: String(id), details: { name: row.name } });
			return toTemplate(q.get.get(id));
		},

		rename(actor, id, { name, description = null }) {
			need(actor, 'templates.manage');
			const row = getOrThrow(id);
			q.rename.run(validName(name), description === null ? row.description : String(description).slice(0, 300) || null, id);
			return toTemplate(q.get.get(id));
		},

		remove(actor, id) {
			need(actor, 'templates.manage');
			const row = getOrThrow(id);
			q.delete.run(id);
			audit.record({ actorId: actor.id, source: 'panel', action: 'templates.delete', target: String(id), details: { name: row.name } });
		},

		// Servers a template may be applied to, with what was applied last
		targets() {
			const sources = sourceIds();
			const applied = new Map(q.applications.all().map(r => [r.guild_id, toApplication(r)]));
			return network.list()
				.filter(g => g.status === 'active' && g.botPresent && !g.isMain && !sources.has(g.id))
				.map(g => ({ id: g.id, name: g.name, icon: g.icon ?? null, application: applied.get(g.id) ?? null }));
		},

		// Starts the job; follow it with job()
		apply(actor, id, { guildId, mode, confirmName = '' }) {
			need(actor, 'templates.apply');
			const row = getOrThrow(id);
			if (!['reset', 'repair'].includes(mode)) throw new ValidationError('Action inconnue.');
			const guild = network.find(guildId);
			if (!guild || guild.status !== 'active' || !guild.botPresent) throw new ValidationError('Ce serveur n’est pas un serveur actif du réseau avec le bot.');
			if (guild.isMain) throw new ForbiddenError('Jamais sur le serveur principal.');
			if (sourceIds().has(guildId)) throw new ForbiddenError('Ce serveur est le Discord d’un modèle : il ne peut pas être reconstruit.');
			if (mode === 'reset' && String(confirmName).trim().toLowerCase() !== String(guild.name).trim().toLowerCase()) {
				throw new ValidationError('Tape le nom exact du serveur pour confirmer la réinitialisation.');
			}
			if (job?.status === 'running') throw new ValidationError(`Une application est déjà en cours (${job.guildName}) : attends la fin.`);
			job = { templateId: id, templateName: row.name, guildId, guildName: guild.name, mode, status: 'running', step: 'Préparation', done: 0, total: 0, warnings: [], startedAt: now(), finishedAt: null, report: null };
			job.promise = run(row, guildId, mode, actor).catch((error) => {
				job.status = 'failed';
				job.warnings.push(error.message);
			});
			return this.job();
		},

		job() {
			if (!job) return null;
			const { promise, ...rest } = job;
			void promise;
			return { ...rest, warnings: [...rest.warnings] };
		},

		// Tests: wait for the running job
		async settle() {
			await job?.promise;
			return this.job();
		},

		applications: () => q.applications.all().map(toApplication),
	};
}
