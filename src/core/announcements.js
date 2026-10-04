import { definePermission } from './permissions.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';
import { fillVars } from './cards.js';
import { createVariables } from './variables.js';
import { DEFAULT_TIME_ZONE, nextOccurrence, normalizeRecurrence, occurrences } from './recurrence.js';

definePermission('announcements.view', { label: 'Voir les annonces', category: 'Annonces' });
definePermission('announcements.manage', { label: 'Créer, programmer et envoyer des annonces', category: 'Annonces' });
definePermission('announcements.everyone', { label: 'Mentionner @everyone et @here dans une annonce', category: 'Annonces' });

const SNOWFLAKE = /^\d{17,20}$/;
const HTTPS_URL = /^https:\/\/\S+$/;
const COLOR = /^#[0-9a-f]{6}$/i;
const UPLOAD = /^upload:[a-f0-9]{32}\.(png|jpg|webp|gif)$/;
const EMOJI = /^(<a?:\w{2,32}:\d{17,20}>|[^\s<>]{1,16})$/u;
const EDITABLE = new Set(['draft', 'scheduled', 'failed']);
const MAX_IMAGES = 10;

// Discord embed limits
const LIMITS = { content: 2000, title: 256, description: 4096, fields: 25, fieldName: 256, fieldValue: 1024, footer: 2048, author: 256, total: 6000 };

function str(value, max) {
	if (value === undefined || value === null) return '';
	if (typeof value !== 'string') throw new ValidationError('Texte attendu.');
	if (value.length > max) throw new ValidationError(`Texte trop long (${value.length}/${max} caractères).`);
	return value;
}

// Besides https URLs: the avatar / server icon variables of welcome messages, the stream and feed variables, and attached files
const URL_TOKEN = /^(\{(user\.avatar|server\.icon|thumbnail|url|(?:item|video)\.(?:lien|image)|flux\.lien)\}|attachment:\/\/[\w.-]+)$/;

function url(value, label, uploads) {
	if (!value) return null;
	if (!HTTPS_URL.test(value) && !URL_TOKEN.test(value) && !(uploads && UPLOAD.test(value))) throw new ValidationError(`${label} : une adresse en https:// est attendue.`);
	return value;
}

// Keeps only known fields and enforces Discord's limits. `uploads`: images sent from the panel ("upload:<id>") are allowed.
export function normalizePayload(input = {}, { uploads = false } = {}) {
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
			authorIconUrl: url(embed.authorIconUrl, 'Icône de l’auteur', uploads),
			thumbnailUrl: url(embed.thumbnailUrl, 'Miniature', uploads),
			imageUrl: url(embed.imageUrl, 'Image', uploads),
			footerText: str(embed.footerText, LIMITS.footer),
			footerIconUrl: url(embed.footerIconUrl, 'Icône du pied de page', uploads),
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

export const DEFAULT_OPTIONS = { autoDeleteHours: 0, pin: false, thread: { enabled: false, name: '' }, reactions: [], buttons: [], gallery: [], attachments: [] };

function image(value, label) {
	if (typeof value !== 'string' || !(HTTPS_URL.test(value) || UPLOAD.test(value))) throw new ValidationError(`${label} : image envoyée ou adresse https:// attendue.`);
	return value;
}

// Send options: pin, thread, reactions, link buttons, gallery (up to 3 images next to the main one), attached images, auto-delete
export function normalizeOptions(input = {}) {
	const o = input ?? {};
	const hours = Number(o.autoDeleteHours ?? 0);
	if (!Number.isInteger(hours) || hours < 0 || hours > 720) throw new ValidationError('Suppression automatique : de 0 à 720 heures.');
	const reactions = [...new Set((Array.isArray(o.reactions) ? o.reactions : []).map(r => String(r).trim()).filter(Boolean))];
	if (reactions.length > 10) throw new ValidationError('10 réactions au maximum.');
	for (const r of reactions) if (!EMOJI.test(r)) throw new ValidationError(`Réaction invalide : ${r.slice(0, 20)}`);
	const buttons = (Array.isArray(o.buttons) ? o.buttons : []).map((b) => {
		const label = str(b?.label, 80).trim();
		if (!label) throw new ValidationError('Chaque bouton a besoin d’un texte.');
		if (!HTTPS_URL.test(b?.url ?? '')) throw new ValidationError(`Bouton « ${label} » : une adresse en https:// est attendue.`);
		const emoji = String(b?.emoji ?? '').trim();
		if (emoji && !EMOJI.test(emoji)) throw new ValidationError(`Bouton « ${label} » : émoji invalide.`);
		return { label, url: b.url.slice(0, 512), emoji: emoji || null };
	});
	if (buttons.length > 5) throw new ValidationError('5 boutons au maximum.');
	const gallery = (Array.isArray(o.gallery) ? o.gallery : []).filter(Boolean).map(v => image(v, 'Galerie'));
	if (gallery.length > 3) throw new ValidationError('La galerie compte 3 images en plus de l’image principale.');
	const attachments = (Array.isArray(o.attachments) ? o.attachments : []).filter(Boolean).map((v) => {
		if (!UPLOAD.test(v)) throw new ValidationError('Pièces jointes : seulement des images envoyées depuis le panel.');
		return v;
	});
	const thread = o.thread ?? {};
	return {
		autoDeleteHours: hours,
		pin: Boolean(o.pin),
		thread: { enabled: Boolean(thread.enabled), name: str(thread.name, 100).trim() },
		reactions,
		buttons,
		gallery,
		attachments,
	};
}

// Every image of an announcement that comes from the panel
function uploadRefs(payload, options) {
	const e = payload.embed;
	return [e.imageUrl, e.thumbnailUrl, e.authorIconUrl, e.footerIconUrl, ...options.gallery, ...options.attachments].filter(v => v && UPLOAD.test(v));
}

function dateText(at, timeZone = DEFAULT_TIME_ZONE) {
	return new Date(at).toLocaleDateString('fr-FR', { timeZone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export function createAnnouncements({ db, network, audit, executor, logs, uploads = null, logger = console, now = Date.now, variables = createVariables({ executor, logger, now }) }) {
	logs.registerCategory('announcements', 'Annonces envoyées');

	const q = {
		insert: db.prepare(`
			INSERT INTO announcements (name, payload, targets, options, recurrence, status, scheduled_at, created_by, created_at, updated_at)
			VALUES (@name, @payload, @targets, @options, NULL, @status, @scheduledAt, @createdBy, @at, @at)
		`),
		update: db.prepare('UPDATE announcements SET name = @name, payload = @payload, targets = @targets, options = @options, updated_at = @at WHERE id = @id'),
		status: db.prepare('UPDATE announcements SET status = ?, scheduled_at = ?, updated_at = ? WHERE id = ?'),
		schedule: db.prepare('UPDATE announcements SET status = \'scheduled\', scheduled_at = ?, recurrence = ?, updated_at = ? WHERE id = ?'),
		sent: db.prepare('UPDATE announcements SET status = @status, scheduled_at = @next, sent_at = @at, results = @results, run_count = run_count + 1, history = @history, updated_at = @at WHERE id = @id'),
		results: db.prepare('UPDATE announcements SET status = ?, results = ?, updated_at = ? WHERE id = ?'),
		claim: db.prepare('UPDATE announcements SET status = \'sending\', updated_at = ? WHERE id = ? AND status IN (\'draft\', \'scheduled\', \'failed\')'),
		get: db.prepare('SELECT * FROM announcements WHERE id = ?'),
		delete: db.prepare('DELETE FROM announcements WHERE id = ?'),
		due: db.prepare('SELECT id FROM announcements WHERE status = \'scheduled\' AND scheduled_at <= ?'),
		planned: db.prepare('SELECT * FROM announcements WHERE status = \'scheduled\' AND scheduled_at <= ?'),
		addDeletion: db.prepare('INSERT INTO scheduled_deletions (channel_id, message_id, delete_at, source) VALUES (?, ?, ?, ?)'),
		dueDeletions: db.prepare('SELECT * FROM scheduled_deletions WHERE delete_at <= ? LIMIT 50'),
		dropDeletion: db.prepare('DELETE FROM scheduled_deletions WHERE id = ?'),
		templates: db.prepare('SELECT * FROM announcement_templates ORDER BY name COLLATE NOCASE'),
		template: db.prepare('SELECT * FROM announcement_templates WHERE id = ?'),
		addTemplate: db.prepare('INSERT INTO announcement_templates (name, payload, options, targets, created_by, created_at) VALUES (@name, @payload, @options, @targets, @createdBy, @at)'),
		dropTemplate: db.prepare('DELETE FROM announcement_templates WHERE id = ?'),
	};
	// Cut while sending (crash, restart): shown as failed so it can be sent again, instead of stuck forever
	db.prepare('UPDATE announcements SET status = \'failed\' WHERE status = \'sending\'').run();

	function toAnnouncement(row) {
		if (!row) return null;
		return {
			id: row.id,
			name: row.name,
			payload: JSON.parse(row.payload),
			targets: JSON.parse(row.targets),
			options: { ...DEFAULT_OPTIONS, ...JSON.parse(row.options ?? '{}') },
			recurrence: row.recurrence ? JSON.parse(row.recurrence) : null,
			runCount: row.run_count ?? 0,
			history: JSON.parse(row.history ?? '[]'),
			status: row.status,
			scheduledAt: row.scheduled_at,
			sentAt: row.sent_at,
			results: row.results ? JSON.parse(row.results) : null,
			createdBy: row.created_by,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}

	function toTemplate(row) {
		return { id: row.id, name: row.name, payload: JSON.parse(row.payload), options: { ...DEFAULT_OPTIONS, ...JSON.parse(row.options) }, targets: JSON.parse(row.targets), createdBy: row.created_by, createdAt: row.created_at };
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

	// Payload and options checked together: panel images must exist, 10 at most
	function clean(payload, options) {
		const p = normalizePayload(payload, { uploads: true });
		const o = normalizeOptions(options);
		const refs = uploadRefs(p, o);
		if (new Set(refs).size > MAX_IMAGES) throw new ValidationError(`${MAX_IMAGES} images envoyées au maximum par annonce.`);
		for (const ref of refs) if (uploads && !uploads.exists(ref.slice(7))) throw new ValidationError('Une des images envoyées n’existe plus : renvoie-la.');
		return { payload: p, options: o };
	}

	function validateName(name) {
		if (typeof name !== 'string' || !name.trim() || name.length > 100) throw new ValidationError('Le nom de l’annonce fait 1 à 100 caractères.');
		return name.trim();
	}

	function record(actor, action, a, details = {}) {
		audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action, target: String(a.id), details: { name: a.name, ...details } });
	}

	// Panel images become attached files ("attachment://<name>"), variables are filled for the server
	async function render(a, target, guildCache) {
		if (!guildCache.has(target.guildId)) guildCache.set(target.guildId, await variables.server(target.guildId));
		const vars = { ...guildCache.get(target.guildId), date: dateText(now(), a.recurrence?.timeZone) };
		const files = new Map();
		const swap = (value) => {
			if (!value || !UPLOAD.test(value)) return value;
			const id = value.slice(7);
			files.set(id, uploads ? uploads.file(id) : id);
			return `attachment://${id}`;
		};
		const f = value => (typeof value === 'string' ? fillVars(value, vars) : value);
		const e = a.payload.embed;
		const payload = {
			content: f(a.payload.content),
			embed: {
				...e,
				title: f(e.title), description: f(e.description), authorName: f(e.authorName), footerText: f(e.footerText),
				imageUrl: swap(e.imageUrl), thumbnailUrl: swap(e.thumbnailUrl), authorIconUrl: swap(e.authorIconUrl), footerIconUrl: swap(e.footerIconUrl),
				fields: e.fields.map(field => ({ ...field, name: f(field.name), value: f(field.value) })),
			},
		};
		const options = { ...a.options, gallery: a.options.gallery.map(swap), attachments: a.options.attachments.map(swap), thread: { ...a.options.thread, name: f(a.options.thread.name) } };
		return { payload, options, files: [...files].map(([name, attachment]) => ({ name, attachment })) };
	}

	async function deliver(id, actor) {
		if (!q.claim.run(now(), id).changes) throw new ValidationError('Cette annonce est déjà envoyée ou en cours d’envoi.');
		try {
			return await sendClaimed(id, actor);
		}
		catch (error) {
			// Never left « sending »: it could not be sent again
			db.prepare('UPDATE announcements SET status = \'failed\', updated_at = ? WHERE id = ? AND status = \'sending\'').run(now(), id);
			throw error;
		}
	}

	async function sendClaimed(id, actor) {
		const a = getOrThrow(id);
		const results = [];
		const guildCache = new Map();
		for (const target of a.targets) {
			try {
				const { payload, options, files } = await render(a, target, guildCache);
				const messageId = await executor.sendAnnouncement(target.channelId, payload, target, { ...options, files });
				if (a.options.autoDeleteHours) q.addDeletion.run(target.channelId, messageId, now() + a.options.autoDeleteHours * 3_600_000, `announcement:${id}`);
				results.push({ ...target, ok: true, messageId });
			}
			catch (error) {
				logger.warn(`Announcement #${id} not sent to ${target.channelId}:`, error.message);
				results.push({ ...target, ok: false, error: error.message });
			}
		}
		const okCount = results.filter(r => r.ok).length;
		const runs = a.runCount + 1;
		// Recurring: planned again for its next date while the series goes on
		const next = a.recurrence && a.scheduledAt ? nextOccurrence(a.recurrence, Math.max(now(), a.scheduledAt), { previous: a.scheduledAt, runs }) : null;
		const status = next ? 'scheduled' : okCount === results.length ? 'sent' : okCount ? 'partial' : 'failed';
		const history = [{ at: now(), ok: okCount, total: results.length }, ...a.history].slice(0, 30);
		q.sent.run({ id, status, next, at: now(), results: JSON.stringify(results), history: JSON.stringify(history) });
		const sent = getOrThrow(id);
		record(actor, 'announcements.send', sent, {
			channels: results.map(r => `<#${r.channelId}> ${r.ok ? '✓' : `✗ ${r.error}`}`),
			...(next ? { next: new Date(next).toISOString() } : {}),
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

		async create(actor, { name, payload, targets, options }) {
			requireManage(actor);
			const c = { name: validateName(name), ...clean(payload, options), targets: normalizeTargets(targets ?? []) };
			if (c.targets.length) await checkTargets(actor, c.targets);
			const id = Number(q.insert.run({
				name: c.name, payload: JSON.stringify(c.payload), targets: JSON.stringify(c.targets), options: JSON.stringify(c.options),
				status: 'draft', scheduledAt: null, createdBy: actor.id, at: now(),
			}).lastInsertRowid);
			const a = getOrThrow(id);
			record(actor, 'announcements.create', a);
			return a;
		},

		async update(actor, id, { name, payload, targets, options }) {
			requireManage(actor);
			const current = getOrThrow(id);
			if (!EDITABLE.has(current.status)) throw new ValidationError('Une annonce déjà envoyée ne se modifie plus : duplique-la.');
			const c = {
				name: name === undefined ? current.name : validateName(name),
				...clean(payload === undefined ? current.payload : payload, options === undefined ? current.options : options),
				targets: targets === undefined ? current.targets : normalizeTargets(targets),
			};
			if (c.targets.length) await checkTargets(actor, c.targets);
			q.update.run({ id, name: c.name, payload: JSON.stringify(c.payload), targets: JSON.stringify(c.targets), options: JSON.stringify(c.options), at: now() });
			return getOrThrow(id);
		},

		async send(actor, id) {
			requireManage(actor);
			const a = getOrThrow(id);
			await checkTargets(actor, a.targets);
			return deliver(id, actor);
		},

		// `at`: first send (for a recurrence, optional: its next date is used). `recurrence`: see recurrence.js, null = once.
		async schedule(actor, id, at, recurrenceInput = null) {
			requireManage(actor);
			const a = getOrThrow(id);
			if (!EDITABLE.has(a.status)) throw new ValidationError('Cette annonce est déjà envoyée.');
			const recurrence = normalizeRecurrence(recurrenceInput);
			const first = at ?? (recurrence ? nextOccurrence(recurrence, now() + 30_000) : null);
			if (!Number.isInteger(first) || first < now() + 30_000) throw new ValidationError('Choisis une date dans le futur (au moins 30 secondes).');
			if (recurrence?.endAt && recurrence.endAt < first) throw new ValidationError('La date de fin est avant le premier envoi.');
			await checkTargets(actor, a.targets);
			q.schedule.run(first, recurrence ? JSON.stringify(recurrence) : null, now(), id);
			const scheduled = getOrThrow(id);
			record(actor, 'announcements.schedule', scheduled, { at: new Date(first).toISOString(), ...(recurrence ? { recurrence: recurrence.type } : {}) });
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
				name: `${a.name} (copie)`.slice(0, 100), payload: JSON.stringify(a.payload), targets: JSON.stringify(a.targets), options: JSON.stringify(a.options),
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

		// Planned sends between two dates, recurring ones expanded
		calendar(from, to) {
			return q.planned.all(to).flatMap((row) => {
				const a = toAnnouncement(row);
				return occurrences(a.recurrence, a.scheduledAt, from, to, { runs: a.runCount }).map(at => ({ id: a.id, name: a.name, at, color: a.payload.embed.color, recurring: Boolean(a.recurrence) }));
			}).sort((x, y) => x.at - y.at);
		},

		// --- Templates -----------------------------------------------------------------------------
		templates: () => q.templates.all().map(toTemplate),

		saveTemplate(actor, { name, payload, options, targets }) {
			requireManage(actor);
			const c = { name: validateName(name), ...clean(payload, options), targets: normalizeTargets(targets ?? []) };
			const id = Number(q.addTemplate.run({ name: c.name, payload: JSON.stringify(c.payload), options: JSON.stringify(c.options), targets: JSON.stringify(c.targets), createdBy: actor.id, at: now() }).lastInsertRowid);
			audit.record({ actorId: actor.id, source: 'panel', action: 'announcements.template', target: String(id), details: { name: c.name } });
			return toTemplate(q.template.get(id));
		},

		deleteTemplate(actor, id) {
			requireManage(actor);
			const row = q.template.get(id);
			if (!row) throw new NotFoundError('Modèle introuvable.');
			q.dropTemplate.run(id);
			audit.record({ actorId: actor.id, source: 'panel', action: 'announcements.template_delete', target: String(id), details: { name: row.name } });
		},

		// Scheduler: announcements whose date has come, messages to delete
		async sendDue() {
			const system = { id: 'system', source: 'system', isOwner: true, can: () => true };
			const due = q.due.all(now());
			for (const { id } of due) await deliver(id, system).catch(error => logger.error(`Scheduled announcement #${id} failed:`, error));
			for (const d of q.dueDeletions.all(now())) {
				await executor.deleteMessage(d.channel_id, d.message_id).catch(error => logger.warn(`Auto-delete of ${d.message_id} failed:`, error.message));
				q.dropDeletion.run(d.id);
			}
			return due.length;
		},
	};
}
