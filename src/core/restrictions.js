import { definePermission } from './permissions.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';

definePermission('restrictions.manage', { label: 'Configurer les profils de restriction (rôles de punition)', category: 'Sanctions' });

// Permissions a restriction may deny (names of Discord's PermissionFlagsBits)
export const RESTRICTABLE = [
	'ViewChannel', 'SendMessages', 'SendMessagesInThreads', 'CreatePublicThreads', 'CreatePrivateThreads', 'AddReactions',
	'AttachFiles', 'EmbedLinks', 'UseExternalEmojis', 'UseExternalStickers', 'MentionEveryone', 'UseApplicationCommands',
	'Connect', 'Speak', 'Stream', 'UseVAD', 'UseSoundboard', 'SendVoiceMessages', 'SendPolls', 'ChangeNickname', 'CreateInstantInvite',
];

// "Punishment roles": one role per profile and per server, denied on every channel
export function createRestrictions({ db, network, audit, executor, logger = console }) {
	const q = {
		profiles: db.prepare('SELECT * FROM restriction_profiles ORDER BY position, key'),
		profile: db.prepare('SELECT * FROM restriction_profiles WHERE key = ?'),
		clearProfiles: db.prepare('DELETE FROM restriction_profiles'),
		insertProfile: db.prepare('INSERT INTO restriction_profiles (key, label, deny, position) VALUES (@key, @label, @deny, @position)'),
		role: db.prepare('SELECT role_id FROM restriction_roles WHERE guild_id = ? AND profile_key = ?'),
		roles: db.prepare('SELECT * FROM restriction_roles WHERE guild_id = ?'),
		setRole: db.prepare(`
			INSERT INTO restriction_roles (guild_id, profile_key, role_id) VALUES (?, ?, ?)
			ON CONFLICT(guild_id, profile_key) DO UPDATE SET role_id = excluded.role_id
		`),
		deleteRoles: db.prepare('DELETE FROM restriction_roles WHERE profile_key = ?'),
	};

	const toProfile = row => ({ key: row.key, label: row.label, deny: JSON.parse(row.deny), position: row.position });

	function getProfile(key) {
		const row = q.profile.get(key);
		if (!row) throw new NotFoundError(`Profil de restriction inconnu : ${key}`);
		return toProfile(row);
	}

	// The role of a profile on a server, created (and its overwrites set) if needed
	async function ensureRole(guildId, profile) {
		const known = q.role.get(guildId, profile.key)?.role_id ?? null;
		const roleId = await executor.ensureRestrictionRole(guildId, { roleId: known, name: `Restreint · ${profile.label}`, deny: profile.deny });
		if (roleId !== known) q.setRole.run(guildId, profile.key, roleId);
		return roleId;
	}

	const service = {
		profiles: () => q.profiles.all().map(toProfile),
		getProfile,

		saveProfiles(actor, input) {
			if (!actor.can('restrictions.manage')) throw new ForbiddenError('Permission manquante : restrictions.manage');
			if (!Array.isArray(input) || !input.length || input.length > 15) throw new ValidationError('Entre 1 et 15 profils.');
			const seen = new Set();
			const profiles = input.map((p, position) => {
				if (!/^[a-z0-9_]{1,30}$/.test(p?.key ?? '')) throw new ValidationError(`Clé de profil invalide : « ${p?.key} ».`);
				if (seen.has(p.key)) throw new ValidationError(`Profil en double : ${p.key}.`);
				seen.add(p.key);
				const label = String(p.label ?? '').trim().slice(0, 40);
				if (!label) throw new ValidationError(`Le profil ${p.key} n’a pas de nom.`);
				const deny = [...new Set((Array.isArray(p.deny) ? p.deny : []).filter(d => RESTRICTABLE.includes(d)))];
				if (!deny.length) throw new ValidationError(`Le profil « ${label} » n’interdit rien.`);
				return { key: p.key, label, deny: JSON.stringify(deny), position };
			});
			const removed = service.profiles().filter(p => !seen.has(p.key));
			db.transaction(() => {
				q.clearProfiles.run();
				for (const p of profiles) q.insertProfile.run(p);
				for (const p of removed) q.deleteRoles.run(p.key);
			})();
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'restrictions.profiles', details: { count: profiles.length } });
			return service.profiles();
		},

		async apply(guildId, userId, key, reason) {
			const roleId = await ensureRole(guildId, getProfile(key));
			return executor.addRole(guildId, userId, roleId, reason);
		},

		async lift(guildId, userId, key, reason) {
			const roleId = q.role.get(guildId, key)?.role_id;
			if (!roleId) return 'not_member';
			return executor.removeRole(guildId, userId, roleId, reason);
		},

		// A channel created later also gets the restriction overwrites
		async syncChannel(guildId, channelId) {
			const rows = q.roles.all(guildId);
			if (!rows.length) return;
			const entries = rows.map(r => ({ roleId: r.role_id, deny: getProfileSafe(r.profile_key)?.deny })).filter(e => e.deny);
			await executor.applyRestrictionOverwrites(channelId, entries).catch(error => logger.warn(`Restriction overwrites not set on ${channelId}:`, error.message));
		},

		// Recreates missing roles and resets every overwrite, on one server or on the whole network
		async repair(actor, guildId = null) {
			if (!actor.can('restrictions.manage')) throw new ForbiddenError('Permission manquante : restrictions.manage');
			if (guildId && network.find(guildId)?.status !== 'active') throw new ValidationError('Ce serveur ne fait pas partie du réseau.');
			const guilds = guildId ? [guildId] : network.activeIds();
			const results = {};
			for (const id of guilds) {
				try {
					for (const profile of service.profiles()) {
						const roleId = await ensureRole(id, profile);
						await executor.ensureRestrictionRole(id, { roleId, name: `Restreint · ${profile.label}`, deny: profile.deny, resync: true });
					}
					results[id] = { ok: true };
				}
				catch (error) {
					results[id] = { ok: false, error: error.message };
				}
			}
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'restrictions.repair', guildId, results });
			return results;
		},
	};

	function getProfileSafe(key) {
		const row = q.profile.get(key);
		return row ? toProfile(row) : null;
	}

	return service;
}
