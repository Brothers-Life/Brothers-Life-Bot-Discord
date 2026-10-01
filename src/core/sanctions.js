import { definePermission } from './permissions.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';
import { formatDuration } from './duration.js';

definePermission('sanctions.view', { label: 'Voir l’historique des sanctions', category: 'Sanctions' });
definePermission('sanctions.warn', { label: 'Avertir (warn)', category: 'Sanctions' });
definePermission('sanctions.timeout', { label: 'Mettre en timeout', category: 'Sanctions' });
definePermission('sanctions.kick', { label: 'Expulser', category: 'Sanctions' });
definePermission('sanctions.ban', { label: 'Bannir', category: 'Sanctions' });
definePermission('sanctions.revoke', { label: 'Débannir, lever un timeout ou une restriction, retirer un warn', category: 'Sanctions' });
definePermission('sanctions.restrict', { label: 'Restreindre (rôles de punition : muet, pas de vocal…)', category: 'Sanctions' });
definePermission('sanctions.edit', { label: 'Modifier la raison d’une sanction', category: 'Sanctions' });

export const SANCTION_TYPES = ['ban', 'kick', 'timeout', 'warn', 'restrict'];
const DURABLE = new Set(['ban', 'timeout', 'restrict']);
export const MAX_TIMEOUT_MS = 28 * 86_400_000;
const SNOWFLAKE = /^\d{17,20}$/;

const LABELS = { ban: 'banni', kick: 'expulsé', timeout: 'mis en timeout', warn: 'averti', restrict: 'restreint' };

// Network sanctions: one row per sanction, applied server by server with a result for each.
export function createSanctions({ db, audit, network, ranks, executor, restrictions, logger = console, now = Date.now }) {
	const q = {
		insert: db.prepare(`
			INSERT INTO sanctions (type, user_id, user_name, moderator_id, source, origin_guild_id, scope, reason, created_at, expires_at, results, profile)
			VALUES (@type, @userId, @userName, @moderatorId, @source, @originGuildId, @scope, @reason, @createdAt, @expiresAt, @results, @profile)
		`),
		get: db.prepare('SELECT * FROM sanctions WHERE id = ?'),
		setResults: db.prepare('UPDATE sanctions SET results = ? WHERE id = ?'),
		revoke: db.prepare('UPDATE sanctions SET revoked_at = ?, revoked_by = ?, revoke_reason = ? WHERE id = ? AND revoked_at IS NULL'),
		activeBans: db.prepare(`
			SELECT * FROM sanctions WHERE type = 'ban' AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
			ORDER BY created_at
		`),
		activeBansOf: db.prepare(`
			SELECT * FROM sanctions WHERE type = 'ban' AND user_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
		`),
		activeTimeoutsOf: db.prepare(`
			SELECT * FROM sanctions WHERE type = 'timeout' AND user_id = ? AND revoked_at IS NULL AND expires_at > ?
		`),
		dueBans: db.prepare('SELECT * FROM sanctions WHERE type IN (\'ban\', \'restrict\') AND revoked_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ?'),
		activeRestrictsOf: db.prepare(`
			SELECT * FROM sanctions WHERE type = 'restrict' AND user_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
		`),
		setReason: db.prepare('UPDATE sanctions SET reason = ? WHERE id = ?'),
	};

	function toSanction(row) {
		if (!row) return null;
		const at = now();
		return {
			id: row.id,
			type: row.type,
			userId: row.user_id,
			userName: row.user_name,
			moderatorId: row.moderator_id,
			source: row.source,
			originGuildId: row.origin_guild_id,
			scope: row.scope,
			reason: row.reason,
			createdAt: row.created_at,
			expiresAt: row.expires_at,
			revokedAt: row.revoked_at,
			revokedBy: row.revoked_by,
			revokeReason: row.revoke_reason,
			results: row.results ? JSON.parse(row.results) : {},
			profile: row.profile ?? null,
			active: !row.revoked_at && DURABLE.has(row.type) && (!row.expires_at || row.expires_at > at),
		};
	}

	function getOrThrow(id) {
		const sanction = toSanction(q.get.get(id));
		if (!sanction) throw new NotFoundError('Sanction introuvable.');
		return sanction;
	}

	function targetGuilds(scope, originGuildId) {
		if (scope === 'local') return originGuildId ? [originGuildId] : [];
		return network.activeIds();
	}

	async function checkTarget(actor, userId) {
		const target = await ranks.resolve(userId);
		if (target.isOwner) throw new ForbiddenError('Le chef du réseau ne peut pas être sanctionné.');
		if (!actor.isOwner && target.level > 0 && target.level >= actor.level) {
			throw new ForbiddenError('Tu ne peux pas sanctionner un membre du staff de niveau égal ou supérieur au tien.');
		}
	}

	// Runs `action` on each server; never throws, returns { guildId: { ok, error?, skipped? } }
	async function applyEach(guildIds, action) {
		const results = {};
		for (const guildId of guildIds) {
			try {
				const outcome = await action(guildId);
				results[guildId] = outcome === 'not_member' ? { ok: true, skipped: 'not_member' } : { ok: true };
			}
			catch (error) {
				results[guildId] = { ok: false, error: error.message ?? String(error), code: error.code ?? null };
				logger.warn(`Sanction failed on ${guildId}:`, error.message ?? error);
			}
		}
		return results;
	}

	// Set by the appeals service: whether this kind of sanction can be appealed (a button in the DM)
	let appealable = () => false;

	async function dm(userId, type, reason, durationMs, profile, sanctionId) {
		const what = type === 'restrict' && profile ? `${LABELS[type]} (${restrictions.getProfile(profile).label.toLowerCase()})` : LABELS[type];
		const lines = [`Tu as été **${what}** sur le réseau Brothers Life.`];
		if (reason) lines.push(`Raison : ${reason}`);
		if (DURABLE.has(type)) lines.push(`Durée : ${formatDuration(durationMs)}`);
		try {
			if (appealable(type)) {
				lines.push('', 'Tu penses que c’est une erreur ? Tu peux faire appel avec le bouton ci-dessous.');
				await executor.sendSanctionDM(userId, lines.join('\n'), sanctionId);
			}
			else {
				await executor.sendDM(userId, lines.join('\n'));
			}
		}
		catch {
			// Closed DMs are common: never block a sanction on it
		}
	}

	function record(actor, action, sanction, extra = {}) {
		audit.record({
			actorId: actor.id,
			source: actor.source ?? 'panel',
			action,
			guildId: sanction.originGuildId,
			target: sanction.userId,
			details: {
				sanctionId: sanction.id,
				user: sanction.userName,
				reason: sanction.reason,
				scope: sanction.scope,
				...(sanction.expiresAt ? { until: new Date(sanction.expiresAt).toISOString() } : {}),
				...(sanction.profile ? { profile: restrictions.getProfile(sanction.profile).label } : {}),
				...extra,
			},
			results: sanction.results,
		});
	}

	function validate({ type, userId, reason, durationMs, scope, originGuildId, profile }) {
		if (!SANCTION_TYPES.includes(type)) throw new ValidationError(`Type de sanction inconnu : ${type}`);
		if (!SNOWFLAKE.test(String(userId))) throw new ValidationError('ID Discord invalide.');
		if (reason && reason.length > 500) throw new ValidationError('La raison est limitée à 500 caractères.');
		if (!['network', 'local'].includes(scope)) throw new ValidationError('La portée doit être network ou local.');
		if (scope === 'local' && !originGuildId) throw new ValidationError('Une sanction locale doit indiquer un serveur.');
		if (type === 'timeout' && (!durationMs || durationMs > MAX_TIMEOUT_MS)) throw new ValidationError('Un timeout demande une durée de 28 jours maximum.');
		if (durationMs && !DURABLE.has(type)) throw new ValidationError('Seuls les bans, les timeouts et les restrictions peuvent avoir une durée.');
		if (type === 'restrict') restrictions.getProfile(profile ?? '');
		if (originGuildId && network.find(originGuildId)?.status !== 'active') throw new ValidationError('Ce serveur ne fait pas partie du réseau.');
	}

	async function insertAndApply({ type, userId, moderatorId, source, originGuildId, scope, reason, durationMs, skipGuild = null, deleteMessageSeconds = 0, profile = null }) {
		const user = await executor.getUser(userId).catch(() => null);
		const createdAt = now();
		const expiresAt = durationMs ? createdAt + durationMs : null;
		const { lastInsertRowid } = q.insert.run({
			type, userId, userName: user?.username ?? null, moderatorId, source, originGuildId, scope, reason: reason || null,
			createdAt, expiresAt, results: '{}', profile,
		});
		const id = Number(lastInsertRowid);

		// DM first: after a ban or kick we may no longer share a server with them
		if (source !== 'native') await dm(userId, type, reason, durationMs, profile, id);

		const guilds = targetGuilds(scope, originGuildId).filter(g => g !== skipGuild);
		const auditReason = `${reason || 'Sans raison'} (sanction #${id})`.slice(0, 500);
		let results = {};
		if (type === 'ban') results = await applyEach(guilds, g => executor.ban(g, userId, { reason: auditReason, deleteMessageSeconds }));
		if (type === 'kick') results = await applyEach(guilds, g => executor.kick(g, userId, auditReason));
		if (type === 'timeout') results = await applyEach(guilds, g => executor.timeout(g, userId, durationMs, auditReason));
		if (type === 'restrict') results = await applyEach(guilds, g => restrictions.apply(g, userId, profile, auditReason));
		if (skipGuild) results[skipGuild] = { ok: true, skipped: 'already_done' };

		q.setResults.run(JSON.stringify(results), id);
		return getOrThrow(id);
	}

	const service = {
		get: getOrThrow,

		setAppealable(check) {
			appealable = check;
		},

		list({ userId, type, active, guildId, before, limit = 50 } = {}) {
			const params = { limit: Math.min(Math.max(Number(limit) || 50, 1), 200), now: now(), userId, type, guildId, before };
			const where = [
				userId && 'user_id = @userId',
				type && 'type = @type',
				guildId && 'origin_guild_id = @guildId',
				before && 'id < @before',
			].filter(Boolean);
			if (active) where.push('revoked_at IS NULL AND type IN (\'ban\', \'timeout\', \'restrict\') AND (expires_at IS NULL OR expires_at > @now)');
			const sql = `SELECT * FROM sanctions ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT @limit`;
			return db.prepare(sql).all(params).map(toSanction);
		},

		// Changes the reason of a sanction (a typo, more details)
		setReason(actor, id, reason) {
			if (!actor.can('sanctions.edit')) throw new ForbiddenError('Permission manquante : sanctions.edit');
			const sanction = getOrThrow(id);
			const text = String(reason ?? '').trim();
			if (text.length > 500) throw new ValidationError('La raison est limitée à 500 caractères.');
			q.setReason.run(text || null, id);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'sanctions.edit', guildId: sanction.originGuildId, target: sanction.userId, details: { sanctionId: id, before: sanction.reason, reason: text || null } });
			return getOrThrow(id);
		},

		// Someone restricted comes back to a server: the restriction applies again
		async reapplyOnJoin(guildId, userId) {
			const active = q.activeRestrictsOf.all(String(userId), now()).map(toSanction)
				.filter(s => s.scope === 'network' || s.originGuildId === guildId);
			for (const sanction of active) {
				await restrictions.apply(guildId, userId, sanction.profile, `Restriction #${sanction.id} toujours en cours`)
					.catch(error => logger.warn(`Restriction #${sanction.id} not reapplied on ${guildId}:`, error.message));
			}
			return active.length;
		},

		isBanned(userId) {
			return q.activeBansOf.all(String(userId), now()).length > 0;
		},

		async create(actor, { type, userId, reason = '', durationMs = null, scope = 'network', originGuildId = null, deleteMessageSeconds = 0, profile = null }) {
			userId = String(userId);
			if (!actor.can(`sanctions.${type}`)) throw new ForbiddenError(`Permission manquante : sanctions.${type}`);
			validate({ type, userId, reason, durationMs, scope, originGuildId, profile });
			if (userId === actor.id) throw new ForbiddenError('Tu ne peux pas te sanctionner toi-même.');
			await checkTarget(actor, userId);

			const sanction = await insertAndApply({
				type, userId, moderatorId: actor.id, source: actor.source ?? 'panel', originGuildId, scope, reason, durationMs, deleteMessageSeconds,
				profile: type === 'restrict' ? profile : null,
			});
			record(actor, `sanctions.${type}`, sanction, durationMs ? { duration: formatDuration(durationMs) } : {});
			return sanction;
		},

		// Lifts a ban / timeout, or cancels a warn
		async revoke(actor, id, reason = '') {
			if (!actor.can('sanctions.revoke')) throw new ForbiddenError('Permission manquante : sanctions.revoke');
			const sanction = getOrThrow(id);
			if (sanction.revokedAt) throw new ValidationError('Cette sanction est déjà levée.');
			if (sanction.type === 'kick') throw new ValidationError('Une expulsion ne peut pas être annulée.');
			return revokeSanction(actor, sanction, reason);
		},

		// Unban a user everywhere (also lifts bans done outside the bot)
		async unbanUser(actor, userId, reason = '', { scope = 'network', originGuildId = null } = {}) {
			if (!actor.can('sanctions.revoke')) throw new ForbiddenError('Permission manquante : sanctions.revoke');
			userId = String(userId);
			const bans = q.activeBansOf.all(userId, now()).map(toSanction);
			if (bans.length) {
				let last;
				for (const ban of bans) last = await revokeSanction(actor, ban, reason);
				return last;
			}
			const results = await applyEach(targetGuilds(scope, originGuildId), g => executor.unban(g, userId, reason || 'Débannissement'));
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'sanctions.unban', guildId: originGuildId, target: userId, details: { reason, scope }, results });
			return { userId, results };
		},

		async untimeoutUser(actor, userId, reason = '', { scope = 'network', originGuildId = null } = {}) {
			if (!actor.can('sanctions.revoke')) throw new ForbiddenError('Permission manquante : sanctions.revoke');
			userId = String(userId);
			const timeouts = q.activeTimeoutsOf.all(userId, now()).map(toSanction);
			if (timeouts.length) {
				let last;
				for (const timeout of timeouts) last = await revokeSanction(actor, timeout, reason);
				return last;
			}
			const results = await applyEach(targetGuilds(scope, originGuildId), g => executor.timeout(g, userId, null, reason || 'Fin du timeout'));
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'sanctions.untimeout', guildId: originGuildId, target: userId, details: { reason, scope }, results });
			return { userId, results };
		},

		// Lifts the active restrictions of someone (all of them, or one profile)
		async unrestrictUser(actor, userId, { profile = null, reason = '' } = {}) {
			if (!actor.can('sanctions.revoke')) throw new ForbiddenError('Permission manquante : sanctions.revoke');
			const active = q.activeRestrictsOf.all(String(userId), now()).map(toSanction).filter(s => !profile || s.profile === profile);
			if (!active.length) throw new ValidationError('Aucune restriction en cours pour cette personne.');
			const lifted = [];
			for (const sanction of active) lifted.push(await revokeSanction(actor, sanction, reason));
			return lifted;
		},

		// --- Actions done directly in Discord (seen in the audit log) -------------------------
		async handleNative({ kind, guildId, userId, executorId, reason = null, until = null }) {
			if (network.find(guildId)?.status !== 'active') return null;
			const principal = await ranks.resolve(executorId);
			const actor = { ...principal, source: 'native', can: principal.can };
			const perm = { ban: 'sanctions.ban', kick: 'sanctions.kick', timeout: 'sanctions.timeout', unban: 'sanctions.revoke', untimeout: 'sanctions.revoke' }[kind];
			const propagate = actor.can(perm);

			if (kind === 'unban' || kind === 'untimeout') {
				const active = (kind === 'unban' ? q.activeBansOf : q.activeTimeoutsOf).all(String(userId), now()).map(toSanction);
				for (const sanction of active) {
					if (propagate || sanction.scope === 'local' && sanction.originGuildId === guildId) {
						await revokeSanction(actor, sanction, reason ?? 'Levée depuis Discord', guildId);
					}
				}
				if (!active.length) {
					audit.record({ actorId: executorId, source: 'native', action: `sanctions.${kind}`, guildId, target: userId, details: { reason, scope: 'local' } });
				}
				return null;
			}

			// Already known (e.g. a ban we applied ourselves and Discord echoed)
			if (kind === 'ban' && q.activeBansOf.all(String(userId), now()).some(s => s.scope === 'network')) return null;

			const durationMs = until ? Math.max(until - now(), 1000) : null;
			const sanction = await insertAndApply({
				type: kind,
				userId: String(userId),
				moderatorId: String(executorId),
				source: 'native',
				originGuildId: guildId,
				scope: propagate ? 'network' : 'local',
				reason,
				durationMs,
				skipGuild: guildId,
			});
			record(actor, `sanctions.${kind}`, sanction, { native: true, propagated: propagate });
			return sanction;
		},

		// A server joins the network: apply network bans there, import its own bans (without propagating them)
		async syncGuild(guildId) {
			const bans = q.activeBans.all(now()).map(toSanction);
			const existing = new Map((await executor.fetchBans(guildId).catch(() => [])).map(b => [b.userId, b]));
			let applied = 0, imported = 0;

			for (const ban of bans.filter(b => b.scope === 'network' && !existing.has(b.userId))) {
				try {
					await executor.ban(guildId, ban.userId, { reason: `${ban.reason || 'Sans raison'} (sanction #${ban.id})` });
					ban.results[guildId] = { ok: true };
					applied++;
				}
				catch (error) {
					ban.results[guildId] = { ok: false, error: error.message };
				}
				q.setResults.run(JSON.stringify(ban.results), ban.id);
			}

			const known = new Set(bans.map(b => b.userId));
			for (const [userId, entry] of existing) {
				if (known.has(userId)) continue;
				q.insert.run({
					type: 'ban', userId, userName: entry.username ?? null, moderatorId: 'unknown', source: 'native', originGuildId: guildId, scope: 'local',
					reason: entry.reason ?? null, createdAt: now(), expiresAt: null, results: JSON.stringify({ [guildId]: { ok: true, skipped: 'imported' } }), profile: null,
				});
				imported++;
			}

			audit.record({ actorId: 'system', source: 'system', action: 'sanctions.sync', guildId, target: guildId, details: { applied, imported } });
			return { applied, imported };
		},

		// Temporary bans reaching their end
		async expireDue() {
			const system = { id: 'system', source: 'system', isOwner: true, can: () => true };
			const due = q.dueBans.all(now()).map(toSanction);
			for (const sanction of due) await revokeSanction(system, sanction, sanction.type === 'ban' ? 'Fin du bannissement temporaire' : 'Fin de la restriction');
			return due.length;
		},
	};

	async function revokeSanction(actor, sanction, reason, skipGuild = null) {
		const changed = q.revoke.run(now(), actor.id, reason || null, sanction.id).changes;
		if (!changed) return getOrThrow(sanction.id);

		let results = {};
		const guilds = targetGuilds(sanction.scope, sanction.originGuildId).filter(g => g !== skipGuild);
		if (sanction.type === 'ban') results = await applyEach(guilds, g => executor.unban(g, sanction.userId, reason || `Fin de la sanction #${sanction.id}`));
		if (sanction.type === 'timeout') results = await applyEach(guilds, g => executor.timeout(g, sanction.userId, null, reason || `Fin de la sanction #${sanction.id}`));
		if (sanction.type === 'restrict') results = await applyEach(guilds, g => restrictions.lift(g, sanction.userId, sanction.profile, reason || `Fin de la sanction #${sanction.id}`));

		const revoked = getOrThrow(sanction.id);
		const action = { ban: 'sanctions.unban', timeout: 'sanctions.untimeout', warn: 'sanctions.unwarn', restrict: 'sanctions.unrestrict' }[sanction.type];
		audit.record({
			actorId: actor.id,
			source: actor.source ?? 'panel',
			action,
			guildId: sanction.originGuildId,
			target: sanction.userId,
			details: { sanctionId: sanction.id, user: sanction.userName, reason },
			results,
		});
		return revoked;
	}

	return service;
}
