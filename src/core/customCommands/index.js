import { definePermission } from '../permissions.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors.js';
import { everyBlock, normalizeCommand, sensitiveBlocks } from './schema.js';
import { runFlow } from './engine.js';
import { assertFivemAllowed, createVariables } from '../variables.js';

definePermission('customcommands.view', { label: 'Voir les commandes personnalisées', category: 'Commandes perso' });
definePermission('customcommands.manage', { label: 'Créer et modifier les commandes personnalisées', category: 'Commandes perso' });
definePermission('customcommands.sensitive', { label: 'Mettre des actions sensibles (rôles, pseudo, sanctions) dans une commande', category: 'Commandes perso' });

// Discord's limit per server and per kind (user / message), raised from 5 to 15
const MAX_CONTEXT_MENUS = 15;

export function createCustomCommands({ db, network, ranks, audit, executor, logs, members, moderation, sanctions, reservedNames = [], logger = console, now = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms)), random = Math.random, variables = createVariables({ executor, logger, now }) }) {
	logs.registerCategory('customcommands', 'Commandes personnalisées (blocs « log »)');
	const reserved = new Set(reservedNames);
	const listeners = new Set();
	const cooldowns = new Map();

	const q = {
		all: db.prepare('SELECT * FROM custom_commands ORDER BY name COLLATE NOCASE'),
		get: db.prepare('SELECT * FROM custom_commands WHERE id = ?'),
		insert: db.prepare('INSERT INTO custom_commands (name, definition, enabled, created_by, created_at, updated_by, updated_at) VALUES (@name, @definition, 1, @by, @at, @by, @at)'),
		update: db.prepare('UPDATE custom_commands SET name = @name, definition = @definition, updated_by = @by, updated_at = @at WHERE id = @id'),
		enable: db.prepare('UPDATE custom_commands SET enabled = ?, updated_by = ?, updated_at = ? WHERE id = ?'),
		delete: db.prepare('DELETE FROM custom_commands WHERE id = ?'),
		used: db.prepare('UPDATE custom_commands SET uses = uses + 1 WHERE id = ?'),
		counter: db.prepare('SELECT value FROM custom_command_counters WHERE key = ? AND user_id = ?'),
		setCounter: db.prepare('INSERT INTO custom_command_counters (key, user_id, value) VALUES (?, ?, ?) ON CONFLICT (key, user_id) DO UPDATE SET value = excluded.value'),
		run: db.prepare('INSERT INTO custom_command_runs (command_id, guild_id, user_id, trigger, ok, detail, at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
		runs: db.prepare('SELECT * FROM custom_command_runs WHERE command_id = ? ORDER BY id DESC LIMIT ?'),
		trim: db.prepare('DELETE FROM custom_command_runs WHERE command_id = ? AND id NOT IN (SELECT id FROM custom_command_runs WHERE command_id = ? ORDER BY id DESC LIMIT 500)'),
	};

	let cache = null;
	const all = () => (cache ??= q.all.all().map(toCommand));

	function toCommand(row) {
		if (!row) return null;
		return { id: row.id, name: row.name, ...JSON.parse(row.definition), enabled: Boolean(row.enabled), uses: row.uses, createdBy: row.created_by, createdAt: row.created_at, updatedBy: row.updated_by, updatedAt: row.updated_at };
	}

	function getOrThrow(id) {
		const c = toCommand(q.get.get(id));
		if (!c) throw new NotFoundError('Commande introuvable.');
		return c;
	}

	function need(actor, permission) {
		if (!actor.can(permission)) throw new ForbiddenError(`Permission manquante : ${permission}`);
	}

	function changed() {
		cache = null;
		for (const fn of listeners) {
			try {
				fn();
			}
			catch (error) {
				logger.warn('Custom commands listener failed:', error.message);
			}
		}
	}

	const inScope = (c, guildId) => c.scope.mode === 'network' || c.scope.guildIds.includes(guildId);
	const activeGuilds = () => network.list().filter(g => g.status === 'active');

	// The editor must be allowed to write what the command will do
	async function checkRights(actor, def, currentId) {
		const sensitive = sensitiveBlocks(def);
		if (sensitive.length) need(actor, 'customcommands.sensitive');
		if (def.trigger.keyword?.mode === 'regex') need(actor, 'customcommands.sensitive');
		const roleIds = new Set();
		everyBlock(def, (b) => {
			if (b.type === 'role') b.roleIds.forEach(id => roleIds.add(id));
		});
		if (roleIds.size) {
			const guilds = activeGuilds();
			const byRole = new Map();
			for (const g of guilds) for (const r of await executor.listRoles(g.id)) byRole.set(r.id, g.id);
			for (const roleId of roleIds) {
				const guildId = byRole.get(roleId);
				if (!guildId) throw new ValidationError('Un des rôles choisis n’existe plus sur les serveurs du réseau.');
				await members.assertGivableRole(actor, guildId, roleId);
			}
		}
		// Discord allows 15 right-click commands of each kind per server
		if (def.trigger.type === 'user' || def.trigger.type === 'message') {
			for (const g of activeGuilds()) {
				if (!inScope(def, g.id)) continue;
				const same = all().filter(c => c.id !== currentId && c.enabled && c.trigger.type === def.trigger.type && inScope(c, g.id));
				if (same.length >= MAX_CONTEXT_MENUS) throw new ValidationError(`${g.name} a déjà ${MAX_CONTEXT_MENUS} commandes de clic droit de ce type (limite de Discord).`);
			}
		}
		// Same name on a server twice is refused by Discord
		const clash = all().find(c => c.id !== currentId && c.name === def.name && c.trigger.type === def.trigger.type && c.trigger.type !== 'keyword'
			&& activeGuilds().some(g => inScope(c, g.id) && inScope(def, g.id)));
		if (clash) throw new ValidationError(`Une commande « ${def.name} » existe déjà sur un des mêmes serveurs.`);
	}

	async function principalOf(userId) {
		return ranks.resolve(userId);
	}

	// Who may run it: channels, refused roles, Discord permission, then ranks / roles (either one)
	async function allowed(c, ctx) {
		const principal = await principalOf(ctx.user.id);
		if (principal.isOwner) return { ok: true, principal };
		const a = c.access;
		const refuse = reason => ({ ok: false, reason: a.deniedMessage || reason, principal });
		if (a.channelIds.length && !a.channelIds.includes(ctx.channelId)) return refuse('Cette commande ne s’utilise pas dans ce salon.');
		if (a.denyRoleIds.some(id => ctx.user.roleIds.includes(id))) return refuse('Tu ne peux pas utiliser cette commande.');
		if (a.permission && !ctx.user.permissions.includes('Administrator') && !ctx.user.permissions.includes(a.permission)) return refuse('Tu n’as pas la permission Discord nécessaire.');
		if (a.rankIds.length || a.roleIds.length) {
			const byRank = principal.ranks?.some(r => a.rankIds.includes(r.id));
			const byRole = a.roleIds.some(id => ctx.user.roleIds.includes(id));
			if (!byRank && !byRole) return refuse('Cette commande est réservée.');
		}
		return { ok: true, principal };
	}

	function onCooldown(c, ctx) {
		if (!c.cooldown.seconds) return 0;
		const key = `${c.id}:${c.cooldown.scope === 'guild' ? ctx.guildId : `${ctx.guildId}:${ctx.user.id}`}`;
		const until = cooldowns.get(key) ?? 0;
		if (until > now()) return until;
		cooldowns.set(key, now() + c.cooldown.seconds * 1000);
		return 0;
	}

	function counterGet(key, userId) {
		return q.counter.get(key, userId)?.value ?? 0;
	}

	return {
		list: () => all(),
		get: getOrThrow,
		runs: (id, limit = 100) => q.runs.all(id, limit).map(r => ({ id: r.id, guildId: r.guild_id, userId: r.user_id, trigger: r.trigger, ok: Boolean(r.ok), detail: r.detail, at: r.at })),
		counters: () => db.prepare('SELECT key, user_id AS userId, value FROM custom_command_counters ORDER BY key, value DESC LIMIT 500').all(),
		onChange(fn) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},

		async save(actor, input) {
			need(actor, 'customcommands.manage');
			const current = input.id ? getOrThrow(input.id) : null;
			const def = normalizeCommand(input, { reservedNames: reserved });
			assertFivemAllowed(actor, def, current);
			await checkRights(actor, def, current?.id ?? null);
			const row = { name: def.name, definition: JSON.stringify(def), by: actor.id, at: now() };
			let id = current?.id;
			if (current) q.update.run({ ...row, id });
			else id = Number(q.insert.run(row).lastInsertRowid);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: current ? 'customcommands.update' : 'customcommands.create', target: String(id), details: { name: def.name } });
			changed();
			return getOrThrow(id);
		},

		setEnabled(actor, id, enabled) {
			need(actor, 'customcommands.manage');
			const c = getOrThrow(id);
			q.enable.run(enabled ? 1 : 0, actor.id, now(), id);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: enabled ? 'customcommands.enable' : 'customcommands.disable', target: String(id), details: { name: c.name } });
			changed();
			return getOrThrow(id);
		},

		remove(actor, id) {
			need(actor, 'customcommands.manage');
			const c = getOrThrow(id);
			q.delete.run(id);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'customcommands.delete', target: String(id), details: { name: c.name } });
			changed();
		},

		// Slash and right-click commands to register on a server
		guildCommands(guildId) {
			return all().filter(c => c.enabled && c.trigger.type !== 'keyword' && inScope(c, guildId));
		},

		find(guildId, name, type) {
			return all().find(c => c.enabled && c.trigger.type === type && c.name === name && inScope(c, guildId)) ?? null;
		},

		// Keyword commands that match a message
		matchKeywords(guildId, channelId, content) {
			return all().filter((c) => {
				if (!c.enabled || c.trigger.type !== 'keyword' || !inScope(c, guildId)) return false;
				const k = c.trigger.keyword;
				if (k.channelIds.length && !k.channelIds.includes(channelId)) return false;
				const body = k.caseSensitive ? content : content.toLowerCase();
				return k.patterns.some((p) => {
					const pattern = k.caseSensitive ? p : p.toLowerCase();
					if (k.mode === 'regex') {
						try {
							return new RegExp(p, k.caseSensitive ? 'u' : 'iu').test(content.slice(0, 2000));
						}
						catch {
							return false;
						}
					}
					if (k.mode === 'exact') return body.trim() === pattern;
					if (k.mode === 'startsWith') return body.startsWith(pattern);
					return body.includes(pattern);
				});
			});
		},

		// Runs a command (or one of its buttons / menus). `respond` sends to Discord: reply, send, dm, react, deleteTrigger.
		// Returns { ok, denied?, reason?, warnings }
		async execute({ commandId, componentId = null, trigger, guildId, channelId, user, options = {}, respond }) {
			const c = getOrThrow(commandId);
			if (!c.enabled || !inScope(c, guildId) || network.find(guildId)?.status !== 'active') return { ok: false, denied: true, reason: 'Cette commande n’est pas disponible ici.', warnings: [] };
			const ctx = { guildId, channelId, user, options, serverName: '', memberCount: '' };
			const access = await allowed(c, ctx);
			if (!access.ok) {
				q.run.run(c.id, guildId, user.id, trigger, 0, `Refusé : ${access.reason}`, now());
				return { ok: false, denied: true, reason: access.reason, warnings: [] };
			}
			if (!componentId) {
				const until = onCooldown(c, ctx);
				if (until) return { ok: false, denied: true, reason: `Doucement : réessaie <t:${Math.ceil(until / 1000)}:R>.`, warnings: [] };
			}
			const info = await executor.getGuildInfo(guildId).catch(() => null);
			ctx.serverName = info?.name ?? '';
			ctx.memberCount = info?.memberCount ?? '';
			const flow = componentId ? c.components.find(x => x.id === componentId)?.flow : c.flow;
			if (!flow) return { ok: false, denied: true, reason: 'Ce bouton n’existe plus.', warnings: [] };

			// Role changes run with the bot's rights, as validated when the command was saved; sanctions with the user's own rights
			const roleActor = { id: user.id, source: 'bot', isOwner: true, level: Number.MAX_SAFE_INTEGER, can: () => true };
			// Checked again at every run: a role that became dangerous or linked to a rank is never handed out
			const roleCheck = { id: 'customcommand', isOwner: false, can: () => true };
			const reason = `Commande ${c.trigger.type === 'slash' ? '/' : ''}${c.name}`;
			let shared = null;
			const io = {
				now, random,
				sharedVars: async (fivem) => {
					if (!shared || (fivem && !shared.fivem)) shared = { fivem, vars: await variables.member(guildId, user.id, { fivem }) };
					return shared.vars;
				},
				reply: (msg, opts) => respond.reply(msg, { ...opts, components: (opts.components ?? []).map(id => c.components.find(x => x.id === id)).filter(Boolean), commandId: c.id }),
				send: (channel, msg, opts) => respond.send(channel, msg, { components: (opts.components ?? []).map(id => c.components.find(x => x.id === id)).filter(Boolean), commandId: c.id }),
				dm: (userId, msg) => respond.dm(userId, msg),
				react: emoji => respond.react(emoji),
				deleteTrigger: () => respond.deleteTrigger(),
				wait: ms => sleep(ms),
				hasRole: async (userId, roleId) => (await executor.getMemberRoleIds?.(guildId, userId) ?? []).includes(roleId),
				addRole: async (userId, roleId, durationMs) => {
					if (!(await executor.listRoles(guildId)).some(r => r.id === roleId)) return;
					await members.assertGivableRole(roleCheck, guildId, roleId);
					await moderation.giveRole(roleActor, { guildId, userId, roleId, durationMs, reason });
				},
				removeRole: async (userId, roleId) => {
					if (!(await executor.listRoles(guildId)).some(r => r.id === roleId)) return;
					await moderation.takeRole(roleActor, { guildId, userId, roleId, reason });
				},
				nickname: (userId, value) => executor.setNickname(guildId, userId, value.slice(0, 32) || null, reason),
				sanction: (kind, userId, why, durationMs) => sanctions.create({ ...access.principal, source: 'bot' }, { type: kind, userId, reason: `${why} (${reason})`, durationMs, scope: 'local', originGuildId: guildId }),
				counterGet: (key, userId) => counterGet(key, userId),
				counterUpdate: (key, userId, op, value) => {
					const next = op === 'reset' ? 0 : op === 'set' ? value : counterGet(key, userId) + value;
					q.setCounter.run(key, userId, next);
				},
				log: textValue => audit.record({ actorId: user.id, source: 'bot', action: 'customcommands.log', guildId, target: c.name, details: { text: textValue.slice(0, 1000) } }),
			};
			const result = await runFlow(flow, ctx, io);
			q.used.run(c.id);
			cache = null;
			q.run.run(c.id, guildId, user.id, trigger, result.warnings.length ? 0 : 1, result.warnings.join(' · ').slice(0, 500) || null, now());
			if (Math.random() < 0.05) q.trim.run(c.id, c.id);
			return { ok: true, warnings: result.warnings };
		},
	};
}
