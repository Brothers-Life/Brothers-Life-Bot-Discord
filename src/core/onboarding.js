import { definePermission } from './permissions.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';
import { normalizePayload } from './announcements.js';
import { DEFAULT_CARD, fetchImage, fillVars, normalizeCard, renderCard } from './cards.js';
import { accountCreatedAt } from './ticketConfig.js';
import { createVariables, usesFivem } from './variables.js';

definePermission('onboarding.view', { label: 'Voir l’accueil (bienvenue, règlement, rôles auto)', category: 'Accueil' });
definePermission('onboarding.manage', { label: 'Configurer l’accueil, les boosts et le règlement', category: 'Accueil' });

const SNOWFLAKE = /^\d{17,20}$/;
export const KINDS = ['welcome', 'leave', 'boost'];
const ids = value => (Array.isArray(value) ? value : []).filter(v => SNOWFLAKE.test(v)).slice(0, 25);

const DEFAULT_MESSAGES = {
	welcome: { content: 'Bienvenue {user} !', embed: { enabled: false } },
	leave: { content: '**{user.name}** a quitté le serveur.', embed: { enabled: false } },
	boost: { content: 'Merci {user} pour le boost ! Le serveur a maintenant {boosts} boosts.', embed: { enabled: false } },
	boostEnd: { content: '{user.name} ne boost plus le serveur.', embed: { enabled: false } },
	dm: { content: 'Bienvenue sur **{server}** ! Pense à lire le règlement.', embed: { enabled: false } },
	rules: {
		content: '',
		embed: { enabled: true, title: 'Règlement', description: '1. Respecte tout le monde.\n2. Pas de spam ni de publicité.\n3. Suis les consignes du staff.', color: '#d6a249' },
	},
};

function message(input, fallback) {
	try {
		return normalizePayload(input ?? fallback);
	}
	catch (error) {
		// An empty message of a disabled section is fine; the error only matters when it is enabled
		if (input === undefined) return normalizePayload(fallback);
		throw error;
	}
}

function card(input, kind) {
	const enabled = Boolean(input?.enabled);
	const design = input?.design ? normalizeCard(input.design) : {
		...structuredClone(DEFAULT_CARD),
		layers: DEFAULT_CARD.layers.map(l => (l.id === 'title' ? { ...l, text: { welcome: 'Bienvenue {user.name} !', leave: 'Au revoir {user.name}', boost: 'Merci {user.name} !' }[kind] } : l)),
	};
	return { enabled, design };
}

export function normalizeOnboarding(input = {}) {
	const section = (key, extra = {}) => {
		const s = input[key] ?? {};
		const enabled = Boolean(s.enabled);
		return {
			enabled,
			channelId: SNOWFLAKE.test(s.channelId) ? s.channelId : null,
			payload: enabled ? normalizePayload(s.payload ?? DEFAULT_MESSAGES[key]) : message(s.payload, DEFAULT_MESSAGES[key]),
			card: card(s.card, key),
			...extra,
		};
	};
	const welcomeDm = input.welcome?.dm ?? {};
	const boost = input.boost ?? {};
	const rules = input.rules ?? {};
	const autoroles = input.autoroles ?? {};
	const out = {
		welcome: section('welcome', {
			includeBots: Boolean(input.welcome?.includeBots),
			dm: { enabled: Boolean(welcomeDm.enabled), payload: message(welcomeDm.payload, DEFAULT_MESSAGES.dm) },
		}),
		leave: section('leave'),
		boost: section('boost', {
			bonusRoleIds: ids(boost.bonusRoleIds),
			end: { enabled: Boolean(boost.end?.enabled), payload: message(boost.end?.payload, DEFAULT_MESSAGES.boostEnd) },
			dm: { enabled: Boolean(boost.dm?.enabled), payload: message(boost.dm?.payload, { content: 'Merci pour ton boost sur **{server}** 💜', embed: { enabled: false } }) },
		}),
		autoroles: {
			humanRoleIds: ids(autoroles.humanRoleIds),
			botRoleIds: ids(autoroles.botRoleIds),
		},
		rules: {
			enabled: Boolean(rules.enabled),
			channelId: SNOWFLAKE.test(rules.channelId) ? rules.channelId : null,
			messageId: SNOWFLAKE.test(rules.messageId) ? rules.messageId : null,
			payload: message(rules.payload, DEFAULT_MESSAGES.rules),
			buttonLabel: String(rules.buttonLabel ?? 'J’accepte le règlement').slice(0, 80) || 'J’accepte le règlement',
			buttonEmoji: String(rules.buttonEmoji ?? '✅').slice(0, 64),
			buttonStyle: ['primary', 'secondary', 'success', 'danger'].includes(rules.buttonStyle) ? rules.buttonStyle : 'success',
			acceptRoleIds: ids(rules.acceptRoleIds),
			removeRoleIds: ids(rules.removeRoleIds),
			// The "human" automatic roles wait for the rules to be accepted
			autorolesOnAccept: rules.autorolesOnAccept !== false,
			minAccountAgeDays: Number.isInteger(rules.minAccountAgeDays) ? Math.min(Math.max(rules.minAccountAgeDays, 0), 3650) : 0,
			acceptedMessage: String(rules.acceptedMessage ?? 'Merci ! Tu as maintenant accès au serveur.').slice(0, 500),
		},
	};
	for (const key of KINDS) {
		if (out[key].enabled && !out[key].channelId) throw new ValidationError(`Choisis le salon du message « ${{ welcome: 'bienvenue', leave: 'départ', boost: 'boost' }[key]} ».`);
	}
	return out;
}

// Fills the variables everywhere in a message (text, embed, image URLs such as {user.avatar})
export function fillPayload(payload, vars) {
	const f = value => (typeof value === 'string' ? fillVars(value, vars) : value);
	const e = payload.embed;
	return {
		content: f(payload.content),
		embed: {
			...e,
			title: f(e.title), description: f(e.description), authorName: f(e.authorName), footerText: f(e.footerText),
			url: f(e.url), authorIconUrl: f(e.authorIconUrl), thumbnailUrl: f(e.thumbnailUrl), imageUrl: f(e.imageUrl), footerIconUrl: f(e.footerIconUrl),
			fields: e.fields.map(field => ({ ...field, name: f(field.name), value: f(field.value) })),
		},
	};
}

// Welcome, leave and boost messages (with an image card), automatic roles and rules to accept
export function createOnboarding({ db, network, audit, executor, uploads, logger = console, now = Date.now, fetchImpl = fetch, variables = createVariables({ executor, logger, now }) }) {
	const q = {
		get: db.prepare('SELECT * FROM onboarding_config WHERE guild_id = ?'),
		upsert: db.prepare(`
			INSERT INTO onboarding_config (guild_id, config, updated_at, updated_by) VALUES (?, ?, ?, ?)
			ON CONFLICT(guild_id) DO UPDATE SET config = excluded.config, updated_at = excluded.updated_at, updated_by = excluded.updated_by
		`),
	};
	const cache = new Map();

	function configOf(guildId) {
		if (!cache.has(guildId)) {
			const row = q.get.get(guildId);
			let config;
			try {
				config = normalizeOnboarding(row ? JSON.parse(row.config) : {});
			}
			catch (error) {
				logger.warn(`Onboarding config of ${guildId} is invalid, defaults used:`, error.message);
				config = normalizeOnboarding({});
			}
			cache.set(guildId, config);
		}
		return cache.get(guildId);
	}

	function active(guildId) {
		return network.find(guildId)?.status === 'active';
	}

	// Shared member variables (+ {fivem.*} only when `uses` mentions them) and the welcome ones
	async function varsFor(guildId, member, extra = {}, uses = null) {
		const user = { username: member.username, globalName: member.globalName, avatar: member.avatarUrl, createdAt: member.createdAt ?? accountCreatedAt(member.id) };
		const shared = await variables.member(guildId, member.id, { user, fivem: usesFivem(uses) });
		return {
			...shared,
			'avatarUrl': shared['user.avatar'],
			'inviter': extra.inviterId ? `<@${extra.inviterId}>` : 'inconnu',
		};
	}

	async function loadSource(source) {
		if (source.startsWith('upload:')) return uploads.read(source.slice(7));
		return fetchImage(source, { fetchImpl });
	}

	async function cardFile(design, vars, kind) {
		const png = await renderCard(design, vars, { loadSource });
		return { name: `${kind}.png`, buffer: png };
	}

	// Sends the message of a section (welcome, leave, boost) with its card if enabled
	async function sendSection(guildId, kind, section, member, extra = {}) {
		const vars = await varsFor(guildId, member, extra, section);
		const payload = fillPayload(section.payload, vars);
		const files = [];
		if (section.card?.enabled) {
			const file = await cardFile(section.card.design, vars, kind).catch((error) => {
				logger.warn(`Card ${kind} on ${guildId} failed:`, error.message);
				return null;
			});
			if (file) {
				files.push(file);
				// With an embed, the card becomes its big image
				if (payload.embed.enabled) payload.embed.imageUrl = `attachment://${file.name}`;
			}
		}
		await executor.sendMessage(section.channelId, { payload, files, mentionUserIds: [member.id] });
	}

	const service = {
		get: configOf,

		save(actor, guildId, input) {
			if (!actor.can('onboarding.manage')) throw new ForbiddenError('Permission manquante : onboarding.manage');
			if (!active(guildId)) throw new ValidationError('Ce serveur ne fait pas partie du réseau.');
			const current = configOf(guildId);
			const config = normalizeOnboarding({ ...input, rules: { ...input.rules, messageId: current.rules.messageId } });
			for (const [key, value] of [['welcome', config.welcome.card.design], ['leave', config.leave.card.design], ['boost', config.boost.card.design]]) {
				for (const source of [value.background.image, ...value.layers.map(l => l.src)]) {
					if (source?.startsWith('upload:') && !uploads.exists(source.slice(7))) throw new ValidationError(`Carte ${key} : une image envoyée n’existe plus, renvoie-la.`);
				}
			}
			q.upsert.run(guildId, JSON.stringify(config), now(), actor.id);
			cache.delete(guildId);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'onboarding.save', guildId, target: guildId });
			return configOf(guildId);
		},

		// Rendered card for the panel preview (a sample member, or someone real)
		async previewCard(guildId, design, member) {
			const vars = await varsFor(guildId, member ?? { id: '100000000000000000', username: 'nouveau_membre', globalName: 'Nouveau membre', avatarUrl: null });
			return renderCard(normalizeCard(design), vars, { loadSource });
		},

		async sendTest(actor, guildId, kind) {
			if (!actor.can('onboarding.manage')) throw new ForbiddenError('Permission manquante : onboarding.manage');
			if (!KINDS.includes(kind)) throw new ValidationError('Message inconnu.');
			const section = configOf(guildId)[kind];
			if (!section.channelId) throw new ValidationError('Choisis d’abord le salon de ce message.');
			const user = await executor.getUser(actor.id);
			await sendSection(guildId, kind, section, { id: actor.id, username: user?.username, globalName: user?.globalName, avatarUrl: user?.avatar });
		},

		// Someone joins: automatic roles, welcome message (+ DM)
		async memberJoined(guildId, member, { inviterId = null } = {}) {
			if (!active(guildId)) return;
			const config = configOf(guildId);
			const roles = member.bot
				? config.autoroles.botRoleIds
				: config.rules.enabled && config.rules.autorolesOnAccept && config.rules.acceptRoleIds.length ? [] : config.autoroles.humanRoleIds;
			for (const roleId of roles) {
				await executor.addRole(guildId, member.id, roleId, 'Rôle automatique').catch(error => logger.warn(`Auto role ${roleId} on ${guildId} failed:`, error.message));
			}
			if (config.welcome.enabled && (!member.bot || config.welcome.includeBots)) {
				await sendSection(guildId, 'welcome', config.welcome, member, { inviterId }).catch(error => logger.warn(`Welcome on ${guildId} failed:`, error.message));
			}
			if (config.welcome.dm.enabled && !member.bot) {
				const vars = await varsFor(guildId, member, { inviterId }, config.welcome.dm.payload);
				await executor.sendDMPayload(member.id, fillPayload(config.welcome.dm.payload, vars)).catch(() => null);
			}
		},

		async memberLeft(guildId, member) {
			if (!active(guildId)) return;
			const config = configOf(guildId);
			if (config.leave.enabled && !member.bot) {
				await sendSection(guildId, 'leave', config.leave, member).catch(error => logger.warn(`Leave message on ${guildId} failed:`, error.message));
			}
		},

		async boostStarted(guildId, member) {
			if (!active(guildId)) return;
			const config = configOf(guildId);
			for (const roleId of config.boost.bonusRoleIds) {
				await executor.addRole(guildId, member.id, roleId, 'Boost du serveur').catch(error => logger.warn(`Boost role on ${guildId} failed:`, error.message));
			}
			if (config.boost.enabled) await sendSection(guildId, 'boost', config.boost, member).catch(error => logger.warn(`Boost message on ${guildId} failed:`, error.message));
			if (config.boost.dm.enabled) {
				const vars = await varsFor(guildId, member, {}, config.boost.dm.payload);
				await executor.sendDMPayload(member.id, fillPayload(config.boost.dm.payload, vars)).catch(() => null);
			}
			audit.record({ actorId: member.id, source: 'bot', action: 'onboarding.boost', guildId, target: member.id, details: { member: `<@${member.id}>` } });
		},

		async boostEnded(guildId, member) {
			if (!active(guildId)) return;
			const config = configOf(guildId);
			for (const roleId of config.boost.bonusRoleIds) {
				await executor.removeRole(guildId, member.id, roleId, 'Fin du boost').catch(() => null);
			}
			if (config.boost.end.enabled && config.boost.channelId) {
				const vars = await varsFor(guildId, member, {}, config.boost.end.payload);
				await executor.sendMessage(config.boost.channelId, { payload: fillPayload(config.boost.end.payload, vars), files: [], mentionUserIds: [] }).catch(() => null);
			}
		},

		// Posts the rules (or updates the message already posted)
		async publishRules(actor, guildId) {
			if (!actor.can('onboarding.manage')) throw new ForbiddenError('Permission manquante : onboarding.manage');
			const config = configOf(guildId);
			const { rules } = config;
			if (!rules.channelId) throw new ValidationError('Choisis d’abord le salon du règlement.');
			if (!await executor.getTextChannel(guildId, rules.channelId)) throw new ValidationError('Le bot ne peut pas écrire dans le salon du règlement.');
			const messageId = await executor.publishRules(rules.channelId, rules.messageId, {
				payload: rules.payload,
				button: rules.enabled ? { label: rules.buttonLabel, emoji: rules.buttonEmoji, style: rules.buttonStyle } : null,
			});
			const raw = q.get.get(guildId);
			const stored = raw ? JSON.parse(raw.config) : {};
			stored.rules = { ...stored.rules, ...rules, messageId };
			q.upsert.run(guildId, JSON.stringify(stored), now(), actor.id);
			cache.delete(guildId);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'onboarding.rules_publish', guildId, target: rules.channelId });
			return configOf(guildId);
		},

		// The "I accept" button of the rules
		async acceptRules(guildId, userId) {
			const { rules, autoroles } = configOf(guildId);
			if (!rules.enabled) throw new NotFoundError('Le règlement n’est plus à valider ici.');
			if (rules.minAccountAgeDays && now() - accountCreatedAt(userId) < rules.minAccountAgeDays * 86_400_000) {
				throw new ValidationError(`Ton compte Discord doit avoir au moins ${rules.minAccountAgeDays} jour(s) pour accéder au serveur. Reviens un peu plus tard.`);
			}
			const current = await executor.getMemberRoleIds(guildId, userId) ?? [];
			const toAdd = [...rules.acceptRoleIds, ...(rules.autorolesOnAccept ? autoroles.humanRoleIds : [])].filter(r => !current.includes(r));
			const toRemove = rules.removeRoleIds.filter(r => current.includes(r));
			if (!toAdd.length && !toRemove.length && rules.acceptRoleIds.every(r => current.includes(r))) return { already: true, message: 'Tu as déjà accepté le règlement.' };
			for (const roleId of toAdd) await executor.addRole(guildId, userId, roleId, 'Règlement accepté');
			for (const roleId of toRemove) await executor.removeRole(guildId, userId, roleId, 'Règlement accepté');
			audit.record({ actorId: userId, source: 'bot', action: 'onboarding.rules_accept', guildId, target: userId, details: { member: `<@${userId}>` } });
			return { already: false, message: rules.acceptedMessage };
		},
	};
	return service;
}
