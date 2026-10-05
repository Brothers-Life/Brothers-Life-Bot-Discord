import { randomUUID } from 'node:crypto';
import { definePermission } from './permissions.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';
import { fillVars } from './cards.js';
import { assertFivemAllowed, usesFivem } from './variables.js';

definePermission('tebex.view', { label: 'Voir les achats de la boutique Tebex (montants compris)', category: 'Boutique' });
definePermission('tebex.manage', { label: 'Régler la boutique Tebex (clé, rôles des articles, liaisons des acheteurs)', category: 'Boutique' });

// Tebex Plugin API (docs.tebex.io/plugin): authenticated by the secret key of the game server, header X-Tebex-Secret
export const TEBEX_API = 'https://plugin.tebex.io';
const TIMEOUT = 10_000;
// Recent payments read on each poll (the API returns the newest first)
const POLL_LIMIT = 100;
// An unlinked buyer is looked up again in the FiveM database at most this often
const RELINK_MS = 10 * 60_000;
const DAY = 86_400_000;
const SNOWFLAKE = /^\d{17,20}$/;
const MAX_MAPPINGS = 200;
const DEFAULT_THANKS = 'Merci {achat.joueur} pour ton achat de {achat.articles} ! ❤️';

export const ACHAT_VARIABLES = [
	{ key: 'achat.joueur', label: 'Pseudo de l’acheteur (Tebex / FiveM)' },
	{ key: 'achat.articles', label: 'Articles achetés' },
	{ key: 'achat.montant', label: 'Montant payé (avec la devise)' },
	{ key: 'achat.id', label: 'Numéro du paiement Tebex' },
	{ key: 'achat.date', label: 'Date de l’achat' },
];

// complete: roles are given; revoked: refund or chargeback, roles are taken back; pending: nothing yet
export function statusKind(status) {
	const s = String(status ?? '').toLowerCase();
	if (/refund|charge.?back|dispute|revers|declin/.test(s)) return 'revoked';
	if (/^complete/.test(s)) return 'complete';
	return 'pending';
}

function parseDate(value) {
	if (!value) return null;
	// "2016-01-27T15:40:19+0000": the offset without colon is not ISO 8601 for every engine
	const ms = Date.parse(String(value).replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
	return Number.isFinite(ms) ? ms : null;
}

// One payment of GET /payments, kept defensive: fields missing on some stores stay null
export function normalizePayment(raw) {
	const id = Number(raw?.id);
	if (!Number.isSafeInteger(id) || id <= 0) return null;
	const packages = Array.isArray(raw.packages) ? raw.packages : [];
	return {
		id,
		status: String(raw.status ?? '').trim().slice(0, 40) || 'Inconnu',
		amount: raw.amount === undefined || raw.amount === null ? null : String(raw.amount).slice(0, 20),
		currency: String(raw.currency?.iso_4217 ?? (typeof raw.currency === 'string' ? raw.currency : '')).slice(0, 8) || null,
		playerUuid: String(raw.player?.uuid ?? '').trim().slice(0, 64) || null,
		playerName: String(raw.player?.name ?? '').trim().slice(0, 80) || null,
		packages: packages.filter(p => p && p.id !== undefined).map(p => ({ id: String(p.id).slice(0, 20), name: String(p.name ?? `Article ${p.id}`).slice(0, 100) })).slice(0, 25),
		paidAt: parseDate(raw.date),
	};
}

export function normalizeConfig(input = {}, network = null) {
	const thanks = input.thanks ?? {};
	const mappings = Array.isArray(input.mappings) ? input.mappings : [];
	if (mappings.length > MAX_MAPPINGS) throw new ValidationError(`${MAX_MAPPINGS} liaisons au maximum.`);
	const activeGuild = id => !network || network.find(id)?.status === 'active';
	const out = {
		enabled: input.enabled !== false,
		showPrice: Boolean(input.showPrice),
		removeOnRefund: input.removeOnRefund !== false,
		mappings: mappings.map((m) => {
			const packageId = String(m?.packageId ?? '').trim();
			if (!/^\d{1,20}$/.test(packageId)) throw new ValidationError('Chaque liaison doit viser un article Tebex (numéro d’article).');
			if (!SNOWFLAKE.test(String(m.guildId)) || !SNOWFLAKE.test(String(m.roleId))) throw new ValidationError('Serveur ou rôle Discord invalide.');
			if (!activeGuild(String(m.guildId))) throw new ValidationError('Ce serveur ne fait pas partie du réseau.');
			const days = m.days === null || m.days === undefined || m.days === '' ? null : Math.round(Number(m.days));
			if (days !== null && (!Number.isFinite(days) || days < 1 || days > 365)) throw new ValidationError('Durée d’un rôle de la boutique : entre 1 et 365 jours (vide = pour toujours).');
			return {
				id: typeof m.id === 'string' && m.id ? m.id.slice(0, 40) : randomUUID(),
				packageId,
				packageName: String(m.packageName ?? '').trim().slice(0, 100) || null,
				guildId: String(m.guildId),
				roleId: String(m.roleId),
				days,
			};
		}),
		thanks: {
			enabled: Boolean(thanks.enabled),
			guildId: SNOWFLAKE.test(String(thanks.guildId ?? '')) ? String(thanks.guildId) : null,
			channelId: SNOWFLAKE.test(String(thanks.channelId ?? '')) ? String(thanks.channelId) : null,
			template: String(thanks.template ?? DEFAULT_THANKS).trim().slice(0, 1800) || DEFAULT_THANKS,
		},
	};
	if (out.thanks.enabled && (!out.thanks.guildId || !out.thanks.channelId)) throw new ValidationError('Choisis le salon du message de remerciement.');
	if (out.thanks.enabled && !activeGuild(out.thanks.guildId)) throw new ValidationError('Le salon de remerciement doit être sur un serveur du réseau.');
	return out;
}

// Tebex store of the FiveM server, read by polling (the panel is not reachable from the internet, so no webhook).
// New payments: buyer linked to a Discord member (FiveM database or a manual link), roles of the articles given,
// a log and an optional thank-you message. Refunds and chargebacks take the roles back.
export function createTebex({ db, network, audit, executor, settings, logs, variables, fivemData = null, notify = null, fetchImpl = fetch, logger = console, now = Date.now }) {
	logs.registerCategory('tebex', 'Boutique');
	let running = false;

	const q = {
		get: db.prepare('SELECT * FROM tebex_payments WHERE id = ?'),
		insert: db.prepare(`
			INSERT OR IGNORE INTO tebex_payments (id, status, amount, currency, player_uuid, player_name, packages, paid_at, seen_at, baseline)
			VALUES (@id, @status, @amount, @currency, @playerUuid, @playerName, @packages, @paidAt, @seenAt, @baseline)
		`),
		setStatus: db.prepare('UPDATE tebex_payments SET status = ? WHERE id = ?'),
		setLink: db.prepare('UPDATE tebex_payments SET discord_id = ?, link_method = ? WHERE id = ?'),
		checked: db.prepare('UPDATE tebex_payments SET link_checked_at = ? WHERE id = ?'),
		logged: db.prepare('UPDATE tebex_payments SET logged_at = ? WHERE id = ?'),
		applied: db.prepare('UPDATE tebex_payments SET applied_at = ?, error = ? WHERE id = ?'),
		revoked: db.prepare('UPDATE tebex_payments SET revoked_at = ? WHERE id = ?'),
		seenPackages: db.prepare('SELECT packages FROM tebex_payments ORDER BY id DESC LIMIT 500'),
		grantsOf: db.prepare('SELECT * FROM tebex_grants WHERE payment_id = ? ORDER BY id'),
		activeGrant: db.prepare('SELECT * FROM tebex_grants WHERE payment_id = ? AND guild_id = ? AND role_id = ? AND removed_at IS NULL'),
		addGrant: db.prepare('INSERT INTO tebex_grants (payment_id, guild_id, user_id, role_id, temp_role_id, granted_at) VALUES (?, ?, ?, ?, ?, ?)'),
		closeGrant: db.prepare('UPDATE tebex_grants SET removed_at = ? WHERE id = ?'),
		// The same role still owed by another payment that was not refunded: it stays
		// (grants of an ended temporary role, given as the last parameter, owe nothing anymore)
		otherGrant: db.prepare(`
			SELECT 1 FROM tebex_grants g JOIN tebex_payments p ON p.id = g.payment_id
			WHERE g.payment_id != ? AND g.guild_id = ? AND g.user_id = ? AND g.role_id = ? AND g.removed_at IS NULL AND p.revoked_at IS NULL
				AND (g.temp_role_id IS NULL OR g.temp_role_id != ?) LIMIT 1
		`),
		// Another valid purchase sharing the same temporary role (its days were added on top)
		sharedTemp: db.prepare(`
			SELECT 1 FROM tebex_grants g JOIN tebex_payments p ON p.id = g.payment_id
			WHERE g.temp_role_id = ? AND g.id != ? AND g.removed_at IS NULL AND p.revoked_at IS NULL LIMIT 1
		`),
		knownLink: db.prepare('SELECT discord_id FROM tebex_links WHERE player_uuid = ?'),
		remember: db.prepare(`
			INSERT INTO tebex_links (player_uuid, discord_id, created_by, created_at) VALUES (?, ?, ?, ?)
			ON CONFLICT (player_uuid) DO UPDATE SET discord_id = excluded.discord_id, created_by = excluded.created_by, created_at = excluded.created_at
		`),
		// Temporary roles share the table of /role: moderation.expireTempRoles takes them off when due
		activeTemp: db.prepare('SELECT * FROM temp_roles WHERE guild_id = ? AND user_id = ? AND role_id = ? AND removed_at IS NULL'),
		tempById: db.prepare('SELECT * FROM temp_roles WHERE id = ?'),
		insertTemp: db.prepare('INSERT INTO temp_roles (guild_id, user_id, role_id, role_name, expires_at, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
		extendTemp: db.prepare('UPDATE temp_roles SET expires_at = ? WHERE id = ? AND removed_at IS NULL'),
		closeTemp: db.prepare('UPDATE temp_roles SET removed_at = ?, removed_by = ? WHERE id = ? AND removed_at IS NULL'),
		closeTempsFor: db.prepare('UPDATE temp_roles SET removed_at = ?, removed_by = ? WHERE guild_id = ? AND user_id = ? AND role_id = ? AND removed_at IS NULL'),
	};

	const secret = () => settings.get('tebex.secret', '');
	const config = () => normalizeConfig(settings.get('tebex.config', {}));
	const state = () => settings.get('tebex.state', {});

	function need(actor, permission) {
		if (!actor?.can(permission)) throw new ForbiddenError(`Permission manquante : ${permission}`);
	}

	async function call(path, key = secret()) {
		if (!key) throw new ValidationError('La boutique Tebex n’est pas configurée : ajoute la clé secrète du serveur de jeu.');
		let response;
		try {
			response = await fetchImpl(`${TEBEX_API}${path}`, { headers: { 'X-Tebex-Secret': key, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT) });
		}
		catch (error) {
			throw new ValidationError(`Tebex injoignable : ${error.message}`);
		}
		if (response.status === 401 || response.status === 403) throw new ValidationError('Clé secrète refusée par Tebex : vérifie la clé du serveur de jeu (Tebex → Game Servers).');
		if (!response.ok) throw new ValidationError(`Tebex a répondu ${response.status}.`);
		try {
			return await response.json();
		}
		catch {
			throw new ValidationError('Réponse illisible de Tebex.');
		}
	}

	const packagesOf = row => JSON.parse(row.packages || '[]');
	const amountText = row => (row.amount ? `${row.amount}${row.currency ? ` ${row.currency}` : ''}` : 'inconnu');
	const buyerName = row => row.player_name ?? row.player_uuid ?? 'inconnu';

	// The Discord member of a buyer: an earlier manual link, else the FiveM database (account id, license, exact name)
	async function tryLink(row, force = false) {
		if (row.discord_id) return row;
		if (!force && row.link_checked_at && now() - row.link_checked_at < RELINK_MS) return row;
		q.checked.run(now(), row.id);
		const known = row.player_uuid ? q.knownLink.get(row.player_uuid) : null;
		if (known) {
			q.setLink.run(known.discord_id, 'known', row.id);
			return q.get.get(row.id);
		}
		const account = fivemData ? await fivemData.findByTebexPlayer({ uuid: row.player_uuid, name: row.player_name }).catch((error) => {
			logger.warn('Tebex: FiveM lookup failed:', error.message);
			return null;
		}) : null;
		if (account?.discordId && SNOWFLAKE.test(account.discordId)) q.setLink.run(account.discordId, account.method, row.id);
		return q.get.get(row.id);
	}

	// Gives the roles of the articles; returns { given: [names], errors: [text] }
	async function apply(row, { refreshTemp = false } = {}) {
		const ids = new Set(packagesOf(row).map(p => p.id));
		const maps = config().mappings.filter(m => ids.has(m.packageId));
		const given = [];
		const errors = [];
		const roleNames = new Map();
		const roleName = async (guildId, roleId) => {
			if (!roleNames.has(guildId)) roleNames.set(guildId, new Map((await executor.listRoles(guildId).catch(() => [])).map(r => [r.id, r.name])));
			return roleNames.get(guildId).get(roleId) ?? roleId;
		};
		for (const m of maps) {
			const guild = network.find(m.guildId);
			const name = await roleName(m.guildId, m.roleId);
			try {
				if (guild?.status !== 'active') throw new Error(`serveur ${guild?.name ?? m.guildId} hors réseau`);
				const already = q.activeGrant.get(row.id, m.guildId, m.roleId);
				const outcome = await executor.addRole(m.guildId, row.discord_id, m.roleId, `Boutique Tebex : paiement #${row.id}${m.days ? ` (${m.days} j)` : ''}`);
				if (outcome === 'not_member') throw new Error(`pas sur ${guild.name}`);
				let tempId = already?.temp_role_id ?? null;
				if (m.days && (!already || refreshTemp)) {
					const temp = q.activeTemp.get(m.guildId, row.discord_id, m.roleId);
					// A second purchase adds its days on top of what is left
					if (temp) {
						q.extendTemp.run(Math.max(temp.expires_at, now()) + m.days * DAY, temp.id);
						tempId = temp.id;
					}
					else {
						tempId = Number(q.insertTemp.run(m.guildId, row.discord_id, m.roleId, name, now() + m.days * DAY, `Boutique Tebex : paiement #${row.id}`, 'system', now()).lastInsertRowid);
					}
				}
				// Bought for good: an earlier temporary grant of the same role no longer expires it
				if (!m.days) q.closeTempsFor.run(now(), 'system', m.guildId, row.discord_id, m.roleId);
				if (!already) q.addGrant.run(row.id, m.guildId, row.discord_id, m.roleId, tempId, now());
				given.push(`@${name}${m.days ? ` (${m.days} j)` : ''}${network.list().length > 1 ? ` · ${guild.name}` : ''}`);
			}
			catch (error) {
				logger.warn(`Tebex payment #${row.id}: role not given:`, error.message);
				errors.push(`@${name} : ${error.message}`);
			}
		}
		q.applied.run(now(), errors.length ? errors.join(' · ').slice(0, 500) : null, row.id);
		return { given, errors };
	}

	// Takes back the roles of a refunded payment (kept when another valid purchase still gives them)
	async function revokeGrants(row) {
		const removed = [];
		const packageIds = new Set(packagesOf(row).map(p => p.id));
		for (const grant of q.grantsOf.all(row.id).filter(g => !g.removed_at)) {
			q.closeGrant.run(now(), grant.id);
			// Temporary role ended by this refund: the other purchases cumulated on it are spent too
			let endedTemp = -1;
			const temp = grant.temp_role_id ? q.tempById.get(grant.temp_role_id) : null;
			if (temp && !temp.removed_at) {
				if (q.sharedTemp.get(temp.id, grant.id)) {
					// Cumulated with another purchase: only the days of this one are taken off
					const days = config().mappings.find(m => packageIds.has(m.packageId) && m.guildId === grant.guild_id && m.roleId === grant.role_id && m.days)?.days ?? 0;
					const left = temp.expires_at - days * DAY;
					if (left > now()) {
						q.extendTemp.run(left, temp.id);
					}
					else {
						q.closeTemp.run(now(), 'system', temp.id);
						endedTemp = temp.id;
					}
				}
				else {
					q.closeTemp.run(now(), 'system', temp.id);
				}
			}
			if (q.otherGrant.get(row.id, grant.guild_id, grant.user_id, grant.role_id, endedTemp)) continue;
			try {
				await executor.removeRole(grant.guild_id, grant.user_id, grant.role_id, `Boutique Tebex : paiement #${row.id} remboursé`);
				removed.push(grant.role_id);
			}
			catch (error) {
				logger.warn(`Tebex payment #${row.id}: role not removed:`, error.message);
			}
		}
		return removed;
	}

	function achatVars(row) {
		return {
			'achat.joueur': buyerName(row),
			'achat.articles': packagesOf(row).map(p => p.name).join(', ') || 'inconnu',
			'achat.montant': amountText(row),
			'achat.id': String(row.id),
			'achat.date': new Date(row.paid_at ?? row.seen_at).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' }),
		};
	}

	async function thank(row) {
		const { thanks } = config();
		if (!thanks.enabled || !thanks.channelId || network.find(thanks.guildId)?.status !== 'active') return;
		const base = row.discord_id
			? await variables.member(thanks.guildId, row.discord_id, { fivem: usesFivem(thanks.template) })
			: { ...(await variables.server(thanks.guildId)), 'user': buyerName(row), 'user.name': buyerName(row), 'user.username': buyerName(row) };
		const content = fillVars(thanks.template, { ...base, ...achatVars(row) }).slice(0, 2000);
		await executor.sendMessage(thanks.channelId, { payload: { content }, files: [], mentionUserIds: row.discord_id ? [row.discord_id] : [] });
	}

	function logPurchase(row, result) {
		const cfg = config();
		const fields = [
			{ name: 'Joueur', value: buyerName(row), inline: true },
			{ name: 'Discord', value: row.discord_id ? `<@${row.discord_id}>` : 'non lié', inline: true },
			{ name: 'Articles', value: packagesOf(row).map(p => p.name).join('\n').slice(0, 1000) || 'inconnu' },
		];
		if (cfg.showPrice) fields.push({ name: 'Montant', value: amountText(row), inline: true });
		if (result?.given.length) fields.push({ name: 'Rôles donnés', value: result.given.join('\n').slice(0, 1000) });
		if (result?.errors.length) fields.push({ name: 'Rôles non donnés', value: result.errors.join('\n').slice(0, 1000) });
		logs.log(null, 'tebex', {
			title: 'Achat sur la boutique',
			description: row.discord_id ? null : 'Acheteur non relié à un compte Discord : lie-le depuis la page Boutique du panel pour lui donner ses rôles.',
			fields,
			color: row.discord_id ? 'success' : 'warning',
			thumbnailUserId: row.discord_id ?? undefined,
			footer: `Paiement Tebex #${row.id}`,
		}, 'purchase');
		// Panel notification: someone has to link the buyer by hand to give the roles
		if (!row.discord_id) {
			try {
				notify?.({ type: 'tebex_unlinked', permission: 'tebex.view', title: 'Achat boutique à relier', body: `${buyerName(row)} · ${packagesOf(row).map(p => p.name).join(', ')}`.slice(0, 200), url: '/tebex' });
			}
			catch (error) {
				logger.warn('Tebex notification failed:', error.message);
			}
		}
	}

	function logRefund(row, removed) {
		logs.log(null, 'tebex', {
			title: /charge.?back|dispute/i.test(row.status) ? 'Paiement contesté (chargeback)' : 'Paiement remboursé',
			fields: [
				{ name: 'Joueur', value: buyerName(row), inline: true },
				{ name: 'Discord', value: row.discord_id ? `<@${row.discord_id}>` : 'non lié', inline: true },
				{ name: 'Articles', value: packagesOf(row).map(p => p.name).join('\n').slice(0, 1000) || 'inconnu' },
				{ name: 'Rôles retirés', value: removed.length ? removed.map(id => `<@&${id}>`).join(' ') : 'aucun' },
			],
			color: 'danger',
			thumbnailUserId: row.discord_id ?? undefined,
			footer: `Paiement Tebex #${row.id}`,
		}, 'refund');
	}

	// What to do with a stored payment after its status was read
	async function handle(id) {
		let row = q.get.get(id);
		if (!row || row.baseline) return;
		const kind = statusKind(row.status);
		if (kind === 'complete' && !row.revoked_at) {
			row = await tryLink(row);
			let result = null;
			if (row.discord_id && !row.applied_at) result = await apply(row);
			if (!row.logged_at) {
				q.logged.run(now(), row.id);
				logPurchase(row, result);
				await thank(row).catch(error => logger.warn('Tebex thank-you message:', error.message));
			}
		}
		else if (kind === 'revoked' && !row.revoked_at) {
			q.revoked.run(now(), row.id);
			const removed = config().removeOnRefund ? await revokeGrants(row) : [];
			if (row.logged_at) logRefund(row, removed);
		}
	}

	async function poll() {
		const key = secret();
		if (!key || !config().enabled || running) return { skipped: true };
		running = true;
		const before = state();
		try {
			const body = await call(`/payments?limit=${POLL_LIMIT}`, key);
			const list = (Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : []).map(normalizePayment).filter(Boolean).sort((a, b) => a.id - b.id);
			// First poll with this key: what already exists is only marked as seen (no flood of roles and messages)
			const firstRun = !before.initialized;
			const lastId = Number(before.lastId ?? 0);
			let fresh = 0;
			for (const p of list) {
				const row = q.get.get(p.id);
				if (!row) {
					q.insert.run({ ...p, packages: JSON.stringify(p.packages), seenAt: now(), baseline: firstRun || p.id <= lastId ? 1 : 0 });
					if (!firstRun && p.id > lastId) fresh++;
				}
				else if (row.status !== p.status) {
					q.setStatus.run(p.status, p.id);
				}
				if (!firstRun) await handle(p.id);
			}
			const maxId = Math.max(lastId, ...list.map(p => p.id));
			settings.set('tebex.state', { initialized: true, lastId: maxId, lastPollAt: now(), lastError: null, baseline: firstRun ? list.length : (before.baseline ?? 0) });
			return { fetched: list.length, fresh, firstRun };
		}
		catch (error) {
			settings.set('tebex.state', { ...before, lastPollAt: now(), lastError: error.message });
			throw error;
		}
		finally {
			running = false;
		}
	}

	function toPayment(row) {
		return {
			id: row.id,
			status: row.status,
			kind: statusKind(row.status),
			amount: row.amount,
			currency: row.currency,
			player: { uuid: row.player_uuid, name: row.player_name },
			packages: packagesOf(row),
			paidAt: row.paid_at,
			seenAt: row.seen_at,
			baseline: Boolean(row.baseline),
			discordId: row.discord_id,
			linkMethod: row.link_method,
			appliedAt: row.applied_at,
			revokedAt: row.revoked_at,
			error: row.error,
			grants: q.grantsOf.all(row.id).map(g => ({ guildId: g.guild_id, roleId: g.role_id, temporary: Boolean(g.temp_role_id), removedAt: g.removed_at })),
		};
	}

	const service = {
		config,
		poll,

		// Every ~2 min (src/index.js)
		async tick() {
			return poll();
		},

		// Settings and state shown by the panel: never the secret, only whether it is set
		view(actor) {
			need(actor, 'tebex.view');
			const s = state();
			const count = sql => db.prepare(sql).get().n;
			return {
				hasSecret: Boolean(secret()),
				config: config(),
				state: { initialized: Boolean(s.initialized), lastPollAt: s.lastPollAt ?? null, lastError: s.lastError ?? null, lastId: s.lastId ?? null },
				stats: {
					payments: count('SELECT COUNT(*) AS n FROM tebex_payments WHERE baseline = 0'),
					unlinked: count('SELECT COUNT(*) AS n FROM tebex_payments WHERE baseline = 0 AND discord_id IS NULL AND revoked_at IS NULL'),
					revoked: count('SELECT COUNT(*) AS n FROM tebex_payments WHERE baseline = 0 AND revoked_at IS NOT NULL'),
					// Sum of the last 30 days, per currency
					revenue: db.prepare(`SELECT currency, ROUND(SUM(CAST(amount AS REAL)), 2) AS total, COUNT(*) AS n FROM tebex_payments
						WHERE baseline = 0 AND revoked_at IS NULL AND COALESCE(paid_at, seen_at) >= ? GROUP BY currency`).all(now() - 30 * DAY),
				},
			};
		},

		// Empty / null removes the key; a new key starts again with a "first poll" (existing payments only marked)
		setSecret(actor, input) {
			need(actor, 'tebex.manage');
			const key = input === null ? '' : String(input ?? '').trim();
			if (key && !/^[\w-]{16,128}$/.test(key)) throw new ValidationError('Clé secrète Tebex invalide.');
			if (key !== secret()) settings.set('tebex.state', { ...state(), initialized: false, lastError: null });
			settings.set('tebex.secret', key);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'tebex.secret', details: { clé: key ? 'enregistrée' : 'retirée' } });
			return { hasSecret: Boolean(key) };
		},

		// Connection test: the store and game server the key belongs to (GET /information)
		async test(actor) {
			need(actor, 'tebex.manage');
			const info = await call('/information');
			return {
				store: info?.account?.name ?? null,
				domain: info?.account?.domain ?? null,
				currency: info?.account?.currency?.iso_4217 ?? null,
				game: info?.account?.game_type ?? null,
				server: info?.server?.name ?? null,
			};
		},

		// Articles of the store (GET /packages, deprecated by Tebex but still answered) + those seen in payments
		async packages(actor) {
			need(actor, 'tebex.manage');
			const byId = new Map();
			let error = null;
			try {
				const list = await call('/packages');
				for (const p of Array.isArray(list) ? list : []) {
					if (p?.id === undefined) continue;
					byId.set(String(p.id), { id: String(p.id), name: String(p.name ?? `Article ${p.id}`), category: p.category?.name ?? null, price: p.price ?? null });
				}
			}
			catch (e) {
				error = e.message;
			}
			for (const row of q.seenPackages.all()) {
				for (const p of JSON.parse(row.packages || '[]')) if (!byId.has(p.id)) byId.set(p.id, { id: p.id, name: p.name, category: null, price: null });
			}
			return { packages: [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr')), error };
		},

		setConfig(actor, input) {
			need(actor, 'tebex.manage');
			const previous = config();
			const next = normalizeConfig(input, network);
			assertFivemAllowed(actor, next.thanks.template, previous.thanks.template);
			settings.set('tebex.config', next);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'tebex.config', details: { liaisons: next.mappings.length, remerciement: next.thanks.enabled ? 'oui' : 'non', montant_dans_les_logs: next.showPrice ? 'oui' : 'non' } });
			return next;
		},

		payments(actor, { filter = 'all', search = '', before = null, limit = 50 } = {}) {
			need(actor, 'tebex.view');
			const where = ['1 = 1'];
			const params = {};
			if (filter === 'unlinked') where.push('discord_id IS NULL AND revoked_at IS NULL AND baseline = 0');
			if (filter === 'revoked') where.push('revoked_at IS NOT NULL');
			if (filter === 'errors') where.push('error IS NOT NULL');
			if (filter !== 'all' && filter !== 'baseline') where.push('baseline = 0');
			if (search) {
				where.push('(player_name LIKE @like OR player_uuid = @exact OR discord_id = @exact OR CAST(id AS TEXT) = @exact OR packages LIKE @like)');
				Object.assign(params, { like: `%${search}%`, exact: search });
			}
			if (before) {
				where.push('id < @before');
				params.before = Number(before);
			}
			const rows = db.prepare(`SELECT * FROM tebex_payments WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ${Math.min(100, Math.max(1, limit))}`).all(params);
			return rows.map(toPayment);
		},

		// Manual link (or unlink with null): roles given to someone else are taken back first
		async link(actor, id, { discordId = null, remember = true } = {}) {
			need(actor, 'tebex.manage');
			let row = q.get.get(id);
			if (!row) throw new NotFoundError('Paiement introuvable.');
			if (discordId !== null && !SNOWFLAKE.test(String(discordId))) throw new ValidationError('ID Discord invalide.');
			if (row.discord_id && row.discord_id !== discordId && row.applied_at) {
				await revokeGrants(row);
				q.applied.run(null, null, row.id);
			}
			q.setLink.run(discordId, discordId ? 'manual' : null, row.id);
			if (discordId && remember && row.player_uuid) q.remember.run(row.player_uuid, discordId, actor.id, now());
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'tebex.link', target: discordId ?? undefined, details: { paiement: `#${row.id}`, joueur: buyerName(row), discord: discordId ? `<@${discordId}>` : 'délié' } });
			row = q.get.get(id);
			if (discordId && statusKind(row.status) === 'complete' && !row.revoked_at && !row.applied_at) await apply(row);
			return toPayment(q.get.get(id));
		},

		// Gives the roles again (member came back, role fixed...): durations restart from now if none is running
		async reapply(actor, id) {
			need(actor, 'tebex.manage');
			let row = q.get.get(id);
			if (!row) throw new NotFoundError('Paiement introuvable.');
			if (statusKind(row.status) !== 'complete' || row.revoked_at) throw new ValidationError('Ce paiement n’est pas validé (remboursé, litige ou en attente).');
			row = await tryLink(row, true);
			if (!row.discord_id) throw new ValidationError('Acheteur non relié à un compte Discord : lie-le d’abord.');
			const result = await apply(row, { refreshTemp: false });
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'tebex.reapply', target: row.discord_id, details: { paiement: `#${row.id}`, rôles: result.given.join(', ') || 'aucun' } });
			return { ...result, payment: toPayment(q.get.get(id)) };
		},

		async pollNow(actor) {
			need(actor, 'tebex.manage');
			if (!secret()) throw new ValidationError('Ajoute d’abord la clé secrète Tebex.');
			if (running) throw new ValidationError('Une vérification est déjà en cours.');
			if (!config().enabled) throw new ValidationError('Le suivi des achats est en pause.');
			return poll();
		},
	};
	return service;
}
