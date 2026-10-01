import { definePermission } from './permissions.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';
import { normalizePayload } from './announcements.js';

definePermission('embeds.view', { label: 'Voir les messages du créateur d’embeds', category: 'Messages' });
definePermission('embeds.manage', { label: 'Créer, poster et modifier des embeds', category: 'Messages' });

const SNOWFLAKE = /^\d{17,20}$/;
const MAX_EMBEDS = 10;
const MAX_BUTTONS = 25;
const TOTAL = 6000;

// { content, embeds: [embed], buttons: [{ label, url, emoji }] }: several embeds and link buttons
export function normalizeBuilt(input = {}) {
	const content = String(input.content ?? '').slice(0, 2000);
	const embeds = (Array.isArray(input.embeds) ? input.embeds : []).slice(0, MAX_EMBEDS).map((embed) => {
		const hasSomething = embed && (embed.title || embed.description || embed.imageUrl || embed.authorName || embed.fields?.length || embed.thumbnailUrl);
		// normalizePayload checks every field and limit of one embed
		return hasSomething ? normalizePayload({ content: '.', embed: { ...embed, enabled: true } }).embed : null;
	}).filter(Boolean);
	const total = embeds.reduce((n, e) => n + [e.title, e.description, e.authorName, e.footerText, ...e.fields.flatMap(f => [f.name, f.value])].join('').length, 0);
	if (total > TOTAL) throw new ValidationError(`Les embeds dépassent ${TOTAL} caractères au total (${total}).`);
	const buttons = (Array.isArray(input.buttons) ? input.buttons : []).slice(0, MAX_BUTTONS).map((b) => {
		const label = String(b?.label ?? '').trim().slice(0, 80);
		const url = String(b?.url ?? '').trim();
		if (!/^https?:\/\/\S+$/i.test(url)) throw new ValidationError(`Lien de bouton invalide : « ${url || label || '?'} ».`);
		if (!label && !b?.emoji) throw new ValidationError('Chaque bouton a besoin d’un texte ou d’un émoji.');
		return { label, url: url.slice(0, 512), emoji: String(b?.emoji ?? '').slice(0, 64) || null };
	});
	if (!content.trim() && !embeds.length) throw new ValidationError('Le message est vide : écris un texte ou remplis un embed.');
	return { content, embeds, buttons };
}

// Messages composed in the panel (or with /embed), posted anywhere, and edited in place afterwards
export function createEmbedBuilder({ db, network, audit, executor, now = Date.now }) {
	const q = {
		list: db.prepare('SELECT * FROM built_messages ORDER BY updated_at DESC'),
		get: db.prepare('SELECT * FROM built_messages WHERE id = ?'),
		insert: db.prepare('INSERT INTO built_messages (name, payload, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'),
		update: db.prepare('UPDATE built_messages SET name = ?, payload = ?, updated_at = ? WHERE id = ?'),
		posted: db.prepare('UPDATE built_messages SET guild_id = ?, channel_id = ?, message_id = ?, updated_at = ? WHERE id = ?'),
		remove: db.prepare('DELETE FROM built_messages WHERE id = ?'),
	};
	const toMessage = row => row && ({
		id: row.id, name: row.name, guildId: row.guild_id, channelId: row.channel_id, messageId: row.message_id,
		payload: JSON.parse(row.payload), createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
	});
	const need = (actor) => {
		if (!actor.can('embeds.manage')) throw new ForbiddenError('Permission manquante : embeds.manage');
	};
	const cleanName = (name, payload) => (String(name ?? '').trim() || payload.embeds[0]?.title || payload.content.slice(0, 40) || 'Sans nom').slice(0, 80);

	const service = {
		list: () => q.list.all().map(toMessage),

		get(id) {
			const message = toMessage(q.get.get(id));
			if (!message) throw new NotFoundError('Message introuvable.');
			return message;
		},

		// Saved, and re-posted in place when it was already posted
		async save(actor, { id = null, name = '', payload }) {
			need(actor);
			const clean = normalizeBuilt(payload);
			let saved;
			if (id) {
				service.get(id);
				q.update.run(cleanName(name, clean), JSON.stringify(clean), now(), id);
				saved = service.get(id);
				if (saved.messageId) await service.post(actor, id, { guildId: saved.guildId, channelId: saved.channelId });
			}
			else {
				saved = service.get(Number(q.insert.run(cleanName(name, clean), JSON.stringify(clean), actor.id, now(), now()).lastInsertRowid));
			}
			return service.get(saved.id);
		},

		// Posted in a channel; posting it in another channel moves it (the old message is deleted)
		async post(actor, id, { guildId, channelId }) {
			need(actor);
			const message = service.get(id);
			if (network.find(guildId)?.status !== 'active') throw new ValidationError('Ce serveur ne fait pas partie du réseau.');
			if (!SNOWFLAKE.test(channelId)) throw new ValidationError('Salon invalide.');
			const sameChannel = message.channelId === channelId && message.messageId;
			const messageId = await executor.upsertBuiltMessage(channelId, sameChannel ? message.messageId : null, message.payload);
			if (!sameChannel && message.messageId) await executor.deleteMessage(message.channelId, message.messageId).catch(() => undefined);
			q.posted.run(guildId, channelId, messageId, now(), id);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: sameChannel ? 'embeds.edit' : 'embeds.post', guildId, target: String(id), details: { message: message.name, salon: `<#${channelId}>` } });
			return service.get(id);
		},

		async remove(actor, id, { deleteMessage = true } = {}) {
			need(actor);
			const message = service.get(id);
			if (deleteMessage && message.messageId) await executor.deleteMessage(message.channelId, message.messageId).catch(() => undefined);
			q.remove.run(id);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'embeds.delete', guildId: message.guildId, target: String(id), details: { message: message.name } });
		},
	};
	return service;
}
