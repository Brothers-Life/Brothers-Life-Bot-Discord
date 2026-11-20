import { createHash } from 'node:crypto';
import { definePermission } from './permissions.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';
import { normalizePayload } from './announcements.js';
import { fillPayload } from './onboarding.js';
import { fillVars } from './cards.js';
import { createVariables } from './variables.js';

definePermission('serverlinks.view', { label: 'Voir les liens entre serveurs', category: 'Réseau' });
definePermission('serverlinks.manage', { label: 'Gérer les liens entre serveurs (invitations, catégories, messages)', category: 'Réseau' });

const SNOWFLAKE = /^\d{17,20}$/;
const INVITE = /^(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/([A-Za-z0-9-]{2,32})\/?$/;
const CODE = /^[A-Za-z0-9-]{2,32}$/;
const COLOR = /^#[0-9a-f]{6}$/i;
const SYNC_LOCK_MS = 60_000;
const INVITE_CHECK_MS = 3600_000;
const MAX_BUTTONS = 25;
const MAX_EMBEDS = 10;
const MAX_MESSAGES = 10;
const MAX_CATEGORIES = 25;
const EMPTY_TEXT = '*Aucun autre serveur pour le moment.*';
const OTHERS = 'Autres serveurs';

export const DEFAULT_LINE = '{emoji} **[{name}]({invite})**\n{description}';
export const DEFAULT_CATEGORY_HEADER = '__**{emoji} {category}**__';
export const DEFAULT_BOARD_PAYLOAD = {
	content: '',
	embed: { enabled: true, title: 'Nos autres serveurs', description: 'Retrouve ici tous les Discord du réseau.\n{links}', color: '#ff9628', fields: [] },
};

const hash = value => createHash('sha1').update(JSON.stringify(value)).digest('hex');
const inviteUrl = code => (code ? `https://discord.gg/${code}` : null);
const text = (value, max) => String(value ?? '').trim().slice(0, max);
// Lines of a template without the holes left by an empty variable
const tidy = value => value.split('\n').map(l => l.trim()).filter(Boolean).join('\n');
// A template filled without the holes of its empty variables ("{emoji} **Nom**" without emoji: "**Nom**")
const fill = (template, vars) => tidy(fillVars(template.replace(/\{([a-z.]+)\}[ \t]*/gi, (match, key) => (vars[key] === '' ? '' : match)), vars));
// The network keeps a small icon (64 px): cards show a sharper one
const logoOf = icon => (icon ? icon.replace(/size=\d+/, 'size=256') : null);

// Code of an invitation typed as a link or as a bare code
export function parseInvite(value) {
	const raw = String(value ?? '').trim();
	return INVITE.exec(raw)?.[1] ?? (CODE.test(raw) ? raw : null);
}

function normalizeBoardConfig(input = {}) {
	const line = String(input.line ?? DEFAULT_LINE).slice(0, 400);
	if (!line.trim()) throw new ValidationError('Le modèle d’une ligne ne peut pas être vide.');
	const scope = input.scope === 'selected' ? 'selected' : 'all';
	const guildIds = scope === 'selected' ? [...new Set((Array.isArray(input.guildIds) ? input.guildIds : []).filter(id => SNOWFLAKE.test(id)))].slice(0, 50) : [];
	if (scope === 'selected' && !guildIds.length) throw new ValidationError('Choisis au moins un serveur à afficher, ou affiche tous les serveurs.');
	const config = {
		payload: normalizePayload(input.payload ?? DEFAULT_BOARD_PAYLOAD),
		// list: every server in the text ({links}); cards: one embed per server, with its logo
		layout: input.layout === 'list' ? 'list' : 'cards',
		line,
		compact: Boolean(input.compact),
		scope,
		guildIds,
		// Empty: every category (and the servers without one)
		categoryIds: [...new Set((Array.isArray(input.categoryIds) ? input.categoryIds : []).map(Number).filter(Number.isInteger))].slice(0, MAX_CATEGORIES),
		groupByCategory: input.groupByCategory !== false,
		categoryHeader: String(input.categoryHeader ?? DEFAULT_CATEGORY_HEADER).slice(0, 200),
		includeSelf: Boolean(input.includeSelf),
		buttons: input.buttons !== false,
		repost: input.repost !== false,
	};
	const e = config.payload.embed;
	const everything = [config.payload.content, e.title, e.description, e.footerText, ...e.fields.flatMap(f => [f.name, f.value])].join('\n');
	if (config.layout === 'list' && !config.buttons && !everything.includes('{links}')) throw new ValidationError('Le message n’affiche aucun lien : ajoute la variable {links} ou active les boutons.');
	return config;
}

// Messages listing the other servers of the network with their invitation, sorted by category, edited in
// place when a server, an invitation, a category or the board changes.
export function createServerLinks({ db, network, audit, executor, logs, logger = console, now = Date.now, variables = createVariables({ executor, logger, now }) }) {
	logs?.registerCategory('serverlinks', 'Liens entre serveurs');
	const q = {
		guilds: db.prepare('SELECT * FROM server_link_guilds'),
		guild: db.prepare('SELECT * FROM server_link_guilds WHERE guild_id = ?'),
		upsertGuild: db.prepare(`
			INSERT INTO server_link_guilds (guild_id, listed, label, description, emoji, category_id, invite_mode, invite_channel_id, invite_code, invite_error, invite_checked_at, position, updated_at)
			VALUES (@guildId, @listed, @label, @description, @emoji, @categoryId, @inviteMode, @inviteChannelId, @inviteCode, NULL, @at, @position, @at)
			ON CONFLICT (guild_id) DO UPDATE SET listed = EXCLUDED.listed, label = EXCLUDED.label, description = EXCLUDED.description, emoji = EXCLUDED.emoji,
				category_id = EXCLUDED.category_id, invite_mode = EXCLUDED.invite_mode, invite_channel_id = EXCLUDED.invite_channel_id, invite_code = EXCLUDED.invite_code,
				invite_error = NULL, invite_checked_at = EXCLUDED.invite_checked_at, position = EXCLUDED.position, updated_at = EXCLUDED.updated_at
		`),
		setInvite: db.prepare('UPDATE server_link_guilds SET invite_code = ?, invite_channel_id = ?, invite_error = NULL, invite_checked_at = ? WHERE guild_id = ?'),
		inviteState: db.prepare('UPDATE server_link_guilds SET invite_error = ?, invite_checked_at = ? WHERE guild_id = ?'),
		setPosition: db.prepare('UPDATE server_link_guilds SET position = ? WHERE guild_id = ?'),
		place: db.prepare('UPDATE server_link_guilds SET category_id = ?, position = ? WHERE guild_id = ?'),
		uncategorize: db.prepare('UPDATE server_link_guilds SET category_id = NULL WHERE category_id = ?'),
		categories: db.prepare('SELECT * FROM server_link_categories ORDER BY position, id'),
		category: db.prepare('SELECT * FROM server_link_categories WHERE id = ?'),
		insertCategory: db.prepare('INSERT INTO server_link_categories (name, emoji, color, position, created_at) VALUES (@name, @emoji, @color, @position, @at)'),
		updateCategory: db.prepare('UPDATE server_link_categories SET name = @name, emoji = @emoji, color = @color WHERE id = @id'),
		categoryPosition: db.prepare('UPDATE server_link_categories SET position = ? WHERE id = ?'),
		removeCategory: db.prepare('DELETE FROM server_link_categories WHERE id = ?'),
		boards: db.prepare('SELECT * FROM server_link_boards ORDER BY id'),
		board: db.prepare('SELECT * FROM server_link_boards WHERE id = ?'),
		insertBoard: db.prepare(`
			INSERT INTO server_link_boards (name, guild_id, channel_id, enabled, config, created_by, created_at, updated_at)
			VALUES (@name, @guildId, @channelId, @enabled, @config, @by, @at, @at)
		`),
		updateBoard: db.prepare('UPDATE server_link_boards SET name = @name, guild_id = @guildId, channel_id = @channelId, enabled = @enabled, config = @config, updated_at = @at WHERE id = @id'),
		moved: db.prepare('UPDATE server_link_boards SET discord_id = NULL, extra_ids = \'[]\', last_hash = NULL WHERE id = ?'),
		removeBoard: db.prepare('DELETE FROM server_link_boards WHERE id = ?'),
		claim: db.prepare('UPDATE server_link_boards SET syncing_at = ? WHERE id = ? AND (syncing_at IS NULL OR syncing_at < ?)'),
		done: db.prepare('UPDATE server_link_boards SET discord_id = ?, extra_ids = ?, last_hash = ?, last_error = NULL, synced_at = ?, syncing_at = NULL WHERE id = ?'),
		failed: db.prepare('UPDATE server_link_boards SET last_error = ?, synced_at = ?, syncing_at = NULL WHERE id = ?'),
		release: db.prepare('UPDATE server_link_boards SET syncing_at = NULL WHERE id = ?'),
	};

	function need(actor) {
		if (!actor.can('serverlinks.manage')) throw new ForbiddenError('Permission manquante : serverlinks.manage');
	}

	// Row of a server as stored, with some values replaced
	const guildParams = (server, patch = {}) => ({
		guildId: server.guildId,
		listed: server.listed ? 1 : 0,
		label: server.label,
		description: server.description,
		emoji: server.emoji,
		categoryId: server.categoryId,
		inviteMode: server.inviteMode,
		inviteChannelId: server.inviteChannelId,
		inviteCode: server.inviteCode,
		position: server.position,
		at: now(),
		...patch,
	});

	const activeGuilds = async () => (await network.list()).filter(g => g.status === 'active' && g.botPresent);

	const toCategory = row => ({ id: row.id, name: row.name, emoji: row.emoji, color: row.color, position: row.position });
	const categories = async () => (await q.categories.all()).map(toCategory);

	function toServer(guild, row, known) {
		return {
			guildId: guild.id,
			name: guild.name,
			icon: guild.icon,
			isMain: guild.isMain,
			listed: row?.listed === 1,
			label: row?.label ?? '',
			description: row?.description ?? '',
			emoji: row?.emoji ?? '',
			// A deleted category leaves its servers without one
			categoryId: row?.category_id && known.has(row.category_id) ? row.category_id : null,
			inviteMode: row?.invite_mode ?? 'auto',
			inviteChannelId: row?.invite_channel_id ?? null,
			inviteCode: row?.invite_code ?? null,
			inviteUrl: inviteUrl(row?.invite_code),
			inviteError: row?.invite_error ?? null,
			position: row?.position ?? 0,
		};
	}

	// Servers of the network in their display order
	async function servers() {
		const rows = new Map((await q.guilds.all()).map(r => [r.guild_id, r]));
		const known = new Set((await categories()).map(c => c.id));
		return (await activeGuilds())
			.map(g => toServer(g, rows.get(g.id), known))
			.sort((a, b) => a.position - b.position || Number(b.isMain) - Number(a.isMain) || a.name.localeCompare(b.name, 'fr'));
	}

	function toBoard(row) {
		const extraIds = JSON.parse(row.extra_ids ?? '[]');
		return {
			id: row.id,
			name: row.name,
			guildId: row.guild_id,
			channelId: row.channel_id,
			enabled: row.enabled === 1,
			...normalizeBoardConfig(JSON.parse(row.config)),
			messageId: row.discord_id,
			messageIds: [row.discord_id, ...extraIds].filter(Boolean),
			error: row.last_error,
			syncedAt: row.synced_at,
			createdBy: row.created_by,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}

	async function getOrThrow(id) {
		const row = await q.board.get(id);
		if (!row) throw new NotFoundError('Message introuvable.');
		return toBoard(row);
	}

	// A listed server in automatic mode without invitation gets one (permanent, reused when it already exists)
	async function ensureInvite(server) {
		if (!server.listed || server.inviteMode !== 'auto' || server.inviteCode) return server;
		try {
			const created = await executor.createInvite(server.guildId, server.inviteChannelId);
			await q.setInvite.run(created.code, server.inviteChannelId, now(), server.guildId);
			return { ...server, inviteCode: created.code, inviteUrl: inviteUrl(created.code), inviteError: null };
		}
		catch (error) {
			await q.inviteState.run(error.message ?? String(error), now(), server.guildId);
			logger.warn(`Server links: invitation of ${server.guildId}:`, error.message);
			return { ...server, inviteError: error.message ?? String(error) };
		}
	}

	// What a board shows: the listed servers with a working invitation, without the board's own server by default
	async function entriesFor(config, guildId, list) {
		const out = [];
		for (const server of list) {
			if (!server.listed) continue;
			if (server.guildId === guildId && !config.includeSelf) continue;
			if (config.scope === 'selected' && !config.guildIds.includes(server.guildId)) continue;
			if (config.categoryIds.length && !config.categoryIds.includes(server.categoryId)) continue;
			const ready = await ensureInvite(server);
			if (ready.inviteUrl) out.push(ready);
		}
		return out;
	}

	// Entries sorted by category (in the order of the categories, servers without one last).
	// Without grouping, or when no shown server has a category: one group without title.
	function groupsOf(config, entries, cats) {
		if (!config.groupByCategory || !entries.some(e => e.categoryId)) return [{ category: null, entries }];
		const groups = cats
			.map(category => ({ category, entries: entries.filter(e => e.categoryId === category.id) }))
			.filter(g => g.entries.length);
		const rest = entries.filter(e => !e.categoryId);
		if (rest.length) groups.push({ category: { id: null, name: OTHERS, emoji: '', color: null }, entries: rest });
		return groups;
	}

	// The messages of a board: [{ content, embed, cards }]. A message holds 10 embeds at most, so cards
	// continue in the next messages.
	async function render(config, guildId, list, cats) {
		const entries = await entriesFor(config, guildId, list);
		const groups = groupsOf(config, entries, cats);
		const ordered = groups.flatMap(g => g.entries);
		const everything = `${config.line}\n${JSON.stringify(config.payload)}`;
		const counts = new Map();
		if (everything.includes('{members}')) {
			for (const entry of ordered) counts.set(entry.guildId, (await executor.getGuildCounts(entry.guildId).catch(() => null))?.members ?? null);
		}
		const varsOf = (entry, category) => ({
			name: entry.label || entry.name,
			invite: entry.inviteUrl,
			description: entry.description,
			emoji: entry.emoji,
			icon: logoOf(entry.icon) ?? '',
			category: category?.name ?? '',
			members: counts.get(entry.guildId)?.toLocaleString('fr-FR') ?? '',
		});
		const header = category => fill(config.categoryHeader, { category: category.name, emoji: category.emoji });
		const separator = config.compact ? '\n' : '\n\n';
		const blocks = groups.map((group) => {
			const lines = group.entries.map(entry => fill(config.line, varsOf(entry, group.category)));
			return [group.category && config.categoryHeader.trim() ? header(group.category) : null, ...lines].filter(Boolean).join(separator);
		});
		const vars = {
			...(await variables.server(guildId)),
			// With cards, the cards are the list: {links} only says when there is nothing to show
			links: !ordered.length ? EMPTY_TEXT : config.layout === 'cards' ? '' : blocks.join('\n\n'),
			count: ordered.length,
		};
		const first = fillPayload(config.payload, vars);
		const buttons = config.buttons
			? ordered.slice(0, MAX_BUTTONS).map(e => ({ label: (e.label || e.name).slice(0, 80), url: e.inviteUrl, emoji: e.emoji || null }))
			: [];
		const messages = [{ ...first, cards: [] }];
		if (config.layout === 'cards') {
			const color = config.payload.embed.color;
			const cards = groups.flatMap((group) => {
				const title = group.category && config.categoryHeader.trim() ? [{ enabled: true, description: header(group.category), color: group.category.color ?? color, fields: [] }] : [];
				return [...title, ...group.entries.map((entry) => {
					const v = varsOf(entry, group.category);
					return {
						enabled: true,
						title: [v.emoji, v.name].filter(Boolean).join(' ').slice(0, 256),
						url: v.invite,
						description: [v.description, v.members && `👥 ${v.members} membres`].filter(Boolean).join('\n') || `[Rejoindre le serveur](${v.invite})`,
						thumbnailUrl: v.icon || null,
						color: group.category?.color ?? color,
						fields: [],
					};
				})];
			});
			const hasHeader = Boolean(first.content) || buildsEmbed(first.embed);
			if (!hasHeader) messages.pop();
			for (const card of cards) {
				let last = messages.at(-1);
				const used = last ? last.cards.length + (last.embed.enabled && buildsEmbed(last.embed) ? 1 : 0) : MAX_EMBEDS;
				if (used >= MAX_EMBEDS) {
					if (messages.length >= MAX_MESSAGES) break;
					last = { content: '', embed: { enabled: false, fields: [] }, cards: [] };
					messages.push(last);
				}
				last.cards.push(card);
			}
			if (!messages.length) messages.push({ ...first, cards: [] });
		}
		return { messages, payload: messages[0], buttons, servers: ordered.map(e => e.guildId) };
	}

	function buildsEmbed(e) {
		return Boolean(e?.enabled && (e.title || e.description || e.fields?.length || e.imageUrl || e.authorName));
	}

	// Posts or edits the messages of a board; only a real change reaches Discord
	async function sync(board, { force = false, list = null, cats = null } = {}) {
		if (!board.enabled) return { id: board.id, ok: true, skipped: true };
		if (!(await q.claim.run(now(), board.id, now() - SYNC_LOCK_MS)).changes) return { id: board.id, ok: true, busy: true };
		try {
			if ((await network.find(board.guildId))?.status !== 'active') throw new Error('Ce serveur ne fait plus partie du réseau.');
			const { messages, buttons } = await render(board, board.guildId, list ?? await servers(), cats ?? await categories());
			const h = hash({ messages, buttons });
			if (!force && h === (await q.board.get(board.id))?.last_hash && board.messageId) {
				await q.release.run(board.id);
				return { id: board.id, ok: true, unchanged: true };
			}
			const ids = [];
			for (const [index, message] of messages.entries()) {
				// The buttons go under the last message, below every server
				const options = { repost: board.repost, buttons: index === messages.length - 1 ? buttons : [] };
				ids.push(await executor.upsertMessage(board.channelId, board.messageIds[index] ?? null, message, options));
			}
			for (const surplus of board.messageIds.slice(messages.length)) await executor.deleteMessage(board.channelId, surplus).catch(() => null);
			await q.done.run(ids[0], JSON.stringify(ids.slice(1)), h, now(), board.id);
			return { id: board.id, ok: true };
		}
		catch (error) {
			await q.failed.run(error.message ?? String(error), now(), board.id);
			logger.warn(`Server links: board #${board.id}:`, error.message);
			return { id: board.id, ok: false, error: error.message ?? String(error) };
		}
	}

	async function syncAll() {
		const list = await servers();
		const cats = await categories();
		const results = [];
		for (const row of await q.boards.all()) results.push(await sync(toBoard(row), { list, cats }));
		return results;
	}

	async function deleteMessages(board) {
		for (const id of board.messageIds) await executor.deleteMessage(board.channelId, id).catch(() => null);
	}

	async function validateBoard(input) {
		const name = text(input.name, 100);
		if (!name) throw new ValidationError('Le nom fait 1 à 100 caractères.');
		if (!SNOWFLAKE.test(input.guildId) || !SNOWFLAKE.test(input.channelId)) throw new ValidationError('Choisis le serveur et le salon du message.');
		if ((await network.find(input.guildId))?.status !== 'active') throw new ValidationError('Ce serveur ne fait pas partie du réseau.');
		return { name, guildId: input.guildId, channelId: input.channelId, enabled: input.enabled === false ? 0 : 1, config: JSON.stringify(normalizeBoardConfig(input)) };
	}

	function validateCategory(input = {}) {
		const name = text(input.name, 60);
		if (!name) throw new ValidationError('Le nom de la catégorie fait 1 à 60 caractères.');
		const color = input.color ? String(input.color).toLowerCase() : null;
		if (color && !COLOR.test(color)) throw new ValidationError('Couleur invalide (attendu : #rrggbb).');
		return { name, emoji: text(input.emoji, 64), color };
	}

	const record = (actor, action, target, details, guildId = null) => audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action, guildId, target: String(target), details });

	return {
		servers,
		categories,
		boards: async () => (await q.boards.all()).map(toBoard),
		get: getOrThrow,

		// Categories sort the servers in the panel and in the messages (legal businesses, illegal groups...)
		async createCategory(actor, input) {
			need(actor);
			const values = validateCategory(input);
			const existing = await categories();
			if (existing.length >= MAX_CATEGORIES) throw new ValidationError(`${MAX_CATEGORIES} catégories au maximum.`);
			if (existing.some(c => c.name.toLowerCase() === values.name.toLowerCase())) throw new ValidationError('Une catégorie porte déjà ce nom.');
			const id = Number((await q.insertCategory.run({ ...values, position: existing.length, at: now() })).lastInsertRowid);
			await record(actor, 'serverlinks.category', id, { name: values.name });
			return toCategory(await q.category.get(id));
		},

		async updateCategory(actor, id, input) {
			need(actor);
			if (!await q.category.get(id)) throw new NotFoundError('Catégorie introuvable.');
			const values = validateCategory(input);
			if ((await categories()).some(c => c.id !== id && c.name.toLowerCase() === values.name.toLowerCase())) throw new ValidationError('Une catégorie porte déjà ce nom.');
			await q.updateCategory.run({ ...values, id });
			await record(actor, 'serverlinks.category', id, { name: values.name });
			await syncAll();
			return toCategory(await q.category.get(id));
		},

		// Its servers stay listed, without category
		async removeCategory(actor, id) {
			need(actor);
			const row = await q.category.get(id);
			if (!row) throw new NotFoundError('Catégorie introuvable.');
			await db.transaction(async () => {
				await q.uncategorize.run(id);
				await q.removeCategory.run(id);
			})();
			await record(actor, 'serverlinks.category_delete', id, { name: row.name });
			await syncAll();
		},

		async reorderCategories(actor, ids) {
			need(actor);
			const wanted = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger))];
			const existing = await categories();
			await db.transaction(async () => {
				for (const category of existing) {
					const index = wanted.indexOf(category.id);
					await q.categoryPosition.run(index === -1 ? wanted.length + category.position : index, category.id);
				}
			})();
			await syncAll();
			return await categories();
		},

		// The whole board of the panel after a drag and drop: order of the categories, and for each one its
		// servers in order. layout: [{ id: categoryId | null, items: [guildId] }]
		async arrange(actor, layout) {
			need(actor);
			const groups = (Array.isArray(layout) ? layout : []).map(g => ({ id: g?.id ?? null, items: (Array.isArray(g?.items) ? g.items : []).filter(id => SNOWFLAKE.test(id)) }));
			const known = new Set((await categories()).map(c => c.id));
			if (groups.some(g => g.id !== null && !known.has(g.id))) throw new ValidationError('Une catégorie vient d’être supprimée : recharge la page.');
			const byId = new Map((await servers()).map(s => [s.guildId, s]));
			await db.transaction(async () => {
				let categoryPosition = 0;
				let position = 0;
				for (const group of groups) {
					if (group.id !== null) await q.categoryPosition.run(categoryPosition++, group.id);
					for (const guildId of group.items) {
						const server = byId.get(guildId);
						if (!server) continue;
						if (await q.guild.get(guildId)) await q.place.run(group.id, position++, guildId);
						else await q.upsertGuild.run(guildParams(server, { categoryId: group.id, position: position++ }));
					}
				}
			})();
			await record(actor, 'serverlinks.reorder', 'layout', { categories: groups.filter(g => g.id !== null).length });
			await syncAll();
			return { servers: await servers(), categories: await categories() };
		},

		// How one server is presented in the boards of the others, and where its invitation comes from
		async saveServer(actor, guildId, input = {}) {
			need(actor);
			const guild = await network.find(guildId);
			if (!guild || guild.status !== 'active' || !guild.botPresent) throw new ValidationError('Ce serveur ne fait pas partie du réseau.');
			const previous = await q.guild.get(guild.id);
			const listed = Boolean(input.listed);
			const categoryId = input.categoryId === null || input.categoryId === undefined ? null : Number(input.categoryId);
			if (categoryId !== null && !await q.category.get(categoryId)) throw new ValidationError('Cette catégorie n’existe plus.');
			const inviteMode = input.inviteMode === 'manual' ? 'manual' : 'auto';
			let inviteChannelId = SNOWFLAKE.test(input.inviteChannelId ?? '') ? input.inviteChannelId : null;
			let inviteCode = null;
			if (inviteMode === 'manual') {
				inviteChannelId = null;
				inviteCode = parseInvite(input.inviteUrl);
				if (!inviteCode) {
					if (listed || String(input.inviteUrl ?? '').trim()) throw new ValidationError('Lien d’invitation invalide : attendu « https://discord.gg/… ».');
				}
				else if (await executor.resolveInvite(inviteCode) !== guild.id) {
					throw new ValidationError('Cette invitation est expirée ou ne mène pas à ce serveur.');
				}
			}
			else if (previous?.invite_mode === 'auto' && previous.invite_code && previous.invite_channel_id === inviteChannelId) {
				inviteCode = previous.invite_code;
			}
			else if (listed) {
				try {
					inviteCode = (await executor.createInvite(guild.id, inviteChannelId)).code;
				}
				catch (error) {
					throw new ValidationError(`Impossible de créer l’invitation : ${error.message}`);
				}
			}
			await q.upsertGuild.run({
				guildId: guild.id,
				listed: listed ? 1 : 0,
				label: text(input.label, 80),
				description: text(input.description, 300),
				emoji: text(input.emoji, 64),
				categoryId,
				inviteMode,
				inviteChannelId,
				inviteCode,
				position: previous?.position ?? 0,
				at: now(),
			});
			await record(actor, 'serverlinks.server', guild.id, { name: guild.name, listed, inviteMode }, guild.id);
			const results = await syncAll();
			return { server: (await servers()).find(s => s.guildId === guild.id), results };
		},

		// New permanent invitation for a server in automatic mode (the old link was leaked, deleted...)
		async renewInvite(actor, guildId) {
			need(actor);
			const server = (await servers()).find(s => s.guildId === String(guildId));
			if (!server) throw new NotFoundError('Serveur introuvable.');
			if (server.inviteMode !== 'auto') throw new ValidationError('Ce serveur utilise un lien saisi à la main.');
			let created;
			try {
				created = await executor.createInvite(server.guildId, server.inviteChannelId, { unique: true });
			}
			catch (error) {
				throw new ValidationError(`Impossible de créer l’invitation : ${error.message}`);
			}
			await q.upsertGuild.run(guildParams(server, { inviteCode: created.code }));
			await record(actor, 'serverlinks.invite', server.guildId, { name: server.name }, server.guildId);
			const results = await syncAll();
			return { server: (await servers()).find(s => s.guildId === server.guildId), results };
		},

		// Display order of the servers in every board (inside their category)
		async reorder(actor, guildIds) {
			need(actor);
			const ids = [...new Set((Array.isArray(guildIds) ? guildIds : []).filter(id => SNOWFLAKE.test(id)))];
			const list = await servers();
			await db.transaction(async () => {
				for (const server of list) {
					const index = ids.indexOf(server.guildId);
					const position = index === -1 ? ids.length : index;
					if (await q.guild.get(server.guildId)) await q.setPosition.run(position, server.guildId);
					else await q.upsertGuild.run(guildParams(server, { position }));
				}
			})();
			await syncAll();
			return await servers();
		},

		async create(actor, input) {
			need(actor);
			const values = await validateBoard(input);
			const id = Number((await q.insertBoard.run({ ...values, by: actor.id, at: now() })).lastInsertRowid);
			await record(actor, 'serverlinks.create', id, { name: values.name }, values.guildId);
			const result = await sync(await getOrThrow(id), { force: true });
			return { ...await getOrThrow(id), result };
		},

		async update(actor, id, input) {
			need(actor);
			const before = await getOrThrow(id);
			const values = await validateBoard(input);
			await q.updateBoard.run({ ...values, id, at: now() });
			// Another channel, or turned off: the old messages are removed
			if (before.channelId !== values.channelId || !values.enabled) {
				await deleteMessages(before);
				await q.moved.run(id);
			}
			await record(actor, 'serverlinks.update', id, { name: values.name }, values.guildId);
			const result = await sync(await getOrThrow(id));
			return { ...await getOrThrow(id), result };
		},

		async publish(actor, id) {
			need(actor);
			const board = await getOrThrow(id);
			if (!board.enabled) throw new ValidationError('Ce message est désactivé.');
			const result = await sync(board, { force: true });
			await record(actor, 'serverlinks.publish', id, { name: board.name }, board.guildId);
			return { ...await getOrThrow(id), result };
		},

		async remove(actor, id, { deleteMessage = true } = {}) {
			need(actor);
			const board = await getOrThrow(id);
			if (deleteMessage) await deleteMessages(board);
			await q.removeBoard.run(id);
			await record(actor, 'serverlinks.delete', id, { name: board.name }, board.guildId);
		},

		// What a board (saved or being edited) would post, without sending anything
		async preview(actor, input) {
			need(actor);
			if (!SNOWFLAKE.test(input.guildId)) throw new ValidationError('Choisis le serveur du message.');
			const list = (await servers()).map(s => (s.listed && s.inviteMode === 'auto' && !s.inviteCode ? { ...s, inviteUrl: 'https://discord.gg/…', inviteCode: '…' } : s));
			return await render(normalizeBoardConfig(input), input.guildId, list, await categories());
		},

		// Periodic: dead invitations are replaced (automatic) or flagged (manual), servers that joined or left
		// the network appear or disappear, deleted messages are posted again
		async tick() {
			for (const server of await servers()) {
				if (!server.listed || !server.inviteCode) continue;
				const row = await q.guild.get(server.guildId);
				if (row.invite_checked_at && now() - row.invite_checked_at < INVITE_CHECK_MS) continue;
				const target = await executor.resolveInvite(server.inviteCode).catch(() => undefined);
				if (target === undefined || target === server.guildId) {
					await q.inviteState.run(null, now(), server.guildId);
				}
				else if (server.inviteMode === 'manual') {
					await q.inviteState.run('Cette invitation ne fonctionne plus : saisis un nouveau lien.', now(), server.guildId);
				}
				else {
					await q.setInvite.run(null, server.inviteChannelId, now(), server.guildId);
				}
			}
			return await syncAll();
		},
	};
}
