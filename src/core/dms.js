import { definePermission } from './permissions.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';

definePermission('dm.view', { label: 'Lire les messages privés reçus par le bot', category: 'Messages privés' });
definePermission('dm.send', { label: 'Écrire en MP via le bot et répondre aux conversations', category: 'Messages privés' });
definePermission('dm.manage', { label: 'Régler les MP (premier contact, modèles, liste noire)', category: 'Messages privés' });

const SNOWFLAKE = /^\d{17,20}$/;
const UPLOAD = /^upload:[a-f0-9]{32}\.(png|jpg|webp|gif)$/;
export const DEFAULT_DM_CONFIG = {
	modmail: false,
	greeting: 'Bonjour ! Ton message a bien été transmis à l’équipe Brothers Life, on te répond ici dès que possible.',
	notify: null,
	signature: 'Équipe Brothers Life',
};

export function normalizeDmConfig(input = {}) {
	const notify = input.notify ?? null;
	return {
		modmail: Boolean(input.modmail),
		greeting: String(input.greeting ?? DEFAULT_DM_CONFIG.greeting).slice(0, 1500),
		notify: notify && SNOWFLAKE.test(notify.guildId ?? '') && SNOWFLAKE.test(notify.channelId ?? '') ? { guildId: notify.guildId, channelId: notify.channelId } : null,
		signature: String(input.signature ?? DEFAULT_DM_CONFIG.signature).trim().slice(0, 80) || DEFAULT_DM_CONFIG.signature,
	};
}

// Conversations in private messages between the staff (from the panel) and a person, through the bot
export function createDms({ db, audit, executor, settings, logs, uploads = null, logger = console, now = Date.now }) {
	logs.registerCategory('dm', 'Messages privés via le bot');
	const listeners = new Set();

	const q = {
		thread: db.prepare('SELECT * FROM dm_threads WHERE id = ?'),
		threadOf: db.prepare('SELECT * FROM dm_threads WHERE user_id = ?'),
		insertThread: db.prepare('INSERT INTO dm_threads (user_id, user_name, started_by, last_message_at, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING'),
		touch: db.prepare('UPDATE dm_threads SET last_message_at = ?, unread = unread + ?, user_name = COALESCE(?, user_name) WHERE id = ?'),
		setStatus: db.prepare('UPDATE dm_threads SET status = ? WHERE id = ?'),
		reopen: db.prepare('UPDATE dm_threads SET status = \'open\' WHERE id = ? AND status = \'closed\''),
		assign: db.prepare('UPDATE dm_threads SET assigned_to = ? WHERE id = ?'),
		read: db.prepare('UPDATE dm_threads SET unread = 0 WHERE id = ?'),
		dmsClosed: db.prepare('UPDATE dm_threads SET dms_closed = ? WHERE id = ?'),
		insertMessage: db.prepare('INSERT INTO dm_messages (thread_id, direction, author_id, content, attachments, discord_message_id, at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
		message: db.prepare('SELECT * FROM dm_messages WHERE id = ?'),
		messages: db.prepare('SELECT * FROM dm_messages WHERE thread_id = ? ORDER BY id DESC LIMIT ?'),
		last: db.prepare('SELECT content, direction FROM dm_messages WHERE thread_id = ? AND direction IN (\'in\', \'out\') ORDER BY id DESC LIMIT 1'),
		blocked: db.prepare('SELECT * FROM dm_blocklist WHERE user_id = ?'),
		blocklist: db.prepare('SELECT * FROM dm_blocklist ORDER BY at DESC, user_id'),
		block: db.prepare('INSERT INTO dm_blocklist (user_id, reason, blocked_by, at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET reason = EXCLUDED.reason, blocked_by = EXCLUDED.blocked_by, at = EXCLUDED.at'),
		unblock: db.prepare('DELETE FROM dm_blocklist WHERE user_id = ?'),
		snippets: db.prepare('SELECT * FROM dm_snippets ORDER BY lower(name), id'),
		snippet: db.prepare('SELECT * FROM dm_snippets WHERE id = ?'),
		addSnippet: db.prepare('INSERT INTO dm_snippets (name, content, created_by, created_at) VALUES (?, ?, ?, ?)'),
		updateSnippet: db.prepare('UPDATE dm_snippets SET name = ?, content = ? WHERE id = ?'),
		dropSnippet: db.prepare('DELETE FROM dm_snippets WHERE id = ?'),
	};

	async function toThread(row) {
		if (!row) return null;
		const last = await q.last.get(row.id);
		return {
			id: row.id, userId: row.user_id, userName: row.user_name, status: row.status, assignedTo: row.assigned_to, unread: row.unread,
			dmsClosed: Boolean(row.dms_closed), startedBy: row.started_by, lastMessageAt: row.last_message_at, createdAt: row.created_at,
			lastMessage: last ? { content: last.content.slice(0, 140), direction: last.direction } : null,
			blocked: Boolean(await q.blocked.get(row.user_id)),
		};
	}

	function toMessage(row) {
		return { id: row.id, threadId: row.thread_id, direction: row.direction, authorId: row.author_id, content: row.content, attachments: JSON.parse(row.attachments), discordMessageId: row.discord_message_id, at: row.at };
	}

	async function getOrThrow(id) {
		const t = await toThread(await q.thread.get(id));
		if (!t) throw new NotFoundError('Conversation introuvable.');
		return t;
	}

	function need(actor, permission) {
		if (!actor.can(permission)) throw new ForbiddenError(`Permission manquante : ${permission}`);
	}

	function emit(event) {
		for (const listener of listeners) {
			try {
				listener(event);
			}
			catch (error) {
				logger.warn('DM listener failed:', error.message);
			}
		}
	}

	async function config() {
		return normalizeDmConfig(await settings.get('dm.config', DEFAULT_DM_CONFIG));
	}

	async function add(threadId, direction, authorId, content, attachments = [], discordMessageId = null, { unread = 0, userName = null } = {}) {
		const id = Number((await q.insertMessage.run(threadId, direction, authorId, content, JSON.stringify(attachments), discordMessageId, now())).lastInsertRowid);
		if (direction !== 'note') await q.touch.run(now(), unread, userName, threadId);
		const message = toMessage(await q.message.get(id));
		emit({ type: 'message', message, thread: await getOrThrow(threadId) });
		return message;
	}

	// { id, created }: two first messages at the same time create only one conversation (user_id is unique)
	async function threadFor(userId, userName, startedBy) {
		const existing = await q.threadOf.get(userId);
		if (existing) return { id: existing.id, created: false };
		const { changes } = await q.insertThread.run(userId, userName ?? null, startedBy, now(), now());
		return { id: (await q.threadOf.get(userId)).id, created: changes > 0 };
	}

	async function record(actor, action, thread, details = {}) {
		await audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action, target: thread.userId, details: { conversation: thread.id, ...details } });
	}

	const service = {
		config,

		async setConfig(actor, input) {
			need(actor, 'dm.manage');
			const c = normalizeDmConfig(input);
			await settings.set('dm.config', c);
			await audit.record({ actorId: actor.id, source: 'panel', action: 'dm.config', target: 'dm', details: { modmail: c.modmail } });
			return c;
		},

		async threads({ status = null, assignedTo = null, limit = 200 } = {}) {
			const where = [status && 'status = @status', assignedTo && 'assigned_to = @assignedTo'].filter(Boolean);
			const rows = await db.prepare(`SELECT * FROM dm_threads ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY last_message_at DESC, id DESC LIMIT @limit`)
				.all({ status, assignedTo, limit });
			return Promise.all(rows.map(toThread));
		},

		get: getOrThrow,
		messages: async (threadId, limit = 300) => (await q.messages.all(threadId, limit)).map(toMessage).reverse(),
		unreadCount: async () => (await db.prepare('SELECT COALESCE(SUM(unread), 0) AS n FROM dm_threads WHERE status = \'open\'').get()).n,

		// Conversation with someone, created if needed (before writing to them for the first time)
		async open(actor, userId, userName = null) {
			need(actor, 'dm.send');
			if (!SNOWFLAKE.test(userId)) throw new ValidationError('Membre invalide.');
			const { id } = await threadFor(userId, userName, actor.id);
			if ((await q.thread.get(id)).status === 'closed') await q.setStatus.run('open', id);
			return await getOrThrow(id);
		},

		// Message from the staff; `signed`: with the author's name instead of the team signature
		async send(actor, threadId, { content = '', attachments = [], signed = false, authorName = null }) {
			need(actor, 'dm.send');
			const thread = await getOrThrow(threadId);
			if (thread.blocked) throw new ValidationError('Cette personne est sur la liste noire des MP.');
			const text = String(content).trim();
			const files = (Array.isArray(attachments) ? attachments : []).slice(0, 5);
			for (const f of files) if (!UPLOAD.test(f) || (uploads && !await uploads.exists(f.slice(7)))) throw new ValidationError('Pièce jointe invalide : renvoie l’image.');
			if (!text && !files.length) throw new ValidationError('Le message est vide.');
			if (text.length > 1800) throw new ValidationError('Message trop long (1 800 caractères au maximum).');
			const signature = signed && authorName ? authorName : (await config()).signature;
			const attached = await Promise.all(files.map(async f => ({ name: f.slice(7), attachment: uploads ? await uploads.read(f.slice(7)) : f })));
			let messageId;
			try {
				messageId = await executor.sendDirect(thread.userId, {
					content: `${text}${text ? '\n\n' : ''}-# — ${signature}`,
					files: attached,
				});
			}
			catch (error) {
				if (error.code === 'DMS_CLOSED') {
					await q.dmsClosed.run(1, thread.id);
					emit({ type: 'thread', thread: await getOrThrow(thread.id) });
					throw new ValidationError('Impossible de lui écrire : ses messages privés sont fermés (ou vous n’avez plus de serveur en commun).');
				}
				throw error;
			}
			await q.dmsClosed.run(0, thread.id);
			if (thread.status === 'closed') await q.setStatus.run('open', thread.id);
			const message = await add(thread.id, 'out', actor.id, text, files.map(f => ({ name: f.slice(7), url: f })), messageId);
			await record(actor, 'dm.send', thread, { text: text.slice(0, 300) });
			return message;
		},

		// Message received by the bot in DM. Returns the conversation, or null when ignored.
		async receive({ userId, userName = null, content = '', attachments = [], messageId = null }) {
			if (await q.blocked.get(userId)) return null;
			const existing = await q.threadOf.get(userId);
			const c = await config();
			if (!existing && !c.modmail) return null;
			if (existing?.status === 'closed' && !c.modmail) return null;
			// Created or reopened by this message only (conditional writes: two messages at once greet once)
			const { id, created } = existing ? { id: existing.id, created: false } : await threadFor(userId, userName, 'user');
			const reopened = existing?.status === 'closed' && (await q.reopen.run(id)).changes > 0;
			await add(id, 'in', userId, String(content).slice(0, 4000), attachments.slice(0, 10), messageId, { unread: 1, userName });
			// First contact (or back after being closed): welcome message and staff notification
			if (created || reopened) {
				if (c.modmail && c.greeting) {
					const greetingId = await executor.sendDirect(userId, { content: `${c.greeting}\n\n-# — ${c.signature}` }).catch(() => null);
					if (greetingId) await add(id, 'system', 'bot', c.greeting, [], greetingId);
				}
				if (c.notify) {
					await executor.sendMessage(c.notify.channelId, { payload: { content: `📨 Nouveau message privé de <@${userId}> (${userName ?? userId}) : à traiter dans le panel, page « Messages privés ».`, embed: { enabled: false } } })
						.catch(error => logger.warn('DM notification failed:', error.message));
				}
				await audit.record({ actorId: userId, source: 'bot', action: 'dm.received', target: userId, details: { conversation: id, first: created } });
			}
			return await getOrThrow(id);
		},

		async markRead(actor, id) {
			need(actor, 'dm.view');
			await q.read.run(id);
			const thread = await getOrThrow(id);
			emit({ type: 'thread', thread });
			return thread;
		},

		async assign(actor, id, userId) {
			need(actor, 'dm.send');
			if (userId !== null && !SNOWFLAKE.test(userId)) throw new ValidationError('Membre invalide.');
			const thread = await getOrThrow(id);
			await q.assign.run(userId, id);
			await record(actor, 'dm.assign', thread, { to: userId ? `<@${userId}>` : 'personne' });
			const updated = await getOrThrow(id);
			emit({ type: 'thread', thread: updated });
			return updated;
		},

		async setStatus(actor, id, status) {
			need(actor, 'dm.send');
			if (!['open', 'closed'].includes(status)) throw new ValidationError('Statut invalide.');
			const thread = await getOrThrow(id);
			await q.setStatus.run(status, id);
			if (status === 'closed') await q.read.run(id);
			await add(id, 'note', actor.id, status === 'closed' ? 'Conversation fermée.' : 'Conversation rouverte.');
			await record(actor, status === 'closed' ? 'dm.close' : 'dm.reopen', thread);
			return await getOrThrow(id);
		},

		async addNote(actor, id, text) {
			need(actor, 'dm.view');
			const note = String(text ?? '').trim();
			if (!note || note.length > 1000) throw new ValidationError('La note fait 1 à 1 000 caractères.');
			await getOrThrow(id);
			return await add(id, 'note', actor.id, note);
		},

		// --- Block list -------------------------------------------------------------------------------
		blocklist: async () => (await q.blocklist.all()).map(r => ({ userId: r.user_id, reason: r.reason, blockedBy: r.blocked_by, at: r.at })),

		async block(actor, userId, reason = '') {
			need(actor, 'dm.manage');
			if (!SNOWFLAKE.test(userId)) throw new ValidationError('Membre invalide.');
			await q.block.run(userId, String(reason).slice(0, 300) || null, actor.id, now());
			await audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'dm.block', target: userId, details: { reason } });
			const thread = await q.threadOf.get(userId);
			if (thread) emit({ type: 'thread', thread: await getOrThrow(thread.id) });
		},

		async unblock(actor, userId) {
			need(actor, 'dm.manage');
			await q.unblock.run(userId);
			await audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'dm.unblock', target: userId, details: {} });
		},

		// --- Quick replies ------------------------------------------------------------------------------
		snippets: async () => (await q.snippets.all()).map(r => ({ id: r.id, name: r.name, content: r.content })),

		async saveSnippet(actor, { id = null, name, content }) {
			need(actor, 'dm.manage');
			const n = String(name ?? '').trim();
			const text = String(content ?? '').trim();
			if (!n || n.length > 60) throw new ValidationError('Le nom fait 1 à 60 caractères.');
			if (!text || text.length > 1800) throw new ValidationError('Le texte fait 1 à 1 800 caractères.');
			if (id) {
				if (!await q.snippet.get(id)) throw new NotFoundError('Modèle introuvable.');
				await q.updateSnippet.run(n, text, id);
				return { id, name: n, content: text };
			}
			return { id: Number((await q.addSnippet.run(n, text, actor.id, now())).lastInsertRowid), name: n, content: text };
		},

		async deleteSnippet(actor, id) {
			need(actor, 'dm.manage');
			await q.dropSnippet.run(id);
		},

		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
	return service;
}
