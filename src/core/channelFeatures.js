import { definePermission } from './permissions.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';
import { normalizePayload } from './announcements.js';

definePermission('channelfeatures.view', { label: 'Voir les salons automatiques', category: 'Salons automatiques' });
definePermission('channelfeatures.manage', { label: 'Configurer les salons automatiques (compteur, un mot, message épinglé, publication auto, média)', category: 'Salons automatiques' });

export const KINDS = {
	counting: 'Compteur',
	oneword: 'Un mot chacun',
	sticky: 'Message toujours en bas',
	autopublish: 'Publication automatique',
	mediaonly: 'Images et vidéos uniquement',
};
const SNOWFLAKE = /^\d{17,20}$/;
const SENTENCE_END = /[.!?…]$/;
const LINK = /https?:\/\/\S+/i;
const NOTICE_MS = 6000;

function normalizeConfig(kind, input = {}) {
	switch (kind) {
	case 'counting': return {
		resetOnFail: input.resetOnFail !== false,
		allowTwice: Boolean(input.allowTwice),
		deleteOthers: input.deleteOthers !== false,
	};
	case 'oneword': return {
		maxLength: Math.min(50, Math.max(5, Math.round(Number(input.maxLength) || 30))),
		allowTwice: Boolean(input.allowTwice),
		minWords: Math.min(50, Math.max(1, Math.round(Number(input.minWords) || 3))),
	};
	case 'sticky': return {
		payload: normalizePayload(input.payload ?? {}),
		delaySeconds: Math.min(300, Math.max(3, Math.round(Number(input.delaySeconds) || 8))),
	};
	case 'autopublish': return { onlyBots: Boolean(input.onlyBots) };
	case 'mediaonly': return { allowLinks: input.allowLinks !== false, notice: input.notice !== false };
	default: throw new ValidationError('Type de salon inconnu.');
	}
}

// Channels with an automatic behaviour. The bot hands every guild message to onMessage();
// the decisions are taken here, the executor reacts, deletes, sends or publishes.
export function createChannelFeatures({ db, network, audit, executor, logger = console, now = Date.now }) {
	const q = {
		all: db.prepare('SELECT * FROM channel_features'),
		byGuild: db.prepare('SELECT * FROM channel_features WHERE guild_id = ? ORDER BY kind, channel_id'),
		get: db.prepare('SELECT * FROM channel_features WHERE channel_id = ? AND kind = ?'),
		upsert: db.prepare(`
			INSERT INTO channel_features (channel_id, guild_id, kind, config, state, created_at, updated_at) VALUES (@channelId, @guildId, @kind, @config, '{}', @at, @at)
			ON CONFLICT (channel_id, kind) DO UPDATE SET config = excluded.config, updated_at = excluded.updated_at
		`),
		state: db.prepare('UPDATE channel_features SET state = ? WHERE channel_id = ? AND kind = ?'),
		remove: db.prepare('DELETE FROM channel_features WHERE channel_id = ? AND kind = ?'),
	};
	const toFeature = row => row && ({ channelId: row.channel_id, guildId: row.guild_id, kind: row.kind, config: JSON.parse(row.config), state: JSON.parse(row.state), updatedAt: row.updated_at });

	// channelId -> features, kept in memory: every message of the network goes through here
	let cache = null;
	function features(channelId) {
		if (!cache) {
			cache = new Map();
			for (const f of q.all.all().map(toFeature)) cache.set(f.channelId, [...(cache.get(f.channelId) ?? []), f]);
		}
		return cache.get(channelId) ?? [];
	}
	const reload = () => { cache = null; };
	function save(feature) {
		q.state.run(JSON.stringify(feature.state), feature.channelId, feature.kind);
	}

	const notice = (channelId, text) => executor.sendTemporary(channelId, text, NOTICE_MS).catch(() => undefined);
	const remove = (m) => executor.deleteMessage(m.channelId, m.messageId).catch(() => undefined);
	const stickyTimers = new Map();

	async function postSticky(feature) {
		const previous = feature.state.messageId;
		feature.state.messageId = await executor.sendMessage(feature.channelId, { payload: feature.config.payload, files: [], mentionUserIds: [] });
		save(feature);
		if (previous) await executor.deleteMessage(feature.channelId, previous).catch(() => undefined);
	}

	const handlers = {
		async counting(f, m) {
			const match = /^(\d{1,12})(?:\s|$)/.exec(m.content.trim());
			if (!match) {
				if (f.config.deleteOthers) await remove(m);
				return;
			}
			const value = Number(match[1]);
			const expected = (f.state.count ?? 0) + 1;
			const twice = !f.config.allowTwice && f.state.lastUserId === m.authorId;
			if (value === expected && !twice) {
				Object.assign(f.state, { count: value, lastUserId: m.authorId, lastMessageId: m.messageId, best: Math.max(f.state.best ?? 0, value) });
				save(f);
				await executor.react(m.channelId, m.messageId, value % 100 === 0 ? '💯' : '✅').catch(() => undefined);
				return;
			}
			if (!f.config.resetOnFail) {
				await remove(m);
				await notice(m.channelId, twice ? `<@${m.authorId}> attends que quelqu’un d’autre compte.` : `<@${m.authorId}> le prochain nombre est **${expected}**.`);
				return;
			}
			const reached = f.state.count ?? 0;
			Object.assign(f.state, { count: 0, lastUserId: null, lastMessageId: null, fails: (f.state.fails ?? 0) + 1 });
			save(f);
			await executor.react(m.channelId, m.messageId, '❌').catch(() => undefined);
			await executor.sendMessage(m.channelId, {
				payload: { content: `💥 <@${m.authorId}> a cassé la série à **${reached}** ${twice ? '(deux fois de suite)' : `(il fallait **${expected}**)`}. Record : **${f.state.best ?? 0}**. On repart de **1** !`, embed: { enabled: false } },
				files: [], mentionUserIds: [],
			}).catch(() => undefined);
		},

		async oneword(f, m) {
			const word = m.content.trim();
			const twice = !f.config.allowTwice && f.state.lastUserId === m.authorId;
			if (!word || /\s/.test(word) || word.length > f.config.maxLength || m.attachments > 0 || twice) {
				await remove(m);
				await notice(m.channelId, twice ? `<@${m.authorId}> laisse quelqu’un d’autre ajouter le mot suivant.` : `<@${m.authorId}> un seul mot par message (${f.config.maxLength} caractères max).`);
				return;
			}
			const words = [...(f.state.words ?? []), word];
			const authors = [...new Set([...(f.state.authors ?? []), m.authorId])];
			if (SENTENCE_END.test(word) && words.length >= f.config.minWords) {
				const sentences = (f.state.sentences ?? 0) + 1;
				Object.assign(f.state, { words: [], authors: [], lastUserId: null, sentences });
				save(f);
				const text = words.join(' ');
				await executor.sendMessage(m.channelId, {
					payload: { content: '', embed: { enabled: true, title: `📜 Phrase n°${sentences}`, description: `« ${text.charAt(0).toUpperCase()}${text.slice(1)} »`.slice(0, 4000), color: '#ff9628', footerText: `${words.length} mots · ${authors.length} participant${authors.length > 1 ? 's' : ''}`, fields: [] } },
					files: [], mentionUserIds: [],
				}).catch(() => undefined);
				return;
			}
			Object.assign(f.state, { words, authors, lastUserId: m.authorId });
			save(f);
		},

		// Brought back to the bottom a few seconds after the conversation calms down
		async sticky(f, m) {
			if (m.messageId === f.state.messageId) return;
			clearTimeout(stickyTimers.get(f.channelId));
			const timer = setTimeout(() => {
				stickyTimers.delete(f.channelId);
				const current = features(f.channelId).find(x => x.kind === 'sticky');
				if (current) postSticky(current).catch(error => logger.warn('Sticky message failed:', error.message));
			}, f.config.delaySeconds * 1000);
			timer.unref?.();
			stickyTimers.set(f.channelId, timer);
		},

		async autopublish(f, m) {
			if (f.config.onlyBots && !m.bot) return;
			await executor.crosspost(m.channelId, m.messageId).catch(error => logger.warn('Auto-publish failed:', error.message));
		},

		async mediaonly(f, m) {
			if (m.staff || m.attachments > 0 || m.mediaEmbeds > 0 || (f.config.allowLinks && LINK.test(m.content))) return;
			await remove(m);
			if (f.config.notice) await notice(m.channelId, `📸 <@${m.authorId}> ce salon est réservé aux images et vidéos${f.config.allowLinks ? ' (ou liens)' : ''}. Pour discuter, réponds dans un fil.`);
		},
	};

	const service = {
		kinds: KINDS,

		list(guildId) {
			return q.byGuild.all(guildId).map(toFeature);
		},

		async set(actor, { guildId, channelId, kind, config = {} }) {
			if (!actor.can('channelfeatures.manage')) throw new ForbiddenError('Permission manquante : channelfeatures.manage');
			if (network.find(guildId)?.status !== 'active') throw new ValidationError('Ce serveur ne fait pas partie du réseau.');
			if (!SNOWFLAKE.test(channelId)) throw new ValidationError('Salon invalide.');
			if (!KINDS[kind]) throw new ValidationError('Type de salon inconnu.');
			const channel = (await executor.listTextChannels(guildId)).find(c => c.id === channelId);
			if (!channel) throw new ValidationError('Ce salon n’existe pas sur ce serveur.');
			if (kind === 'autopublish' && !channel.announcement) throw new ValidationError('La publication automatique ne marche que dans un salon d’annonces.');
			const others = features(channelId).map(f => f.kind);
			const games = ['counting', 'oneword', 'mediaonly'];
			if (games.includes(kind) && others.some(k => games.includes(k) && k !== kind)) throw new ValidationError('Ce salon a déjà un autre jeu ou une autre règle (compteur, un mot, média).');
			const normalized = normalizeConfig(kind, config);
			q.upsert.run({ channelId, guildId, kind, config: JSON.stringify(normalized), at: now() });
			reload();
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'channelfeatures.set', guildId, target: channelId, details: { salon: `<#${channelId}>`, type: KINDS[kind] } });
			const feature = features(channelId).find(f => f.kind === kind);
			if (kind === 'sticky') await postSticky(feature).catch(error => { throw new ValidationError(`Message impossible à poster : ${error.message}`); });
			return feature;
		},

		// Counting: start again from a number (after a mistake of the bot, a raid...)
		setCount(actor, channelId, count) {
			if (!actor.can('channelfeatures.manage')) throw new ForbiddenError('Permission manquante : channelfeatures.manage');
			const f = features(channelId).find(x => x.kind === 'counting');
			if (!f) throw new NotFoundError('Pas de compteur dans ce salon.');
			Object.assign(f.state, { count: Math.max(0, Math.round(count)), lastUserId: null });
			save(f);
			return f;
		},

		async remove(actor, channelId, kind) {
			if (!actor.can('channelfeatures.manage')) throw new ForbiddenError('Permission manquante : channelfeatures.manage');
			const row = toFeature(q.get.get(channelId, kind));
			if (!row) throw new NotFoundError('Ce salon n’a pas ce réglage.');
			q.remove.run(channelId, kind);
			reload();
			clearTimeout(stickyTimers.get(channelId));
			if (kind === 'sticky' && row.state.messageId) await executor.deleteMessage(channelId, row.state.messageId).catch(() => undefined);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'channelfeatures.remove', guildId: row.guildId, target: channelId, details: { salon: `<#${channelId}>`, type: KINDS[kind] } });
		},

		// m: { guildId, channelId, messageId, authorId, bot, self, content, attachments, mediaEmbeds, staff }
		async onMessage(m) {
			const list = features(m.channelId);
			if (!list.length || m.self) return;
			for (const f of list) {
				// Only publishing deals with bots; the games and rules are for people
				if (m.bot && f.kind !== 'autopublish' && f.kind !== 'sticky') continue;
				try {
					await handlers[f.kind](f, m);
				}
				catch (error) {
					logger.warn(`Channel feature ${f.kind} failed:`, error.message);
				}
			}
		},

		// A counted number deleted: everyone is told where the count is
		async onDelete(channelId, messageId) {
			const f = features(channelId).find(x => x.kind === 'counting');
			if (!f || f.state.lastMessageId !== messageId) return;
			f.state.lastMessageId = null;
			save(f);
			await executor.sendMessage(channelId, { payload: { content: `⚠️ Le dernier nombre (**${f.state.count}**) a été supprimé. Le prochain est **${f.state.count + 1}**.`, embed: { enabled: false } }, files: [], mentionUserIds: [] }).catch(() => undefined);
		},
	};
	return service;
}
