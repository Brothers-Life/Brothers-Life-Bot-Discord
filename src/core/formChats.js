import { ValidationError } from './errors.js';
import { nextStep, readStep } from './forms.js';

// Forms filled as a conversation: the bot writes one question, waits for the answer of the member,
// then writes the next one. In private messages (channelId null) or in a channel (ticket, application).
// A question is then a whole message: none of the limits of a Discord modal.
// Each kind of form ('recruitment', 'ticket') registers what happens at the end.

const SKIP = /^passer$/i;
const CANCEL = /^annuler$/i;
const isText = question => question.type === 'short' || question.type === 'paragraph';

// One question as the bot writes it
export function chatQuestion(form, state) {
	const question = form.steps[state.step].questions[state.index];
	// With conditional steps the number of questions depends on the answers
	const total = form.steps.some(s => s.when) ? null : form.steps.reduce((n, s) => n + s.questions.length, 0);
	const lines = [`**Question ${state.answers.length + 1}${total ? `/${total}` : ''}** — ${question.label}`];
	if (question.description) lines.push(question.description);
	if (question.type === 'select') {
		lines.push(...question.options.map((o, i) => `\`${i + 1}\` ${o.label}${o.description ? ` — ${o.description}` : ''}`));
		lines.push(`-# Réponds par le numéro de ton choix${question.maxValues > 1 ? ` (jusqu’à ${question.maxValues}, séparés par des virgules)` : ''}.`);
	}
	else if (question.type === 'file') {
		lines.push(`-# Envoie ${question.maxValues > 1 ? `jusqu’à ${question.maxValues} fichiers` : 'ton fichier'} en pièce jointe.`);
	}
	else if (isText(question)) {
		if (question.placeholder) lines.push(`-# Exemple : ${question.placeholder}`);
		if (question.maxLength < 2000) lines.push(`-# ${question.maxLength} caractères max.`);
	}
	if (!question.required) lines.push('-# Facultatif : écris `passer` pour sauter cette question.');
	return lines.join('\n').slice(0, 2000);
}

// What the member wrote, as the values a modal would have given
export function chatValue(question, content, attachments = []) {
	const text = String(content ?? '').trim();
	if (!question.required && SKIP.test(text)) return isText(question) ? '' : [];
	if (question.type === 'file') {
		if (attachments.length > question.maxValues) throw new ValidationError(`${question.maxValues} fichier(s) au maximum.`);
		return attachments.map(a => a.url);
	}
	if (question.type === 'select') {
		const picked = [...new Set(text.split(/[\s,;]+/).filter(Boolean).map((part) => {
			const option = /^\d+$/.test(part) ? question.options[Number(part) - 1] : null;
			if (!option) throw new ValidationError(`Réponds par un numéro entre 1 et ${question.options.length}.`);
			return option.value;
		}))];
		if (picked.length > question.maxValues) throw new ValidationError(`${question.maxValues} choix au maximum.`);
		if (picked.length < question.minValues) throw new ValidationError(`Il faut au moins ${question.minValues} choix.`);
		return picked;
	}
	if (isText(question)) {
		if (text.length > question.maxLength) throw new ValidationError(`Ta réponse fait ${text.length} caractères, le maximum est ${question.maxLength}.`);
		if (text && text.length < question.minLength) throw new ValidationError(`Ta réponse doit faire au moins ${question.minLength} caractères.`);
		return text;
	}
	// Member, role or channel: written as text (a menu cannot be shown in a conversation)
	return text ? [text.slice(0, 200)] : [];
}

export function createFormChats({ db, executor, logger = console, now = Date.now }) {
	const q = {
		all: db.prepare('SELECT * FROM form_chats ORDER BY key'),
		save: db.prepare(`
			INSERT INTO form_chats (key, kind, user_id, channel_id, data, updated_at) VALUES (@key, @kind, @userId, @channelId, @data, @at)
			ON CONFLICT (key) DO UPDATE SET kind = EXCLUDED.kind, user_id = EXCLUDED.user_id, channel_id = EXCLUDED.channel_id, data = EXCLUDED.data, updated_at = EXCLUDED.updated_at
		`),
		delete: db.prepare('DELETE FROM form_chats WHERE key = ?'),
	};
	// key -> { key, kind, userId, channelId, meta, answers, step, index, at }
	const sessions = new Map();
	const handlers = new Map();
	const locks = new Map();

	const keyOf = (channelId, userId) => (channelId ? `c:${channelId}` : `u:${userId}`);
	const save = session => q.save.run({
		key: session.key, kind: session.kind, userId: session.userId, channelId: session.channelId, at: session.at,
		data: JSON.stringify({ meta: session.meta, answers: session.answers, step: session.step, index: session.index }),
	});
	async function drop(session) {
		if (sessions.get(session.key) === session) sessions.delete(session.key);
		await q.delete.run(session.key);
	}
	const say = (session, text) => (session.channelId
		? executor.sendMessage(session.channelId, { payload: { content: text } })
		: executor.sendDM(session.userId, text));
	const tell = (session, text) => (text ? say(session, text).catch(error => logger.warn(`Form message not sent (${session.key}):`, error.message)) : null);

	// Ends a conversation that will not be finished: 'cancel' (the member), 'expired', 'gone' (form deleted or changed)
	async function abandon(session, reason) {
		await drop(session);
		const text = await handlers.get(session.kind)?.cancelled?.(session, reason);
		await tell(session, text);
	}

	async function answer(session, content, attachments) {
		const handler = handlers.get(session.kind);
		if (!handler) return false;
		if (now() - session.at > handler.ttl) {
			await abandon(session, 'expired');
			return true;
		}
		if (handler.cancel && CANCEL.test(content.trim())) {
			await abandon(session, 'cancel');
			return true;
		}
		const form = await handler.form(session);
		const question = form?.steps[session.step]?.questions[session.index];
		if (!question) {
			await abandon(session, 'gone');
			return true;
		}
		try {
			session.answers.push(...readStep({ questions: [question] }, { [question.id]: chatValue(question, content, attachments) }));
		}
		catch (error) {
			if (!(error instanceof ValidationError)) throw error;
			session.at = now();
			await tell(session, `⚠️ ${error.message}`);
			return true;
		}
		session.at = now();
		session.index++;
		if (session.index >= form.steps[session.step].questions.length) {
			session.step = nextStep(form, session.step + 1, session.answers);
			session.index = 0;
		}
		if (session.step >= 0) {
			await save(session);
			await tell(session, chatQuestion(form, session));
			return true;
		}
		await drop(session);
		try {
			await tell(session, await handler.done(session, session.answers.map(({ id, label, type, value }) => ({ id, label, type, value }))));
		}
		catch (error) {
			if (!error?.status || error.status >= 500) throw error;
			await tell(session, `Impossible : ${error.message}`);
		}
		return true;
	}

	return {
		// handler: { ttl, cancel, form(session) -> form | null, done(session, answers) -> text, cancelled(session, reason) -> text }
		register(kind, handler) {
			handlers.set(kind, handler);
		},

		// Conversations in progress survive a restart of the bot
		async init() {
			for (const row of await q.all.all()) {
				const data = JSON.parse(row.data);
				sessions.set(row.key, { key: row.key, kind: row.kind, userId: row.user_id, channelId: row.channel_id, meta: data.meta ?? {}, answers: data.answers ?? [], step: data.step, index: data.index, at: Number(row.updated_at) });
			}
		},

		// Writes the intro and the first question. Throws when the message cannot be sent
		// (private messages closed); returns null when the form has no question to ask.
		async start({ kind, userId, channelId = null, meta = {}, form, intro = '' }) {
			const session = { key: keyOf(channelId, userId), kind, userId, channelId, meta, answers: [], step: nextStep(form, 0, []), index: 0, at: now() };
			if (session.step < 0) return null;
			await say(session, [intro, chatQuestion(form, session)].filter(Boolean).join('\n\n').slice(0, 2000));
			sessions.set(session.key, session);
			await save(session);
			return session;
		},

		find: (kind, match) => [...sessions.values()].find(s => s.kind === kind && match(s)) ?? null,

		// Forgets a conversation without a word (its ticket was closed, its channel deleted)
		async forget(channelId, userId = null) {
			const session = sessions.get(keyOf(channelId, userId));
			if (session) await drop(session);
		},

		// A message of a member: true when it was the answer to a question in progress.
		// One message at a time per conversation, in the order received.
		message({ channelId = null, userId, content = '', attachments = [] }) {
			const key = keyOf(channelId, userId);
			if (sessions.get(key)?.userId !== userId) return Promise.resolve(false);
			const run = (locks.get(key) ?? Promise.resolve()).catch(() => null).then(() => {
				const session = sessions.get(key);
				return session?.userId === userId ? answer(session, String(content ?? ''), attachments) : false;
			});
			locks.set(key, run);
			return run.finally(() => {
				if (locks.get(key) === run) locks.delete(key);
			});
		},

		// Conversations left without an answer for too long
		async tick() {
			for (const session of [...sessions.values()]) {
				const ttl = handlers.get(session.kind)?.ttl;
				if (ttl && now() - session.at <= ttl) continue;
				await abandon(session, 'expired').catch(error => logger.warn(`Form conversation ${session.key} not ended:`, error.message));
			}
		},
	};
}
