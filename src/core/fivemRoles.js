import { randomUUID } from 'node:crypto';
import { definePermission } from './permissions.js';
import { ForbiddenError, ValidationError } from './errors.js';

definePermission('fivemdata.roles', { label: 'Vérifier et corriger les rôles Discord selon les métiers, gangs et rôles staff du jeu', category: 'FiveM' });

const SNOWFLAKE = /^\d{17,20}$/;
const KINDS = ['job', 'gang', 'staff'];
const MAX_LINKS = 200;

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
export function createFivemRoles({ fivemData, settings, executor, network, audit, logs, logger = console }) {
	logs?.registerCategory('fivemroles', 'Rôles Discord selon le jeu (check et corrections)');
	const links = () => settings.get('fivemroles.links', []);

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
		const list = links();
		const accounts = await fivemData.memberships();
		const byDiscord = new Map(accounts.filter(a => a.discordId).map(a => [a.discordId, a]));
		const guildIds = [...new Set(list.map(l => l.guildId))];
		const known = new Map(network.list().map(g => [g.id, g]));
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

	return {
		links,

		setLinks(actor, input) {
			need(actor, 'fivemdata.manage');
			const next = normalizeLinks(input);
			settings.set('fivemroles.links', next);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'fivemroles.links', details: { liaisons: next.length } });
			return next;
		},

		async check(actor) {
			need(actor, 'fivemdata.roles');
			const result = await run();
			return { ...result, links: links(), at: Date.now() };
		},

		// Applies issues of a fresh check, by key: nothing outside what the check found can be changed
		async fix(actor, keys) {
			need(actor, 'fivemdata.roles');
			if (!Array.isArray(keys) || !keys.length) throw new ValidationError('Rien à corriger.');
			const { issues } = await run();
			const wanted = new Set(keys.map(String));
			const results = [];
			for (const issue of issues.filter(i => wanted.has(i.key))) {
				if (!issue.fixable) {
					results.push({ key: issue.key, ok: false, error: issue.notMember ? 'pas sur le serveur' : 'rôle au-dessus du bot' });
					continue;
				}
				try {
					const reason = `Check rôles FiveM : ${issue.reason}`.slice(0, 400);
					const outcome = issue.action === 'add'
						? await executor.addRole(issue.guildId, issue.userId, issue.roleId, reason)
						: await executor.removeRole(issue.guildId, issue.userId, issue.roleId, reason);
					if (outcome === 'not_member') throw new Error('pas sur le serveur');
					audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: issue.action === 'add' ? 'fivemroles.add' : 'fivemroles.remove', guildId: issue.guildId, target: issue.userId, details: { rôle: issue.roleId, raison: issue.reason } });
					results.push({ key: issue.key, ok: true });
				}
				catch (error) {
					logger.warn('FiveM roles fix:', error.message);
					results.push({ key: issue.key, ok: false, error: error.message });
				}
			}
			const gone = keys.filter(k => !issues.some(i => i.key === k));
			for (const key of gone) results.push({ key, ok: false, error: 'déjà réglé' });
			return { done: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok), results };
		},
	};
}
