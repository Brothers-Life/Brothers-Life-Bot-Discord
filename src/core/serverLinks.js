import { createHash } from 'node:crypto';
import { definePermission } from './permissions.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';
import { normalizePayload } from './announcements.js';
import { fillPayload } from './onboarding.js';
import { fillVars } from './cards.js';
import { createVariables } from './variables.js';

definePermission('serverlinks.view', { label: 'Voir les liens entre serveurs', category: 'Réseau' });
definePermission('serverlinks.manage', { label: 'Gérer les liens entre serveurs (invitations, messages)', category: 'Réseau' });

const SNOWFLAKE = /^\d{17,20}$/;
const INVITE = /^(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/([A-Za-z0-9-]{2,32})\/?$/;
const CODE = /^[A-Za-z0-9-]{2,32}$/;
const SYNC_LOCK_MS = 60_000;
const INVITE_CHECK_MS = 3600_000;
const MAX_BUTTONS = 25;
const EMPTY_TEXT = '*Aucun autre serveur pour le moment.*';

export const DEFAULT_LINE = '{emoji} **[{name}]({invite})**\n{description}';
export const DEFAULT_BOARD_PAYLOAD = {
	content: '',
	embed: { enabled: true, title: 'Nos autres serveurs', description: '{links}', color: '#ff9628', fields: [] },
};

const hash = value => createHash('sha1').update(JSON.stringify(value)).digest('hex');
const inviteUrl = code => (code ? `https://discord.gg/${code}` : null);
const text = (value, max) => String(value ?? '').trim().slice(0, max);

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
		line,
		compact: Boolean(input.compact),
		scope,
		guildIds,
		includeSelf: Boolean(input.includeSelf),
		buttons: input.buttons !== false,
		repost: input.repost !== false,
	};
	const e = config.payload.embed;
	const everything = [config.payload.content, e.title, e.description, e.footerText, ...e.fields.flatMap(f => [f.name, f.value])].join('\n');
	if (!config.buttons && !everything.includes('{links}')) throw new ValidationError('Le message n’affiche aucun lien : ajoute la variable {links} ou active les boutons.');
	return config;
}

// One message per board listing the other servers of the network with their invitation, edited in place
// when a server, an invitation or the board changes.
export function createServerLinks({ db, network, audit, executor, logs, logger = console, now = Date.now, variables = createVariables({ executor, logger, now }) }) {
	logs?.registerCategory('serverlinks', 'Liens entre serveurs');
	const q = {
		guilds: db.prepare('SELECT * FROM server_link_guilds'),
		guild: db.prepare('SELECT * FROM server_link_guilds WHERE guild_id = ?'),
		upsertGuild: db.prepare(`
			INSERT INTO server_link_guilds (guild_id, listed, label, description, emoji, invite_mode, invite_channel_id, invite_code, invite_error, invite_checked_at, position, updated_at)
			VALUES (@guildId, @listed, @label, @description, @emoji, @inviteMode, @inviteChannelId, @inviteCode, NULL, @at, @position, @at)
			ON CONFLICT (guild_id) DO UPDATE SET listed = EXCLUDED.listed, label = EXCLUDED.label, description = EXCLUDED.description, emoji = EXCLUDED.emoji,
				invite_mode = EXCLUDED.invite_mode, invite_channel_id = EXCLUDED.invite_channel_id, invite_code = EXCLUDED.invite_code, invite_error = NULL,
				invite_checked_at = EXCLUDED.invite_checked_at, position = EXCLUDED.position, updated_at = EXCLUDED.updated_at
		`),
		setInvite: db.prepare('UPDATE server_link_guilds SET invite_code = ?, invite_channel_id = ?, invite_error = NULL, invite_checked_at = ? WHERE guild_id = ?'),
		inviteState: db.prepare('UPDATE server_link_guilds SET invite_error = ?, invite_checked_at = ? WHERE guild_id = ?'),
		setPosition: db.prepare('UPDATE server_link_guilds SET position = ? WHERE guild_id = ?'),
		boards: db.prepare('SELECT * FROM server_link_boards ORDER BY id'),
		board: db.prepare('SELECT * FROM server_link_boards WHERE id = ?'),
		insertBoard: db.prepare(`
			INSERT INTO server_link_boards (name, guild_id, channel_id, enabled, config, created_by, created_at, updated_at)
			VALUES (@name, @guildId, @channelId, @enabled, @config, @by, @at, @at)
		`),
		updateBoard: db.prepare('UPDATE server_link_boards SET name = @name, guild_id = @guildId, channel_id = @channelId, enabled = @enabled, config = @config, updated_at = @at WHERE id = @id'),
		moved: db.prepare('UPDATE server_link_boards SET discord_id = NULL, last_hash = NULL WHERE id = ?'),
		removeBoard: db.prepare('DELETE FROM server_link_boards WHERE id = ?'),
		claim: db.prepare('UPDATE server_link_boards SET syncing_at = ? WHERE id = ? AND (syncing_at IS NULL OR syncing_at < ?)'),
		done: db.prepare('UPDATE server_link_boards SET discord_id = ?, last_hash = ?, last_error = NULL, synced_at = ?, syncing_at = NULL WHERE id = ?'),
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
		inviteMode: server.inviteMode,
		inviteChannelId: server.inviteChannelId,
		inviteCode: server.inviteCode,
		position: server.position,
		at: now(),
		...patch,
	});

	const activeGuilds = async () => (await network.list()).filter(g => g.status === 'active' && g.botPresent);

	function toServer(guild, row) {
		return {
			guildId: guild.id,
			name: guild.name,
			icon: guild.icon,
			isMain: guild.isMain,
			listed: row?.listed === 1,
			label: row?.label ?? '',
			description: row?.description ?? '',
			emoji: row?.emoji ?? '',
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
		return (await activeGuilds())
			.map(g => toServer(g, rows.get(g.id)))
			.sort((a, b) => a.position - b.position || Number(b.isMain) - Number(a.isMain) || a.name.localeCompare(b.name, 'fr'));
	}

	function toBoard(row) {
		return {
			id: row.id,
			name: row.name,
			guildId: row.guild_id,
			channelId: row.channel_id,
			enabled: row.enabled === 1,
			...normalizeBoardConfig(JSON.parse(row.config)),
			messageId: row.discord_id,
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
			const ready = await ensureInvite(server);
			if (ready.inviteUrl) out.push(ready);
		}
		return out;
	}

	async function render(config, guildId, list) {
		const entries = await entriesFor(config, guildId, list);
		const wantsMembers = config.line.includes('{members}');
		const lines = [];
		for (const entry of entries) {
			const counts = wantsMembers ? await executor.getGuildCounts(entry.guildId).catch(() => null) : null;
			const line = fillVars(config.line, {
				name: entry.label || entry.name,
				invite: entry.inviteUrl,
				description: entry.description,
				emoji: entry.emoji,
				members: counts ? counts.members.toLocaleString('fr-FR') : '',
			});
			// A server without emoji or description leaves no hole
			lines.push(line.split('\n').map(l => l.trim()).filter(Boolean).join('\n'));
		}
		const vars = {
			...(await variables.server(guildId)),
			links: lines.length ? lines.join(config.compact ? '\n' : '\n\n') : EMPTY_TEXT,
			count: entries.length,
		};
		const buttons = config.buttons
			? entries.slice(0, MAX_BUTTONS).map(e => ({ label: (e.label || e.name).slice(0, 80), url: e.inviteUrl, emoji: e.emoji || null }))
			: [];
		return { payload: fillPayload(config.payload, vars), buttons, servers: entries.map(e => e.guildId) };
	}

	// Posts or edits the message of a board; only a real change reaches Discord
	async function sync(board, { force = false, list = null } = {}) {
		if (!board.enabled) return { id: board.id, ok: true, skipped: true };
		if (!(await q.claim.run(now(), board.id, now() - SYNC_LOCK_MS)).changes) return { id: board.id, ok: true, busy: true };
		try {
			if ((await network.find(board.guildId))?.status !== 'active') throw new Error('Ce serveur ne fait plus partie du réseau.');
			const { payload, buttons } = await render(board, board.guildId, list ?? await servers());
			const h = hash({ payload, buttons });
			if (!force && h === (await q.board.get(board.id))?.last_hash && board.messageId) {
				await q.release.run(board.id);
				return { id: board.id, ok: true, unchanged: true };
			}
			const messageId = await executor.upsertMessage(board.channelId, board.messageId, payload, { repost: board.repost, buttons });
			await q.done.run(messageId, h, now(), board.id);
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
		const results = [];
		for (const row of await q.boards.all()) results.push(await sync(toBoard(row), { list }));
		return results;
	}

	async function validateBoard(input) {
		const name = text(input.name, 100);
		if (!name) throw new ValidationError('Le nom fait 1 à 100 caractères.');
		if (!SNOWFLAKE.test(input.guildId) || !SNOWFLAKE.test(input.channelId)) throw new ValidationError('Choisis le serveur et le salon du message.');
		if ((await network.find(input.guildId))?.status !== 'active') throw new ValidationError('Ce serveur ne fait pas partie du réseau.');
		return { name, guildId: input.guildId, channelId: input.channelId, enabled: input.enabled === false ? 0 : 1, config: JSON.stringify(normalizeBoardConfig(input)) };
	}

	const record = (actor, action, target, details, guildId = null) => audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action, guildId, target: String(target), details });

	return {
		servers,
		boards: async () => (await q.boards.all()).map(toBoard),
		get: getOrThrow,

		// How one server is presented in the boards of the others, and where its invitation comes from
		async saveServer(actor, guildId, input = {}) {
			need(actor);
			const guild = await network.find(guildId);
			if (!guild || guild.status !== 'active' || !guild.botPresent) throw new ValidationError('Ce serveur ne fait pas partie du réseau.');
			const previous = await q.guild.get(guild.id);
			const listed = Boolean(input.listed);
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

		// Display order of the servers in every board
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
			// Another channel: the old message is removed, a new one is posted
			if (before.channelId !== values.channelId) {
				if (before.messageId) await executor.deleteMessage(before.channelId, before.messageId).catch(() => null);
				await q.moved.run(id);
			}
			else if (!values.enabled && before.messageId) {
				await executor.deleteMessage(before.channelId, before.messageId).catch(() => null);
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
			if (deleteMessage && board.messageId) await executor.deleteMessage(board.channelId, board.messageId).catch(() => null);
			await q.removeBoard.run(id);
			await record(actor, 'serverlinks.delete', id, { name: board.name }, board.guildId);
		},

		// What a board (saved or being edited) would post, without sending anything
		async preview(actor, input) {
			need(actor);
			if (!SNOWFLAKE.test(input.guildId)) throw new ValidationError('Choisis le serveur du message.');
			const list = (await servers()).map(s => (s.listed && s.inviteMode === 'auto' && !s.inviteCode ? { ...s, inviteUrl: 'https://discord.gg/…', inviteCode: '…' } : s));
			return await render(normalizeBoardConfig(input), input.guildId, list);
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
