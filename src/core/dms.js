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
		insertThread: db.prepare('INSERT INTO dm_threads (user_id, user_name, started_by, last_message_at, created_at) VALUES (?, ?, ?, ?, ?)'),
		touch: db.prepare('UPDATE dm_threads SET last_message_at = ?, unread = unread + ?, user_name = COALESCE(?, user_name) WHERE id = ?'),
		setStatus: db.prepare('UPDATE dm_threads SET status = ? WHERE id = ?'),
		assign: db.prepare('UPDATE dm_threads SET assigned_to = ? WHERE id = ?'),
		read: db.prepare('UPDATE dm_threads SET unread = 0 WHERE id = ?'),
		dmsClosed: db.prepare('UPDATE dm_threads SET dms_closed = ? WHERE id = ?'),
		insertMessage: db.prepare('INSERT INTO dm_messages (thread_id, direction, author_id, content, attachments, discord_message_id, at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
		message: db.prepare('SELECT * FROM dm_messages WHERE id = ?'),
		messages: db.prepare('SELECT * FROM dm_messages WHERE thread_id = ? ORDER BY id DESC LIMIT ?'),
		last: db.prepare('SELECT content, direction FROM dm_messages WHERE thread_id = ? AND direction IN (\'in\', \'out\') ORDER BY id DESC LIMIT 1'),
		blocked: db.prepare('SELECT * FROM dm_blocklist WHERE user_id = ?'),
		blocklist: db.prepare('SELECT * FROM dm_blocklist ORDER BY at DESC'),
		block: db.prepare('INSERT INTO dm_blocklist (user_id, reason, blocked_by, at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET reason = excluded.reason, blocked_by = excluded.blocked_by, at = excluded.at'),
		unblock: db.prepare('DELETE FROM dm_blocklist WHERE user_id = ?'),
		snippets: db.prepare('SELECT * FROM dm_snippets ORDER BY name COLLATE NOCASE'),
		snippet: db.prepare('SELECT * FROM dm_snippets WHERE id = ?'),
		addSnippet: db.prepare('INSERT INTO dm_snippets (name, content, created_by, created_at) VALUES (?, ?, ?, ?)'),
		updateSnippet: db.prepare('UPDATE dm_snippets SET name = ?, content = ? WHERE id = ?'),
		dropSnippet: db.prepare('DELETE FROM dm_snippets WHERE id = ?'),
	};

	function toThread(row) {
		if (!row) return null;
		const last = q.last.get(row.id);
		return {
			id: row.id, userId: row.user_id, userName: row.user_name, status: row.status, assignedTo: row.assigned_to, unread: row.unread,
			dmsClosed: Boolean(row.dms_closed), startedBy: row.started_by, lastMessageAt: row.last_message_at, createdAt: row.created_at,
			lastMessage: last ? { content: last.content.slice(0, 140), direction: last.direction } : null,
			blocked: Boolean(q.blocked.get(row.user_id)),
		};
	}

	function toMessage(row) {
		return { id: row.id, threadId: row.thread_id, direction: row.direction, authorId: row.author_id, content: row.content, attachments: JSON.parse(row.attachments), discordMessageId: row.discord_message_id, at: row.at };
	}

	function getOrThrow(id) {
		const t = toThread(q.thread.get(id));
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

	function config() {
		return normalizeDmConfig(settings.get('dm.config', DEFAULT_DM_CONFIG));
	}

	function add(threadId, direction, authorId, content, attachments = [], discordMessageId = null, { unread = 0, userName = null } = {}) {
		const id = Number(q.insertMessage.run(threadId, direction, authorId, content, JSON.stringify(attachments), discordMessageId, now()).lastInsertRowid);
		if (direction !== 'note') q.touch.run(now(), unread, userName, threadId);
		const message = toMessage(q.message.get(id));
		emit({ type: 'message', message, thread: getOrThrow(threadId) });
		return message;
	}

	function threadFor(userId, userName, startedBy) {
		const existing = q.threadOf.get(userId);
		if (existing) return existing.id;
		return Number(q.insertThread.run(userId, userName ?? null, startedBy, now(), now()).lastInsertRowid);
	}

	function record(actor, action, thread, details = {}) {
		audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action, target: thread.userId, details: { conversation: thread.id, ...details } });
	}

	const service = {
		config,

		setConfig(actor, input) {
			need(actor, 'dm.manage');
			const c = normalizeDmConfig(input);
			settings.set('dm.config', c);
			audit.record({ actorId: actor.id, source: 'panel', action: 'dm.config', target: 'dm', details: { modmail: c.modmail } });
			return c;
		},

		threads({ status = null, assignedTo = null, limit = 200 } = {}) {
			const where = [status && 'status = @status', assignedTo && 'assigned_to = @assignedTo'].filter(Boolean);
			return db.prepare(`SELECT * FROM dm_threads ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY last_message_at DESC LIMIT @limit`)
				.all({ status, assignedTo, limit }).map(toThread);
		},

		get: getOrThrow,
		messages: (threadId, limit = 300) => q.messages.all(threadId, limit).map(toMessage).reverse(),
		unreadCount: () => db.prepare('SELECT COALESCE(SUM(unread), 0) AS n FROM dm_threads WHERE status = \'open\'').get().n,

		// Conversation with someone, created if needed (before writing to them for the first time)
		open(actor, userId, userName = null) {
			need(actor, 'dm.send');
			if (!SNOWFLAKE.test(userId)) throw new ValidationError('Membre invalide.');
			const id = threadFor(userId, userName, actor.id);
			if (q.thread.get(id).status === 'closed') q.setStatus.run('open', id);
			return getOrThrow(id);
		},

		// Message from the staff; `signed`: with the author's name instead of the team signature
		async send(actor, threadId, { content = '', attachments = [], signed = false, authorName = null }) {
			need(actor, 'dm.send');
			const thread = getOrThrow(threadId);
			if (thread.blocked) throw new ValidationError('Cette personne est sur la liste noire des MP.');
			const text = String(content).trim();
			const files = (Array.isArray(attachments) ? attachments : []).slice(0, 5);
			for (const f of files) if (!UPLOAD.test(f) || (uploads && !uploads.exists(f.slice(7)))) throw new ValidationError('Pièce jointe invalide : renvoie l’image.');
			if (!text && !files.length) throw new ValidationError('Le message est vide.');
			if (text.length > 1800) throw new ValidationError('Message trop long (1 800 caractères au maximum).');
			const signature = signed && authorName ? authorName : config().signature;
			let messageId;
			try {
				messageId = await executor.sendDirect(thread.userId, {
					content: `${text}${text ? '\n\n' : ''}-# — ${signature}`,
					files: files.map(f => ({ name: f.slice(7), attachment: uploads ? uploads.file(f.slice(7)) : f })),
				});
			}
			catch (error) {
				if (error.code === 'DMS_CLOSED') {
					q.dmsClosed.run(1, thread.id);
					emit({ type: 'thread', thread: getOrThrow(thread.id) });
					throw new ValidationError('Impossible de lui écrire : ses messages privés sont fermés (ou vous n’avez plus de serveur en commun).');
				}
				throw error;
			}
			q.dmsClosed.run(0, thread.id);
			if (thread.status === 'closed') q.setStatus.run('open', thread.id);
			const message = add(thread.id, 'out', actor.id, text, files.map(f => ({ name: f.slice(7), url: f })), messageId);
			record(actor, 'dm.send', thread, { text: text.slice(0, 300) });
			return message;
		},

		// Message received by the bot in DM. Returns the conversation, or null when ignored.
		async receive({ userId, userName = null, content = '', attachments = [], messageId = null }) {
			if (q.blocked.get(userId)) return null;
			const existing = q.threadOf.get(userId);
			const c = config();
			if (!existing && !c.modmail) return null;
			if (existing?.status === 'closed' && !c.modmail) return null;
			const id = existing?.id ?? threadFor(userId, userName, 'user');
			const reopened = existing?.status === 'closed';
			if (reopened) q.setStatus.run('open', id);
			add(id, 'in', userId, String(content).slice(0, 4000), attachments.slice(0, 10), messageId, { unread: 1, userName });
			// First contact (or back after being closed): welcome message and staff notification
			if (!existing || reopened) {
				if (c.modmail && c.greeting) {
					const greetingId = await executor.sendDirect(userId, { content: `${c.greeting}\n\n-# — ${c.signature}` }).catch(() => null);
					if (greetingId) add(id, 'system', 'bot', c.greeting, [], greetingId);
				}
				if (c.notify) {
					await executor.sendMessage(c.notify.channelId, { payload: { content: `📨 Nouveau message privé de <@${userId}> (${userName ?? userId}) : à traiter dans le panel, page « Messages privés ».`, embed: { enabled: false } } })
						.catch(error => logger.warn('DM notification failed:', error.message));
				}
				audit.record({ actorId: userId, source: 'bot', action: 'dm.received', target: userId, details: { conversation: id, first: !existing } });
			}
			return getOrThrow(id);
		},

		markRead(actor, id) {
			need(actor, 'dm.view');
			q.read.run(id);
			const thread = getOrThrow(id);
			emit({ type: 'thread', thread });
			return thread;
		},

		assign(actor, id, userId) {
			need(actor, 'dm.send');
			if (userId !== null && !SNOWFLAKE.test(userId)) throw new ValidationError('Membre invalide.');
			const thread = getOrThrow(id);
			q.assign.run(userId, id);
			record(actor, 'dm.assign', thread, { to: userId ? `<@${userId}>` : 'personne' });
			const updated = getOrThrow(id);
			emit({ type: 'thread', thread: updated });
			return updated;
		},

		setStatus(actor, id, status) {
			need(actor, 'dm.send');
			if (!['open', 'closed'].includes(status)) throw new ValidationError('Statut invalide.');
			const thread = getOrThrow(id);
			q.setStatus.run(status, id);
			if (status === 'closed') q.read.run(id);
			add(id, 'note', actor.id, status === 'closed' ? 'Conversation fermée.' : 'Conversation rouverte.');
			record(actor, status === 'closed' ? 'dm.close' : 'dm.reopen', thread);
			return getOrThrow(id);
		},

		addNote(actor, id, text) {
			need(actor, 'dm.view');
			const note = String(text ?? '').trim();
			if (!note || note.length > 1000) throw new ValidationError('La note fait 1 à 1 000 caractères.');
			getOrThrow(id);
			return add(id, 'note', actor.id, note);
		},

		// --- Block list -------------------------------------------------------------------------------
		blocklist: () => q.blocklist.all().map(r => ({ userId: r.user_id, reason: r.reason, blockedBy: r.blocked_by, at: r.at })),

		block(actor, userId, reason = '') {
			need(actor, 'dm.manage');
			if (!SNOWFLAKE.test(userId)) throw new ValidationError('Membre invalide.');
			q.block.run(userId, String(reason).slice(0, 300) || null, actor.id, now());
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'dm.block', target: userId, details: { reason } });
			const thread = q.threadOf.get(userId);
			if (thread) emit({ type: 'thread', thread: getOrThrow(thread.id) });
		},

		unblock(actor, userId) {
			need(actor, 'dm.manage');
			q.unblock.run(userId);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'dm.unblock', target: userId, details: {} });
		},

		// --- Quick replies ------------------------------------------------------------------------------
		snippets: () => q.snippets.all().map(r => ({ id: r.id, name: r.name, content: r.content })),

		saveSnippet(actor, { id = null, name, content }) {
			need(actor, 'dm.manage');
			const n = String(name ?? '').trim();
			const text = String(content ?? '').trim();
			if (!n || n.length > 60) throw new ValidationError('Le nom fait 1 à 60 caractères.');
			if (!text || text.length > 1800) throw new ValidationError('Le texte fait 1 à 1 800 caractères.');
			if (id) {
				if (!q.snippet.get(id)) throw new NotFoundError('Modèle introuvable.');
				q.updateSnippet.run(n, text, id);
				return { id, name: n, content: text };
			}
			return { id: Number(q.addSnippet.run(n, text, actor.id, now()).lastInsertRowid), name: n, content: text };
		},

		deleteSnippet(actor, id) {
			need(actor, 'dm.manage');
			q.dropSnippet.run(id);
		},

		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
	return service;
}
