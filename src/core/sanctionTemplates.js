import { definePermission } from './permissions.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';
import { formatDuration } from './duration.js';

definePermission('sanctions.templates', { label: 'Gérer les modèles de sanctions', category: 'Sanctions' });

const TYPES = new Set(['ban', 'kick', 'timeout', 'warn', 'restrict']);
const DELETE_WINDOWS = new Set([0, 3600, 86400, 604800]);
const MAX_TIMEOUT = 28 * 86_400_000;

// Sanction templates: a base (type, reason, duration, scope) picked from the panel or /sanctionner.
// Everything stays adjustable when sanctioning: the template only fills the form.
export function createSanctionTemplates({ db, audit, restrictions, now = Date.now }) {
	const q = {
		list: db.prepare('SELECT * FROM sanction_templates ORDER BY position, name'),
		get: db.prepare('SELECT * FROM sanction_templates WHERE id = ?'),
		byName: db.prepare('SELECT id FROM sanction_templates WHERE name = ? COLLATE NOCASE AND id != ?'),
		insert: db.prepare(`
			INSERT INTO sanction_templates (name, type, reason, duration_ms, scope, profile, delete_message_seconds, position, created_at, updated_at)
			VALUES (@name, @type, @reason, @durationMs, @scope, @profile, @deleteMessageSeconds, (SELECT COALESCE(MAX(position), 0) + 1 FROM sanction_templates), @at, @at)
		`),
		update: db.prepare(`
			UPDATE sanction_templates SET name = @name, type = @type, reason = @reason, duration_ms = @durationMs, scope = @scope, profile = @profile,
				delete_message_seconds = @deleteMessageSeconds, updated_at = @at WHERE id = @id
		`),
		remove: db.prepare('DELETE FROM sanction_templates WHERE id = ?'),
		move: db.prepare('UPDATE sanction_templates SET position = ? WHERE id = ?'),
	};

	const toTemplate = row => row && ({
		id: row.id, name: row.name, type: row.type, reason: row.reason, durationMs: row.duration_ms, scope: row.scope,
		profile: row.profile, deleteMessageSeconds: row.delete_message_seconds, position: row.position,
		durationLabel: row.duration_ms ? formatDuration(row.duration_ms) : null,
	});

	function requireManage(actor) {
		if (!actor.can('sanctions.templates')) throw new ForbiddenError('Permission manquante : sanctions.templates');
	}

	function normalize(input, id = -1) {
		const name = String(input.name ?? '').trim();
		if (!name || name.length > 60) throw new ValidationError('Le nom fait entre 1 et 60 caractères.');
		if (q.byName.get(name, id)) throw new ValidationError(`Un modèle « ${name} » existe déjà.`);
		if (!TYPES.has(input.type)) throw new ValidationError('Type de sanction inconnu.');
		const reason = String(input.reason ?? '').trim().slice(0, 500);
		if (input.type === 'warn' && !reason) throw new ValidationError('Un avertissement a besoin d’une raison.');
		const durationMs = input.durationMs ? Number(input.durationMs) : null;
		if (durationMs !== null && (!Number.isInteger(durationMs) || durationMs < 60_000)) throw new ValidationError('Durée invalide (1 minute minimum).');
		if (input.type === 'timeout' && (!durationMs || durationMs > MAX_TIMEOUT)) throw new ValidationError('Un timeout dure entre 1 minute et 28 jours.');
		if (['kick', 'warn'].includes(input.type) && durationMs) throw new ValidationError('Cette sanction n’a pas de durée.');
		const profile = input.type === 'restrict' ? String(input.profile ?? '') : null;
		if (input.type === 'restrict' && !restrictions.profiles().some(p => p.key === profile)) throw new ValidationError('Choisis une restriction.');
		const deleteMessageSeconds = input.type === 'ban' ? Number(input.deleteMessageSeconds ?? 0) : 0;
		if (!DELETE_WINDOWS.has(deleteMessageSeconds)) throw new ValidationError('Suppression des messages invalide.');
		return {
			name, type: input.type, reason, durationMs, profile, deleteMessageSeconds,
			scope: input.type === 'warn' ? 'network' : input.scope === 'local' ? 'local' : 'network',
		};
	}

	const service = {
		list: () => q.list.all().map(toTemplate),

		get(id) {
			const template = toTemplate(q.get.get(id));
			if (!template) throw new NotFoundError('Modèle de sanction introuvable.');
			return template;
		},

		// Search by name (autocomplete of /sanctionner), only templates the person may apply
		suggest(actor, typed = '', limit = 25) {
			const text = String(typed).toLowerCase();
			return service.list().filter(t => actor.can(`sanctions.${t.type}`) && (!text || t.name.toLowerCase().includes(text) || t.reason.toLowerCase().includes(text))).slice(0, limit);
		},

		save(actor, input) {
			requireManage(actor);
			const data = normalize(input, input.id ?? -1);
			let id = input.id;
			if (id) {
				service.get(id);
				q.update.run({ ...data, id, at: now() });
			}
			else {
				id = Number(q.insert.run({ ...data, at: now() }).lastInsertRowid);
			}
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: input.id ? 'sanctions.template_update' : 'sanctions.template_create', target: String(id), details: { name: data.name, type: data.type } });
			return service.get(id);
		},

		remove(actor, id) {
			requireManage(actor);
			const template = service.get(id);
			q.remove.run(id);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'sanctions.template_delete', target: String(id), details: { name: template.name } });
		},

		// New order, from the top
		reorder(actor, ids) {
			requireManage(actor);
			db.transaction(() => ids.forEach((id, i) => q.move.run(i + 1, id)))();
			return service.list();
		},

		// Template + what the moderator changed -> input of sanctions.create
		// `extra` is appended to the template reason; a given duration or scope replaces the template's
		resolve(id, { extra = '', durationMs, scope } = {}) {
			const t = service.get(id);
			const reason = [t.reason, String(extra ?? '').trim()].filter(Boolean).join(' · ').slice(0, 500);
			return {
				type: t.type, reason, profile: t.profile, deleteMessageSeconds: t.deleteMessageSeconds,
				durationMs: durationMs !== undefined && durationMs !== null ? durationMs : t.durationMs,
				scope: t.type === 'warn' ? 'network' : scope ?? t.scope,
			};
		},
	};
	return service;
}
