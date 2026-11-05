import { randomUUID } from 'node:crypto';
import { definePermission } from './permissions.js';
import { ForbiddenError, ValidationError } from './errors.js';

definePermission('fivemdata.roles', { label: 'Vérifier et corriger les rôles Discord selon les métiers, gangs et rôles staff du jeu', category: 'FiveM' });

const SNOWFLAKE = /^\d{17,20}$/;
const KINDS = ['job', 'gang', 'staff'];
const MAX_LINKS = 200;
const AUTO_KEY = 'fivemroles.auto';
// More removals than this in one automatic pass, and more than half the linked accounts: the game copy is
// probably incomplete (tables not received yet…), removals are held back until someone checks
const MASS_REMOVAL = 10;

export function normalizeLinks(input) {
	if (!Array.isArray(input)) throw new ValidationError('Liste de liaisons invalide.');
	if (input.length > MAX_LINKS) throw new ValidationError(`${MAX_LINKS} liaisons au maximum.`);
	return input.map((l) => {
		if (!KINDS.includes(l?.kind)) throw new ValidationError('Type de liaison invalide (métier, gang ou staff).');
		const name = String(l.name ?? '').trim().slice(0, 80);
		if (!name) throw new ValidationError('Chaque liaison doit viser un métier, un gang ou un rôle staff.');
		if (!SNOWFLAKE.test(String(l.guildId)) || !SNOWFLAKE.test(String(l.roleId))) throw new ValidationError('Serveur ou rôle Discord invalide.');
		const minGrade = l.kind === 'staff' ? 0 : Math.max(0, Math.min(100, Math.round(Number(l.minGrade ?? 0)) || 0));
		return { id: typeof l.id === 'string' && l.id ? l.id.slice(0, 40) : randomUUID(), kind: l.kind, name, minGrade, guildId: String(l.guildId), roleId: String(l.roleId) };
	});
}

// Discord roles checked against the game: links say "this job (from this grade) / gang / staff role gives this Discord role".
// The check lists who is missing a role and who holds one the game no longer justifies; a fix only applies what the check found.
export function createFivemRoles({ fivemData, settings, executor, network, audit, logs, logger = console, joinDelay = 5000 }) {
	logs?.registerCategory('fivemroles', 'Rôles Discord selon le jeu (check et corrections)');
	const links = async () => settings.get('fivemroles.links', []);

	function need(actor, permission) {
		if (!actor.can(permission)) throw new ForbiddenError(`Permission manquante : ${permission}`);
	}

	// Why an account should hold each linked role (key guildId:roleId -> reasons)
	function expectedRoles(account, list) {
		const expected = new Map();
		for (const link of list) {
			let reason = null;
			if (link.kind === 'staff') {
				if (account.staff?.name === link.name) reason = `staff ${link.name} en jeu`;
			}
			else {
				const held = account.groups.find(g => g.type === link.kind && g.name === link.name && g.grade >= link.minGrade);
				if (held) reason = `${held.label}${held.gradeLabel ? ` · ${held.gradeLabel}` : ` · grade ${held.grade}`} (${held.character})`;
			}
			if (!reason) continue;
			const key = `${link.guildId}:${link.roleId}`;
			expected.set(key, [...(expected.get(key) ?? []), reason]);
		}
		return expected;
	}

	async function run() {
		const list = await links();
		const accounts = await fivemData.memberships();
		const byDiscord = new Map(accounts.filter(a => a.discordId).map(a => [a.discordId, a]));
		const guildIds = [...new Set(list.map(l => l.guildId))];
		const known = new Map((await network.list()).map(g => [g.id, g]));
		const issues = [];
		const guilds = [];

		for (const guildId of guildIds) {
			const managed = [...new Set(list.filter(l => l.guildId === guildId).map(l => l.roleId))];
			const roles = new Map((await executor.listRoles(guildId).catch(() => [])).map(r => [r.id, r]));
			guilds.push({ id: guildId, name: known.get(guildId)?.name ?? guildId, roles: managed.map(id => ({ id, name: roles.get(id)?.name ?? null, color: roles.get(id)?.color ?? null, editable: roles.get(id)?.editable ?? false })) });
			const fixable = roleId => Boolean(roles.get(roleId)?.editable);

			// Missing: the game says yes, Discord says no
			for (const account of byDiscord.values()) {
				const expected = [...expectedRoles(account, list)].filter(([key]) => key.startsWith(`${guildId}:`));
				if (!expected.length) continue;
				const current = await executor.getMemberRoleIds(guildId, account.discordId).catch(() => null);
				for (const [key, reasons] of expected) {
					const roleId = key.split(':')[1];
					if (current && current.includes(roleId)) continue;
					issues.push({
						key: `add:${guildId}:${account.discordId}:${roleId}`, action: 'add', guildId, userId: account.discordId, roleId,
						reason: reasons.join(' · '), account: { userId: account.userId, username: account.username }, notMember: !current, fixable: Boolean(current) && fixable(roleId),
					});
				}
			}

			// Extra: Discord gives a linked role the game does not justify (or no FiveM account is linked)
			const holders = await executor.listMembersWithAnyRole(guildId, managed).catch(() => []);
			for (const member of holders) {
				const account = byDiscord.get(member.id);
				const expected = account ? expectedRoles(account, list) : new Map();
				for (const roleId of member.roleIds) {
					if (expected.has(`${guildId}:${roleId}`)) continue;
					const why = list.filter(l => l.guildId === guildId && l.roleId === roleId).map(l => (l.kind === 'staff' ? `staff ${l.name}` : `${l.name}${l.minGrade ? ` grade ${l.minGrade}+` : ''}`)).join(' ou ');
					issues.push({
						key: `remove:${guildId}:${member.id}:${roleId}`, action: 'remove', guildId, userId: member.id, roleId,
						reason: account ? `n’est plus ${why} en jeu` : 'aucun compte FiveM lié à ce Discord',
						account: account ? { userId: account.userId, username: account.username } : null, notMember: false, fixable: fixable(roleId),
					});
				}
			}
		}

		// Players holding a linked job, gang or staff role in game but with no Discord linked: nothing can be fixed for them
		const unlinked = accounts.filter(a => !a.discordId && expectedRoles(a, list).size)
			.map(a => ({ userId: a.userId, username: a.username, groups: a.groups.map(g => g.label), staff: a.staff?.name ?? null }));
		return { issues, guilds, unlinked, accounts: accounts.length, linked: byDiscord.size };
	}

	// Gives or takes one role found by the check; the audit names who did it (a staff member or the automatic sync)
	async function apply(issue, { actorId, source, prefix }) {
		if (!issue.fixable) return { key: issue.key, ok: false, error: issue.notMember ? 'pas sur le serveur' : 'rôle au-dessus du bot' };
		try {
			const reason = `${prefix} : ${issue.reason}`.slice(0, 400);
			const outcome = issue.action === 'add'
				? await executor.addRole(issue.guildId, issue.userId, issue.roleId, reason)
				: await executor.removeRole(issue.guildId, issue.userId, issue.roleId, reason);
			if (outcome === 'not_member') throw new Error('pas sur le serveur');
			await audit.record({ actorId, source, action: issue.action === 'add' ? 'fivemroles.add' : 'fivemroles.remove', guildId: issue.guildId, target: issue.userId, details: { rôle: issue.roleId, raison: issue.reason } });
			return { key: issue.key, ok: true };
		}
		catch (error) {
			logger.warn('FiveM roles fix:', error.message);
			return { key: issue.key, ok: false, error: error.message };
		}
	}

	// Arrivals waiting for their pass, per server
	const joins = new Map();

	async function autoConfig() {
		const c = await settings.get(AUTO_KEY, {});
		return { enabled: Boolean(c.enabled), lastRun: c.lastRun ?? null, last: c.last ?? null, held: c.held ?? null };
	}

	// Automatic pass: everything the check finds and the bot can do is applied (only linked roles are touched)
	async function sync({ guildId = null, userIds = null } = {}) {
		const c = await autoConfig();
		if (!c.enabled || !(await links()).length) return null;
		const result = await run();
		// No account at all: the game copy is not there (yet), nothing to compare with
		if (!result.accounts) return null;
		const scoped = result.issues.filter(i => i.fixable && (!guildId || i.guildId === guildId) && (!userIds || userIds.has(i.userId)));
		const removals = scoped.filter(i => i.action === 'remove');
		const hold = !userIds && removals.length > MASS_REMOVAL && removals.length > result.linked / 2;
		const todo = hold ? scoped.filter(i => i.action === 'add') : scoped;
		const results = [];
		for (const issue of todo) results.push({ issue, ...await apply(issue, { actorId: 'system', source: 'system', prefix: 'Synchro auto des rôles FiveM' }) });
		const done = results.filter(r => r.ok);
		const failed = results.filter(r => !r.ok);

		// One log per server with what changed (and what could not be done)
		for (const gid of [...new Set(results.map(r => r.issue.guildId))]) {
			const line = r => `${r.issue.action === 'add' ? '➕' : '➖'} <@${r.issue.userId}> <@&${r.issue.roleId}> — ${r.issue.reason}${r.ok ? '' : ` (échec : ${r.error})`}`;
			const rows = results.filter(r => r.issue.guildId === gid);
			const shown = rows.slice(0, 25).map(line);
			if (rows.length > 25) shown.push(`… et ${rows.length - 25} autres`);
			await logs?.log(gid, 'fivemroles', {
				title: 'Rôles synchronisés avec le jeu',
				description: shown.join('\n').slice(0, 4000),
				color: rows.some(r => !r.ok) ? 'warning' : 'info',
				footer: 'Synchro automatique des rôles FiveM',
			});
		}
		if (hold && c.held !== removals.length) {
			await logs?.log(null, 'fivemroles', {
				title: 'Retraits de rôles mis en attente',
				description: `La synchro automatique voulait retirer **${removals.length}** rôles d’un coup, sur ${result.linked} comptes liés : la copie du jeu est peut-être incomplète. Rien n’a été retiré ; vérifie dans le panel (Données FiveM › Rôles Discord) et corrige à la main si c’est voulu.`,
				color: 'warning',
			});
		}
		if (!userIds) await settings.set(AUTO_KEY, { ...c, lastRun: Date.now(), last: { added: done.filter(r => r.issue.action === 'add').length, removed: done.filter(r => r.issue.action === 'remove').length, failed: failed.length }, held: hold ? removals.length : null });
		return { done: done.length, failed: failed.length, held: hold ? removals.length : 0 };
	}

	return {
		links,
		autoConfig,

		async setAuto(actor, input) {
			need(actor, 'fivemdata.manage');
			const c = await autoConfig();
			const next = { ...c, enabled: Boolean(input?.enabled) };
			await settings.set(AUTO_KEY, next);
			await audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'fivemroles.auto', details: { synchro: next.enabled ? 'activée' : 'désactivée' } });
			return next;
		},

		// Periodic pass (bot process)
		tick: () => sync(),

		// A member joining a server gets the roles the game gives them there (arrivals grouped for a few seconds)
		syncMember(guildId, userId) {
			const pending = joins.get(guildId) ?? joins.set(guildId, { users: new Set(), timer: null }).get(guildId);
			pending.users.add(userId);
			if (pending.timer) return;
			pending.timer = setTimeout(() => {
				joins.delete(guildId);
				sync({ guildId, userIds: pending.users }).catch(error => logger.warn('FiveM roles sync on join:', error.message));
			}, joinDelay);
			pending.timer.unref?.();
		},

		async setLinks(actor, input) {
			need(actor, 'fivemdata.manage');
			const next = normalizeLinks(input);
			await settings.set('fivemroles.links', next);
			await audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'fivemroles.links', details: { liaisons: next.length } });
			return next;
		},

		async check(actor) {
			need(actor, 'fivemdata.roles');
			const result = await run();
			return { ...result, links: await links(), at: Date.now() };
		},

		// Applies issues of a fresh check, by key: nothing outside what the check found can be changed
		async fix(actor, keys) {
			need(actor, 'fivemdata.roles');
			if (!Array.isArray(keys) || !keys.length) throw new ValidationError('Rien à corriger.');
			const { issues } = await run();
			const wanted = new Set(keys.map(String));
			const results = [];
			for (const issue of issues.filter(i => wanted.has(i.key))) results.push(await apply(issue, { actorId: actor.id, source: actor.source ?? 'panel', prefix: 'Check rôles FiveM' }));
			const gone = keys.filter(k => !issues.some(i => i.key === k));
			for (const key of gone) results.push({ key, ok: false, error: 'déjà réglé' });
			return { done: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok), results };
		},
	};
}
