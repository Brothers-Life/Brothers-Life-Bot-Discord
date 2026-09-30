import { definePermission } from './permissions.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';

definePermission('announcements.view', { label: 'Voir les annonces', category: 'Annonces' });
definePermission('announcements.manage', { label: 'Créer, programmer et envoyer des annonces', category: 'Annonces' });
definePermission('announcements.everyone', { label: 'Mentionner @everyone et @here dans une annonce', category: 'Annonces' });

const SNOWFLAKE = /^\d{17,20}$/;
const HTTPS_URL = /^https:\/\/\S+$/;
const COLOR = /^#[0-9a-f]{6}$/i;
const EDITABLE = new Set(['draft', 'scheduled', 'failed']);

// Discord embed limits
const LIMITS = { content: 2000, title: 256, description: 4096, fields: 25, fieldName: 256, fieldValue: 1024, footer: 2048, author: 256, total: 6000 };

function str(value, max) {
	if (value === undefined || value === null) return '';
	if (typeof value !== 'string') throw new ValidationError('Texte attendu.');
	if (value.length > max) throw new ValidationError(`Texte trop long (${value.length}/${max} caractères).`);
	return value;
}

// Besides https URLs: the avatar / server icon variables of welcome messages, and attached files
const URL_TOKEN = /^(\{(user\.avatar|server\.icon)\}|attachment:\/\/[\w.-]+)$/;

function url(value, label) {
	if (!value) return null;
	if (!HTTPS_URL.test(value) && !URL_TOKEN.test(value)) throw new ValidationError(`${label} : une adresse en https:// est attendue.`);
	return value;
}

// Keeps only known fields and enforces Discord's limits
export function normalizePayload(input = {}) {
	const embed = input.embed ?? {};
	const out = {
		content: str(input.content, LIMITS.content),
		embed: {
			enabled: embed.enabled !== false,
			title: str(embed.title, LIMITS.title),
			url: url(embed.url, 'Lien du titre'),
			description: str(embed.description, LIMITS.description),
			color: embed.color && COLOR.test(embed.color) ? embed.color.toLowerCase() : '#d6a249',
			authorName: str(embed.authorName, LIMITS.author),
			authorIconUrl: url(embed.authorIconUrl, 'Icône de l’auteur'),
			thumbnailUrl: url(embed.thumbnailUrl, 'Miniature'),
			imageUrl: url(embed.imageUrl, 'Image'),
			footerText: str(embed.footerText, LIMITS.footer),
			footerIconUrl: url(embed.footerIconUrl, 'Icône du pied de page'),
			timestamp: Boolean(embed.timestamp),
			fields: (Array.isArray(embed.fields) ? embed.fields : []).slice(0, LIMITS.fields).map(f => ({
				name: str(f?.name, LIMITS.fieldName),
				value: str(f?.value, LIMITS.fieldValue),
				inline: Boolean(f?.inline),
			})).filter(f => f.name.trim() && f.value.trim()),
		},
	};
	const e = out.embed;
	const embedText = e.enabled
		? [e.title, e.description, e.authorName, e.footerText, ...e.fields.flatMap(f => [f.name, f.value])].join('')
		: '';
	if (embedText.length > LIMITS.total) throw new ValidationError(`L’embed dépasse ${LIMITS.total} caractères au total (${embedText.length}).`);
	const hasEmbed = e.enabled && (e.title || e.description || e.fields.length || e.imageUrl || e.authorName);
	if (!out.content.trim() && !hasEmbed) throw new ValidationError('L’annonce est vide : écris un message ou remplis l’embed.');
	return out;
}

// targets: [{ guildId, channelId, ping: 'none' | 'everyone' | 'here' | 'roles', roleIds: [], publish: boolean }]
export function normalizeTargets(input) {
	if (!Array.isArray(input)) throw new ValidationError('Choisis au moins un salon.');
	const seen = new Set();
	return input.map((t) => {
		if (!SNOWFLAKE.test(t?.guildId) || !SNOWFLAKE.test(t?.channelId)) throw new ValidationError('Salon invalide.');
		if (seen.has(t.channelId)) throw new ValidationError('Le même salon est choisi deux fois.');
		seen.add(t.channelId);
		const ping = ['none', 'everyone', 'here', 'roles'].includes(t.ping) ? t.ping : 'none';
		const roleIds = ping === 'roles' ? (Array.isArray(t.roleIds) ? t.roleIds : []).filter(r => SNOWFLAKE.test(r)).slice(0, 20) : [];
		if (ping === 'roles' && !roleIds.length) throw new ValidationError('Choisis les rôles à mentionner, ou un autre type de ping.');
		return { guildId: t.guildId, channelId: t.channelId, ping, roleIds, publish: Boolean(t.publish) };
	});
}

export function createAnnouncements({ db, network, audit, executor, logs, logger = console, now = Date.now }) {
	logs.registerCategory('announcements', 'Annonces envoyées');

	const q = {
		insert: db.prepare(`
			INSERT INTO announcements (name, payload, targets, status, scheduled_at, created_by, created_at, updated_at)
			VALUES (@name, @payload, @targets, @status, @scheduledAt, @createdBy, @at, @at)
		`),
		update: db.prepare('UPDATE announcements SET name = @name, payload = @payload, targets = @targets, updated_at = @at WHERE id = @id'),
		status: db.prepare('UPDATE announcements SET status = ?, scheduled_at = ?, updated_at = ? WHERE id = ?'),
		sent: db.prepare('UPDATE announcements SET status = ?, sent_at = ?, results = ?, updated_at = ? WHERE id = ?'),
		results: db.prepare('UPDATE announcements SET status = ?, results = ?, updated_at = ? WHERE id = ?'),
		claim: db.prepare('UPDATE announcements SET status = \'sending\', updated_at = ? WHERE id = ? AND status IN (\'draft\', \'scheduled\', \'failed\')'),
		get: db.prepare('SELECT * FROM announcements WHERE id = ?'),
		delete: db.prepare('DELETE FROM announcements WHERE id = ?'),
		due: db.prepare('SELECT id FROM announcements WHERE status = \'scheduled\' AND scheduled_at <= ?'),
	};

	function toAnnouncement(row) {
		if (!row) return null;
		return {
			id: row.id,
			name: row.name,
			payload: JSON.parse(row.payload),
			targets: JSON.parse(row.targets),
			status: row.status,
			scheduledAt: row.scheduled_at,
			sentAt: row.sent_at,
			results: row.results ? JSON.parse(row.results) : null,
			createdBy: row.created_by,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}

	function getOrThrow(id) {
		const a = toAnnouncement(q.get.get(id));
		if (!a) throw new NotFoundError('Annonce introuvable.');
		return a;
	}

	function requireManage(actor) {
		if (!actor.can('announcements.manage')) throw new ForbiddenError('Permission manquante : announcements.manage');
	}

	async function checkTargets(actor, targets) {
		if (!targets.length) throw new ValidationError('Choisis au moins un salon.');
		for (const t of targets) {
			if (network.find(t.guildId)?.status !== 'active') throw new ValidationError('Un des serveurs choisis ne fait pas partie du réseau.');
			if (!await executor.getTextChannel(t.guildId, t.channelId)) {
				throw new ValidationError('Un des salons choisis n’existe plus, ou le bot ne peut pas y écrire.');
			}
			if ((t.ping === 'everyone' || t.ping === 'here') && !actor.can('announcements.everyone')) {
				throw new ForbiddenError('Permission manquante pour mentionner @everyone ou @here.');
			}
		}
	}

	function validateName(name) {
		if (typeof name !== 'string' || !name.trim() || name.length > 100) throw new ValidationError('Le nom de l’annonce fait 1 à 100 caractères.');
		return name.trim();
	}

	function record(actor, action, a, details = {}) {
		audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action, target: String(a.id), details: { name: a.name, ...details } });
	}

	async function deliver(id, actor) {
		if (!q.claim.run(now(), id).changes) throw new ValidationError('Cette annonce est déjà envoyée ou en cours d’envoi.');
		const a = getOrThrow(id);
		const results = [];
		for (const target of a.targets) {
			try {
				const messageId = await executor.sendAnnouncement(target.channelId, a.payload, target);
				results.push({ ...target, ok: true, messageId });
			}
			catch (error) {
				logger.warn(`Announcement #${id} not sent to ${target.channelId}:`, error.message);
				results.push({ ...target, ok: false, error: error.message });
			}
		}
		const okCount = results.filter(r => r.ok).length;
		const status = okCount === results.length ? 'sent' : okCount ? 'partial' : 'failed';
		q.sent.run(status, now(), JSON.stringify(results), now(), id);
		const sent = getOrThrow(id);
		record(actor, 'announcements.send', sent, {
			channels: results.map(r => `<#${r.channelId}> ${r.ok ? '✓' : `✗ ${r.error}`}`),
		});
		return sent;
	}

	return {
		list({ status, limit = 100 } = {}) {
			const rows = status
				? db.prepare('SELECT * FROM announcements WHERE status = ? ORDER BY id DESC LIMIT ?').all(status, limit)
				: db.prepare('SELECT * FROM announcements ORDER BY id DESC LIMIT ?').all(limit);
			return rows.map(toAnnouncement);
		},

		get: getOrThrow,

		async create(actor, { name, payload, targets }) {
			requireManage(actor);
			const clean = { name: validateName(name), payload: normalizePayload(payload), targets: normalizeTargets(targets ?? []) };
			if (clean.targets.length) await checkTargets(actor, clean.targets);
			const id = Number(q.insert.run({
				name: clean.name, payload: JSON.stringify(clean.payload), targets: JSON.stringify(clean.targets),
				status: 'draft', scheduledAt: null, createdBy: actor.id, at: now(),
			}).lastInsertRowid);
			const a = getOrThrow(id);
			record(actor, 'announcements.create', a);
			return a;
		},

		async update(actor, id, { name, payload, targets }) {
			requireManage(actor);
			const current = getOrThrow(id);
			if (!EDITABLE.has(current.status)) throw new ValidationError('Une annonce déjà envoyée ne se modifie plus : duplique-la.');
			const clean = {
				name: name === undefined ? current.name : validateName(name),
				payload: payload === undefined ? current.payload : normalizePayload(payload),
				targets: targets === undefined ? current.targets : normalizeTargets(targets),
			};
			if (clean.targets.length) await checkTargets(actor, clean.targets);
			q.update.run({ id, name: clean.name, payload: JSON.stringify(clean.payload), targets: JSON.stringify(clean.targets), at: now() });
			return getOrThrow(id);
		},

		async send(actor, id) {
			requireManage(actor);
			const a = getOrThrow(id);
			await checkTargets(actor, a.targets);
			return deliver(id, actor);
		},

		async schedule(actor, id, at) {
			requireManage(actor);
			const a = getOrThrow(id);
			if (!EDITABLE.has(a.status)) throw new ValidationError('Cette annonce est déjà envoyée.');
			if (!Number.isInteger(at) || at < now() + 30_000) throw new ValidationError('Choisis une date dans le futur (au moins 30 secondes).');
			await checkTargets(actor, a.targets);
			q.status.run('scheduled', at, now(), id);
			const scheduled = getOrThrow(id);
			record(actor, 'announcements.schedule', scheduled, { at: new Date(at).toISOString() });
			return scheduled;
		},

		unschedule(actor, id) {
			requireManage(actor);
			const a = getOrThrow(id);
			if (a.status !== 'scheduled') throw new ValidationError('Cette annonce n’est pas programmée.');
			q.status.run('draft', null, now(), id);
			record(actor, 'announcements.unschedule', a);
			return getOrThrow(id);
		},

		async duplicate(actor, id) {
			requireManage(actor);
			const a = getOrThrow(id);
			const copyId = Number(q.insert.run({
				name: `${a.name} (copie)`.slice(0, 100), payload: JSON.stringify(a.payload), targets: JSON.stringify(a.targets),
				status: 'draft', scheduledAt: null, createdBy: actor.id, at: now(),
			}).lastInsertRowid);
			return getOrThrow(copyId);
		},

		// Draft: removed. Sent: its Discord messages are deleted, the history is kept.
		async remove(actor, id) {
			requireManage(actor);
			const a = getOrThrow(id);
			if (EDITABLE.has(a.status)) {
				q.delete.run(id);
				record(actor, 'announcements.delete', a);
				return null;
			}
			const results = [];
			for (const r of a.results ?? []) {
				if (!r.ok || !r.messageId) {
					results.push(r);
					continue;
				}
				try {
					await executor.deleteMessage(r.channelId, r.messageId);
					results.push({ ...r, deleted: true });
				}
				catch (error) {
					results.push({ ...r, deleteError: error.message });
				}
			}
			q.results.run('deleted', JSON.stringify(results), now(), id);
			record(actor, 'announcements.delete', a, { messages: results.filter(r => r.deleted).length });
			return getOrThrow(id);
		},

		// Scheduler: announcements whose date has come
		async sendDue() {
			const system = { id: 'system', source: 'system', isOwner: true, can: () => true };
			const due = q.due.all(now());
			for (const { id } of due) await deliver(id, system).catch(error => logger.error(`Scheduled announcement #${id} failed:`, error));
			return due.length;
		},
	};
}
