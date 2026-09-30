import { createHash } from 'node:crypto';
import { definePermission } from './permissions.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';

definePermission('permsync.view', { label: 'Voir les profils de permissions Discord', category: 'Permissions Discord' });
definePermission('permsync.manage', { label: 'Modifier et appliquer les profils de permissions', category: 'Permissions Discord' });

// Discord role permissions offered in the panel (names of discord.js PermissionFlagsBits)
export const DISCORD_PERMISSIONS = [
	['Administrator', 'Administrateur (toutes les permissions)', 'Administration'],
	['ManageGuild', 'Gérer le serveur', 'Administration'],
	['ManageRoles', 'Gérer les rôles', 'Administration'],
	['ManageChannels', 'Gérer les salons', 'Administration'],
	['ManageWebhooks', 'Gérer les webhooks', 'Administration'],
	['ManageGuildExpressions', 'Gérer les émojis et autocollants', 'Administration'],
	['ViewAuditLog', 'Voir les logs du serveur', 'Administration'],
	['ViewGuildInsights', 'Voir les statistiques du serveur', 'Administration'],
	['KickMembers', 'Expulser des membres', 'Modération'],
	['BanMembers', 'Bannir des membres', 'Modération'],
	['ModerateMembers', 'Exclure temporairement (timeout)', 'Modération'],
	['ManageMessages', 'Gérer les messages', 'Modération'],
	['ManageThreads', 'Gérer les fils', 'Modération'],
	['ManageNicknames', 'Gérer les pseudos', 'Modération'],
	['MentionEveryone', 'Mentionner @everyone et @here', 'Modération'],
	['ManageEvents', 'Gérer les événements', 'Modération'],
	['BypassSlowmode', 'Ignorer le mode lent', 'Modération'],
	['PinMessages', 'Épingler des messages', 'Modération'],
	['ViewChannel', 'Voir les salons', 'Membres'],
	['CreateInstantInvite', 'Créer une invitation', 'Membres'],
	['ChangeNickname', 'Changer de pseudo', 'Membres'],
	['SendMessages', 'Envoyer des messages', 'Texte'],
	['SendMessagesInThreads', 'Envoyer des messages dans les fils', 'Texte'],
	['CreatePublicThreads', 'Créer des fils publics', 'Texte'],
	['CreatePrivateThreads', 'Créer des fils privés', 'Texte'],
	['EmbedLinks', 'Intégrer des liens', 'Texte'],
	['AttachFiles', 'Joindre des fichiers', 'Texte'],
	['AddReactions', 'Ajouter des réactions', 'Texte'],
	['UseExternalEmojis', 'Émojis externes', 'Texte'],
	['UseExternalStickers', 'Autocollants externes', 'Texte'],
	['ReadMessageHistory', 'Voir l’historique des messages', 'Texte'],
	['UseApplicationCommands', 'Utiliser les commandes', 'Texte'],
	['SendVoiceMessages', 'Messages vocaux', 'Texte'],
	['SendPolls', 'Créer des sondages', 'Texte'],
	['Connect', 'Se connecter', 'Vocal'],
	['Speak', 'Parler', 'Vocal'],
	['Stream', 'Vidéo et partage d’écran', 'Vocal'],
	['UseVAD', 'Détection de la voix', 'Vocal'],
	['PrioritySpeaker', 'Voix prioritaire', 'Vocal'],
	['MuteMembers', 'Rendre muet', 'Vocal'],
	['DeafenMembers', 'Mettre en sourdine', 'Vocal'],
	['MoveMembers', 'Déplacer des membres', 'Vocal'],
	['UseSoundboard', 'Soundboard', 'Vocal'],
	['UseEmbeddedActivities', 'Activités', 'Vocal'],
].map(([key, label, group]) => ({ key, label, group }));

const KNOWN = new Set(DISCORD_PERMISSIONS.map(p => p.key));

// Profiles: for each rank, the Discord permissions its linked roles must have on every server.
export function createPermissionSync({ db, network, ranks, audit, executor, logs, settings, now = Date.now }) {
	logs.registerCategory('permissions', 'Permissions Discord (écarts, profils appliqués)');

	const q = {
		all: db.prepare('SELECT * FROM permission_profiles'),
		get: db.prepare('SELECT * FROM permission_profiles WHERE rank_id = ?'),
		upsert: db.prepare(`
			INSERT INTO permission_profiles (rank_id, permissions, updated_at, updated_by) VALUES (?, ?, ?, ?)
			ON CONFLICT(rank_id) DO UPDATE SET permissions = excluded.permissions, updated_at = excluded.updated_at, updated_by = excluded.updated_by
		`),
		delete: db.prepare('DELETE FROM permission_profiles WHERE rank_id = ?'),
		links: db.prepare('SELECT guild_id, role_id FROM rank_roles WHERE rank_id = ?'),
	};

	function profiles() {
		return Object.fromEntries(q.all.all().map(r => [r.rank_id, { permissions: JSON.parse(r.permissions), updatedAt: r.updated_at, updatedBy: r.updated_by }]));
	}

	function requireManage(actor, rankId) {
		if (!actor.can('permsync.manage')) throw new ForbiddenError('Permission manquante : permsync.manage');
		const rank = ranks.get(rankId);
		if (!actor.isOwner && rank.level >= actor.level) throw new ForbiddenError('Tu ne peux gérer que des rangs de niveau inférieur au tien.');
		return rank;
	}

	// Every (rank, server, role) with a profile, and how the role differs from it
	async function preview(rankId = null) {
		const active = new Map(network.list().filter(g => g.status === 'active' && g.botPresent).map(g => [g.id, g.name]));
		const rows = [];
		for (const [id, profile] of Object.entries(profiles())) {
			if (rankId && Number(id) !== Number(rankId)) continue;
			const rank = ranks.get(Number(id));
			const wanted = new Set(profile.permissions);
			for (const { guild_id: guildId, role_id: roleId } of q.links.all(Number(id))) {
				if (!active.has(guildId)) continue;
				const role = await executor.getRolePermissions(guildId, roleId).catch(() => null);
				if (!role) {
					rows.push({ rankId: rank.id, rankName: rank.name, guildId, guildName: active.get(guildId), roleId, roleName: null, missing: [], extra: [], editable: false, error: 'Rôle introuvable' });
					continue;
				}
				const current = new Set(role.permissions);
				rows.push({
					rankId: rank.id,
					rankName: rank.name,
					guildId,
					guildName: active.get(guildId),
					roleId,
					roleName: role.name,
					missing: [...wanted].filter(p => !current.has(p)),
					extra: [...current].filter(p => KNOWN.has(p) && !wanted.has(p)),
					editable: role.editable,
				});
			}
		}
		return rows;
	}

	return {
		catalogue: () => DISCORD_PERMISSIONS,
		profiles,
		preview,

		setProfile(actor, rankId, permissions) {
			const rank = requireManage(actor, rankId);
			if (permissions === null) {
				q.delete.run(rankId);
			}
			else {
				if (!Array.isArray(permissions)) throw new ValidationError('permissions doit être une liste.');
				const unknown = permissions.filter(p => !KNOWN.has(p));
				if (unknown.length) throw new ValidationError(`Permissions Discord inconnues : ${unknown.join(', ')}`);
				if (permissions.includes('Administrator') && !actor.isOwner) {
					throw new ForbiddenError('Seul le chef du réseau peut donner la permission Administrateur.');
				}
				q.upsert.run(rankId, JSON.stringify([...new Set(permissions)]), now(), actor.id);
			}
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'permissions.profile', target: String(rankId), details: { rank: rank.name, permissions: permissions ?? 'profil supprimé' } });
			return profiles()[rankId] ?? null;
		},

		// Applies the profile(s) to every linked role that differs
		async apply(actor, rankId = null) {
			if (!actor.can('permsync.manage')) throw new ForbiddenError('Permission manquante : permsync.manage');
			if (rankId) requireManage(actor, rankId);
			const all = profiles();
			const rows = (await preview(rankId)).filter(r => r.roleName && (r.missing.length || r.extra.length));
			const results = {};
			let applied = 0;
			for (const row of rows) {
				if (!actor.isOwner && ranks.get(row.rankId).level >= actor.level) continue;
				const key = `${row.guildId}:${row.roleId}`;
				try {
					await executor.setRolePermissions(row.guildId, row.roleId, all[row.rankId].permissions, `Profil du rang ${row.rankName}`);
					results[key] = { ok: true };
					applied++;
				}
				catch (error) {
					results[key] = { ok: false, error: error.message };
				}
			}
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'permissions.apply', target: rankId ? String(rankId) : 'tous', details: { roles: applied }, results });
			return { applied, failed: Object.values(results).filter(r => !r.ok).length, results };
		},

		// Periodic check: reports differences once (until they change), never fixes them by itself
		async checkDrift() {
			const drift = (await preview()).filter(r => r.missing.length || r.extra.length);
			const fingerprint = createHash('sha256').update(JSON.stringify(drift.map(r => [r.guildId, r.roleId, r.missing, r.extra]))).digest('hex');
			if (!drift.length || settings.get('permissions.lastDrift') === fingerprint) {
				if (!drift.length) settings.set('permissions.lastDrift', null);
				return drift;
			}
			settings.set('permissions.lastDrift', fingerprint);
			audit.record({
				actorId: 'system',
				source: 'system',
				action: 'permissions.drift',
				target: `${drift.length} rôle(s)`,
				details: {
					roles: drift.slice(0, 10).map(r => `${r.guildName} · @${r.roleName} (${r.rankName}) : ${[...r.missing.map(p => `+${p}`), ...r.extra.map(p => `-${p}`)].join(' ')}`),
				},
			});
			return drift;
		},

		// Rank deleted: its profile goes with it (ON DELETE CASCADE); nothing else to do
		get(rankId) {
			const row = q.get.get(rankId);
			if (!row) throw new NotFoundError('Aucun profil pour ce rang.');
			return JSON.parse(row.permissions);
		},
	};
}
