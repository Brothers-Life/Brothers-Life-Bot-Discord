import { definePermission } from './permissions.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';
import { LOG_SOURCES, sourceSelect } from './fivem/logSources.js';
import { serverReport } from './fivem/serverReport.js';
import { insightsReport } from './fivem/insights.js';
import { mirrorQuery, seconds, unix, jfield } from './fivem/sql.js';

definePermission('fivemdata.view', { label: 'Voir les fiches joueurs FiveM (personnages, métier, temps de jeu, sanctions en jeu)', category: 'FiveM' });
definePermission('fivemdata.economy', { label: 'Voir l’argent, la banque et la boutique premium des joueurs FiveM', category: 'FiveM' });
definePermission('fivemdata.inventory', { label: 'Voir l’inventaire et les coffres de véhicules des joueurs FiveM', category: 'FiveM' });
definePermission('fivemdata.logs', { label: 'Voir tous les logs du jeu (menu admin, métiers, garages, coffres, MDT…)', category: 'FiveM' });
definePermission('fivemdata.manage', { label: 'Configurer la connexion à la base de données FiveM', category: 'FiveM' });

const SNOWFLAKE = /^\d{17,20}$/;

// Template variables about the FiveM account linked to a Discord member (see discordVars)
export const FIVEM_VARIABLES = [
	{ key: 'fivem.linked', label: 'Compte FiveM lié (Oui / Non)' },
	{ key: 'fivem.dbid', label: 'ID de compte en base (dbid)' },
	{ key: 'fivem.account', label: 'Nom du compte FiveM' },
	{ key: 'fivem.license', label: 'Licence Rockstar' },
	{ key: 'fivem.characters', label: 'Nombre de personnages' },
	{ key: 'fivem.characters.list', label: 'Tous les personnages avec leur citizenid' },
	{ key: 'fivem.character', label: 'Dernier personnage joué' },
	{ key: 'fivem.citizenid', label: 'Citizenid du dernier personnage' },
	{ key: 'fivem.phone', label: 'Téléphone du dernier personnage' },
	{ key: 'fivem.job', label: 'Métier' },
	{ key: 'fivem.job.grade', label: 'Grade dans le métier' },
	{ key: 'fivem.gang', label: 'Gang' },
	{ key: 'fivem.playtime', label: 'Temps de jeu total' },
	{ key: 'fivem.sessions', label: 'Nombre de connexions' },
	{ key: 'fivem.lastseen', label: 'Dernière connexion' },
	{ key: 'fivem.online', label: 'En jeu en ce moment (Oui / Non)' },
	{ key: 'fivem.sanctions', label: 'Sanctions reçues en jeu' },
];
const json = (text, fallback = null) => {
	try {
		return typeof text === 'string' ? JSON.parse(text) : text ?? fallback;
	}
	catch {
		return fallback;
	}
};
const ms = value => (value ? new Date(value).getTime() : null);
// Seconds a session lasted (still open: up to now)
const played = (from, to) => seconds(from, `COALESCE(${to}, NOW())`);

// Read-only view of the FiveM (Qbox) database: player sheets for the staff, from the panel and the bot.
// The game's tables are read from their mirror in PostgreSQL (schema "fivem", kept up to date by the bl_telemetry
// resource, see fivem/mirror.js): the game's MariaDB never has to be reachable. Tables this server does not have
// are simply skipped.
// discord: { activity(sinceDay) -> rows of the bot's Discord stats, members() -> ids on the main server } for the crossed stats
export function createFivemData({ db, mirror, audit, logger = console, now = Date.now, discord = null }) {
	const run = mirrorQuery(db);

	async function query(sql, params = []) {
		try {
			return await run(sql, params);
		}
		catch (error) {
			logger.warn('FiveM data:', error.message);
			throw new ValidationError(`Données FiveM illisibles : ${error.code ?? error.message}`);
		}
	}

	// Which tables the mirror has (features without their table are skipped)
	const has = async name => (await mirror.tables()).has(name);
	const enabled = () => has('users');
	async function ready() {
		if (!(await enabled())) throw new ValidationError('Aucune donnée FiveM reçue pour l’instant : installe la ressource bl_telemetry à jour sur le serveur de jeu.');
	}
	// A part of the sheet that fails (unexpected column on this server) is left empty, not the whole sheet
	async function when(table, fn, fallback = []) {
		if (!(await has(table))) return fallback;
		try {
			return await fn();
		}
		catch (error) {
			logger.warn(`FiveM ${table}:`, error.message);
			return fallback;
		}
	}

	function character(row, groups) {
		const info = json(row.charinfo, {});
		const job = json(row.job, {});
		const gang = json(row.gang, {});
		const meta = json(row.metadata, {});
		const label = (name, grade, type) => {
			const g = groups.get(name);
			return { name, label: g?.label ?? name, grade, gradeLabel: g?.grades?.[grade]?.name ?? null, type };
		};
		return {
			citizenId: row.citizenid,
			slot: row.cid,
			name: `${info.firstname ?? ''} ${info.lastname ?? ''}`.trim() || row.name,
			firstName: info.firstname ?? null,
			lastName: info.lastname ?? null,
			birthdate: info.birthdate ?? null,
			gender: info.gender === 1 || info.gender === '1' ? 'Femme' : info.gender === 0 || info.gender === '0' ? 'Homme' : null,
			nationality: info.nationality ?? null,
			backstory: info.backstory ?? null,
			phone: row.phone_number ?? info.phone ?? null,
			job: job.name ? { ...label(job.name, Number(job.grade?.level ?? job.grade ?? 0), 'job'), onDuty: Boolean(job.onduty), isBoss: Boolean(job.isboss) } : null,
			gang: gang.name && gang.name !== 'none' ? { ...label(gang.name, Number(gang.grade?.level ?? gang.grade ?? 0), 'gang'), isBoss: Boolean(gang.isboss) } : null,
			money: json(row.money, {}),
			coins: row.coins ?? null,
			vip: row.ae_vip ?? null,
			status: {
				dead: Boolean(meta.isdead), lastStand: Boolean(meta.inlaststand), handcuffed: Boolean(meta.ishandcuffed), inJail: Number(meta.injail ?? 0),
				health: meta.health ?? null, armor: meta.armor ?? null, hunger: meta.hunger ?? null, thirst: meta.thirst ?? null, stress: meta.stress ?? null,
			},
			identity: {
				bloodType: meta.bloodtype ?? null, fingerprint: meta.fingerprint ?? null, callsign: meta.callsign ?? null,
				licences: meta.licences ?? null, criminalRecord: meta.criminalrecord ?? null,
				reputation: { job: meta.jobrep ?? null, dealer: meta.dealerrep ?? null, crafting: meta.craftingrep ?? null },
			},
			inventory: json(row.inventory, []),
			lastUpdated: ms(row.last_updated),
			lastLoggedOut: ms(row.last_logged_out),
		};
	}

	async function groupsMap() {
		const rows = await when('management_groups', () => query('SELECT name, type, label, grades FROM fivem.management_groups'));
		return new Map(rows.map(g => [g.name, { label: g.label, type: g.type, grades: json(g.grades, {}) }]));
	}

	function need(actor, permission) {
		if (!actor.can(permission)) throw new ForbiddenError(`Permission manquante : ${permission}`);
	}

	// The log sources the actor may read and the mirror has; the date column is a datetime on most tables,
	// unix seconds or milliseconds on a few: read either way so that every source unions with the others
	async function visibleSources(actor, only) {
		const list = [];
		for (const src of LOG_SOURCES) {
			if (only && src.key !== only) continue;
			if (src.permission && !actor.can(src.permission)) continue;
			const columns = await mirror.columns(src.table);
			if (!columns) continue;
			if (!src.at) {
				const type = columns.find(c => c.name === 'created_at')?.type;
				if (!type) continue;
				list.push(type === 'timestamptz' ? src : { ...src, at: type === 'date' ? 'created_at::timestamptz' : unix('created_at') });
			}
			else {
				list.push(src);
			}
		}
		return list;
	}

	// Everything else known about a player, beyond the base sheet
	function playerExtras({ userId, cids, licenses, canMoney, canInventory }) {
		const lic = licenses.length ? licenses : ['-'];
		// The admin menu writes the license with or without its "license:" prefix
		const staffLic = [...lic, ...lic.map(l => l.replace(/^license2?:/, ''))];
		const money = (table, fn) => (canMoney ? when(table, fn) : []);
		return Promise.all([
			when('bl_mc_sessions', () => query(`SELECT ((joined_at AT TIME ZONE 'Europe/Paris')::date)::text AS d, COUNT(*) AS sessions, SUM(${played('joined_at', 'left_at')}) AS seconds
				FROM fivem.bl_mc_sessions WHERE user_id = ? AND joined_at > NOW() - INTERVAL '30 days' GROUP BY 1`, [userId])),
			when('player_jobs_activity', () => query('SELECT citizenid, job, last_checkin, last_checkout FROM fivem.player_jobs_activity WHERE citizenid = ANY(?) ORDER BY last_checkin DESC NULLS LAST LIMIT 30', [cids])),
			when('job_action_history', () => query('SELECT citizenid, job_name, action_label, amount, created_at FROM fivem.job_action_history WHERE citizenid = ANY(?) ORDER BY created_at DESC LIMIT 30', [cids])),
			when('job_safe_log', () => query('SELECT citizenid, job_name AS place, action, item, amount, reason, created_at FROM fivem.job_safe_log WHERE citizenid = ANY(?) ORDER BY created_at DESC LIMIT 30', [cids])),
			when('gang_safe_log', () => query('SELECT citizenid, gang_name AS place, action, NULL AS item, amount, reason, created_at FROM fivem.gang_safe_log WHERE citizenid = ANY(?) ORDER BY created_at DESC LIMIT 30', [cids])),
			when('harvest_zone_player_stats', () => query('SELECT citizenid, total_harvested FROM fivem.harvest_zone_player_stats WHERE citizenid = ANY(?)', [cids])),
			when('bl_crafting_logs', () => query('SELECT citizenid, result_item, crafted, requested, created_at FROM fivem.bl_crafting_logs WHERE citizenid = ANY(?) ORDER BY created_at DESC LIMIT 30', [cids])),
			when('mdt_audit', () => query(`SELECT actor_name, actor_role, field, effect, reason, ${unix('at')} AS at FROM fivem.mdt_audit WHERE target_cid = ANY(?) ORDER BY 6 DESC NULLS LAST LIMIT 30`, [cids])),
			when('mdt_calls', () => query(`SELECT code, title, place, state, ${unix('created_at')} AS at FROM fivem.mdt_calls WHERE caller_cid = ANY(?) ORDER BY created_at DESC LIMIT 20`, [cids])),
			when('admindash_staff_sessions', () => query(`SELECT role_name, COUNT(*) AS sessions, SUM(${seconds('started_at', 'COALESCE(ended_at, last_seen_at)')}) AS seconds,
				SUM(CASE WHEN started_at > NOW() - INTERVAL '30 days' THEN ${seconds('started_at', 'COALESCE(ended_at, last_seen_at)')} ELSE 0 END) AS recent,
				MAX(COALESCE(ended_at, last_seen_at)) AS "lastSeen", BOOL_OR(ended_at IS NULL AND last_seen_at > NOW() - INTERVAL '10 minutes') AS active
				FROM fivem.admindash_staff_sessions WHERE license = ANY(?) GROUP BY role_name`, [staffLic])),
			when('admindash_audit_log', () => query('SELECT action, target_name, details, created_at FROM fivem.admindash_audit_log WHERE issued_by_license = ANY(?) ORDER BY created_at DESC LIMIT 40', [staffLic])),
			when('mapeditor_audit', () => query('SELECT action, object_id, created_at FROM fivem.mapeditor_audit WHERE license = ANY(?) ORDER BY created_at DESC LIMIT 20', [lic])),
			when('carplay_logs', () => query('SELECT verdict, label, vehicle, created_at FROM fivem.carplay_logs WHERE identifier = ANY(?) ORDER BY created_at DESC LIMIT 20', [lic])),
			money('selfmenu_invoices', () => query('SELECT job_name, amount, settled, created_at FROM fivem.selfmenu_invoices WHERE issuer_cid = ANY(?) ORDER BY created_at DESC LIMIT 30', [cids])),
			money('sky_phone_billing_invoices', () => query('SELECT recipient_identifier, issuer_label, title, amount, status, issued_at, paid_at FROM fivem.sky_phone_billing_invoices WHERE recipient_identifier = ANY(?) ORDER BY issued_at DESC LIMIT 30', [cids])),
			money('sky_phone_bank_transactions', () => query('SELECT owner_identifier, kind, amount, label, created_at FROM fivem.sky_phone_bank_transactions WHERE owner_identifier = ANY(?) ORDER BY created_at DESC LIMIT 30', [cids])),
			money('job_payroll_lines', () => query('SELECT l.citizenid, r.job_name, l.grade, l.amount, l.duty_seconds, l.failed, r.created_at FROM fivem.job_payroll_lines l JOIN fivem.job_payroll_runs r ON r.id = l.run_id WHERE l.citizenid = ANY(?) ORDER BY r.created_at DESC LIMIT 20', [cids])),
			money('premium_crate_openings', () => query('SELECT kind, label, rarity, refund_points, created_at FROM fivem.premium_crate_openings WHERE license = ANY(?) OR citizenid = ANY(?) ORDER BY created_at DESC LIMIT 30', [lic, cids])),
			money('premium_shop_item_purchases', () => query('SELECT i.label, i.price, p.created_at FROM fivem.premium_shop_item_purchases p LEFT JOIN fivem.premium_shop_items i ON i.id = p.item_id WHERE p.license = ANY(?) OR p.citizenid = ANY(?) ORDER BY p.created_at DESC LIMIT 30', [lic, cids])),
			money('premium_gifts', () => query('SELECT sender_name, sender_license = ANY(?) AS sent, label, points_amount, status, created_at FROM fivem.premium_gifts WHERE sender_license = ANY(?) OR target_license = ANY(?) OR target_citizenid = ANY(?) ORDER BY created_at DESC LIMIT 30', [lic, lic, lic, cids])),
			canInventory ? when('ox_inventory', () => query('SELECT owner, name, data, lastupdated FROM fivem.ox_inventory WHERE owner = ANY(?)', [cids])) : [],
		]);
	}

	function shapeExtras(extras, charOf) {
		const [days, jobActivity, jobActions, jobSafe, gangSafe, harvest, crafting, mdtLookups, mdtCalls, staffSessions, staffActions, mapEdits, carplay,
			invoicesIssued, phoneInvoices, phoneBank, payroll, crates, purchases, gifts, stashes] = extras;
		const unixMs = v => (v ? Number(v) * (Number(v) > 1e11 ? 1 : 1000) : null);
		const sum = (rows, key) => rows.reduce((n, r) => n + Number(r[key] ?? 0), 0);
		const staff = staffSessions.length ? {
			roles: staffSessions.map(s => s.role_name),
			sessions: sum(staffSessions, 'sessions'),
			seconds: sum(staffSessions, 'seconds'),
			recentSeconds: sum(staffSessions, 'recent'),
			lastSeen: Math.max(0, ...staffSessions.map(s => ms(s.lastSeen) ?? 0)) || null,
			active: staffSessions.some(s => s.active),
			actions: staffActions.map(a => ({ action: a.action, target: a.target_name, details: a.details, at: ms(a.created_at) })),
		} : null;
		return {
			activity: days.map(d => ({ day: d.d, sessions: Number(d.sessions), hours: Math.round(Number(d.seconds) / 360) / 10 })),
			jobs: {
				checkins: jobActivity.map(j => ({ character: charOf(j.citizenid), job: j.job, checkin: unixMs(j.last_checkin), checkout: unixMs(j.last_checkout) })),
				actions: jobActions.map(a => ({ character: charOf(a.citizenid), job: a.job_name, action: a.action_label, amount: a.amount, at: ms(a.created_at) })),
				safe: [...jobSafe, ...gangSafe].sort((a, b) => ms(b.created_at) - ms(a.created_at)).map(l => ({ character: charOf(l.citizenid), place: l.place, action: l.action, item: l.item, amount: l.amount, reason: l.reason, at: ms(l.created_at) })),
				payroll: payroll.map(p => ({ character: charOf(p.citizenid), job: p.job_name, grade: p.grade, amount: Number(p.amount ?? 0), dutySeconds: Number(p.duty_seconds ?? 0), failed: Boolean(p.failed), at: ms(p.created_at) })),
				invoices: invoicesIssued.map(i => ({ job: i.job_name, amount: Number(i.amount), settled: Boolean(i.settled), at: ms(i.created_at) })),
			},
			skills: {
				harvested: sum(harvest, 'total_harvested'),
				crafting: crafting.map(c => ({ character: charOf(c.citizenid), item: c.result_item, crafted: Number(c.crafted ?? 0), requested: Number(c.requested ?? 0), at: ms(c.created_at) })),
			},
			police: {
				lookups: mdtLookups.map(m => ({ by: m.actor_name, role: m.actor_role, field: m.field, effect: m.effect, reason: m.reason, at: ms(m.at) })),
				calls: mdtCalls.map(c => ({ code: c.code, title: c.title, place: c.place, state: c.state, at: ms(c.at) })),
			},
			phone: phoneInvoices.length || phoneBank.length ? {
				invoices: phoneInvoices.map(i => ({ character: charOf(i.recipient_identifier), from: i.issuer_label, title: i.title, amount: Number(i.amount ?? 0), status: i.status, at: ms(i.issued_at), paidAt: ms(i.paid_at) })),
				bank: phoneBank.map(t => ({ character: charOf(t.owner_identifier), kind: t.kind, amount: Number(t.amount ?? 0), label: t.label, at: ms(t.created_at) })),
			} : null,
			shop: crates.length || purchases.length || gifts.length ? {
				crates: crates.map(c => ({ kind: c.kind, label: c.label, rarity: c.rarity, refund: Number(c.refund_points ?? 0), at: ms(c.created_at) })),
				purchases: purchases.map(p => ({ label: p.label ?? '?', price: Number(p.price ?? 0), at: ms(p.created_at) })),
				gifts: gifts.map(g => ({ sent: Boolean(g.sent), from: g.sender_name, label: g.label, points: Number(g.points_amount ?? 0), status: g.status, at: ms(g.created_at) })),
			} : null,
			staff,
			creations: { mapEdits: mapEdits.map(m => ({ action: m.action, object: m.object_id, at: ms(m.created_at) })), carplay: carplay.map(c => ({ verdict: c.verdict, label: c.label ?? c.vehicle, at: ms(c.created_at) })) },
			stashes: stashes.map(st => ({ owner: charOf(st.owner), name: st.name, items: json(st.data, []).filter(Boolean).map(i => ({ name: i.name, count: i.count })), at: ms(st.lastupdated) })),
		};
	}

	const WANTED_TABLES = ['users', 'players', 'bl_mc_sessions', 'admindash_sanctions', 'bans', 'player_vehicles', 'management_groups', 'admindash_reports', 'admindash_staff_sessions', 'premium_points'];

	const service = {
		// What the panel shows of the data source: the mirror sent by bl_telemetry, and how fresh it is
		async settingsView() {
			const status = await mirror.status();
			return { enabled: status.tables.some(t => t.name === 'users'), source: 'mirror', lastSync: status.lastSync, tables: status.tables.length };
		},

		// The database is no longer reached from here: nothing to set (kept for older panels)
		async setConfig(actor) {
			need(actor, 'fivemdata.manage');
			return service.settingsView();
		},

		// State of the mirror: tables received, what can be shown, last sync of each table
		async test(actor) {
			need(actor, 'fivemdata.manage');
			const status = await mirror.status();
			const found = new Set(status.tables.map(t => t.name));
			return { version: 'miroir bl_telemetry', tables: found.size, lastSync: status.lastSync, features: Object.fromEntries(WANTED_TABLES.map(t => [t, found.has(t)])), detail: status.tables };
		},

		// Players by name (account or character), citizen ID, license, phone, plate or Discord ID; empty = latest seen
		async search(actor, text = '', limit = 30) {
			need(actor, 'fivemdata.view');
			await ready();
			const q = String(text).trim();
			const like = `%${q.replace(/[\\%_]/g, c => `\\${c}`)}%`;
			const plates = await has('player_vehicles');
			const rows = q
				? await query(`
					SELECT DISTINCT u.userid FROM fivem.users u
					LEFT JOIN fivem.players p ON p."userId" = u.userid
					WHERE u.username ILIKE ? OR u.discord = ? OR u.license = ? OR u.license2 = ? OR p.citizenid = ? OR p.phone_number = ?
						OR CONCAT_WS(' ', ${jfield('p.charinfo', 'firstname')}, ${jfield('p.charinfo', 'lastname')}) ILIKE ?
						${plates ? 'OR p.citizenid IN (SELECT citizenid FROM fivem.player_vehicles WHERE plate ILIKE ?)' : ''}
					LIMIT ?`,
				[like, `discord:${q}`, q, q, q.toUpperCase(), q, like, ...(plates ? [like] : []), limit])
				: await query('SELECT u.userid FROM fivem.users u LEFT JOIN fivem.players p ON p."userId" = u.userid GROUP BY u.userid ORDER BY MAX(p.last_updated) DESC NULLS LAST LIMIT ?', [limit]);
			return service.summaries(rows.map(r => r.userid));
		},

		// One line per account: names, characters, last connection, online now, playtime
		async summaries(userIds) {
			if (!userIds.length) return [];
			// The character's name column, when this server has it: fallback for an unreadable charinfo
			const nameColumn = (await mirror.columns('players'))?.some(c => c.name === 'name') ? ', name' : '';
			const [users, chars, sessions, groups] = await Promise.all([
				query('SELECT userid, username, discord, license, license2 FROM fivem.users WHERE userid = ANY(?)', [userIds]),
				query(`SELECT "userId", citizenid, charinfo, job, gang, last_updated${nameColumn} FROM fivem.players WHERE "userId" = ANY(?)`, [userIds]),
				when('bl_mc_sessions', () => query(`
					SELECT user_id, COUNT(*) AS count, MAX(joined_at) AS "lastJoin", SUM(${played('joined_at', 'left_at')}) AS seconds,
						COUNT(*) FILTER (WHERE left_at IS NULL AND joined_at > NOW() - INTERVAL '1 day') AS online
					FROM fivem.bl_mc_sessions WHERE user_id = ANY(?) GROUP BY user_id`, [userIds])),
				groupsMap(),
			]);
			return userIds.map((id) => {
				const u = users.find(x => x.userid === id);
				if (!u) return null;
				const s = sessions.find(x => x.user_id === id);
				const own = chars.filter(c => c.userId === id).map(c => character(c, groups));
				return {
					userId: id,
					username: u.username,
					discordId: u.discord?.replace(/^discord:/, '') ?? null,
					characters: own.map(c => ({ citizenId: c.citizenId, name: c.name, job: c.job, gang: c.gang, lastUpdated: c.lastUpdated })),
					lastSeen: ms(s?.lastJoin) ?? Math.max(0, ...own.map(c => c.lastUpdated ?? 0)) ?? null,
					online: Number(s?.online ?? 0) > 0,
					playSeconds: Number(s?.seconds ?? 0),
					sessions: Number(s?.count ?? 0),
				};
			}).filter(Boolean);
		},

		// The account linked to a Discord member, if any
		async findByDiscord(discordId) {
			if (!SNOWFLAKE.test(String(discordId)) || !(await enabled())) return null;
			const [row] = await query('SELECT userid FROM fivem.users WHERE discord = ? LIMIT 1', [`discord:${discordId}`]);
			return row?.userid ?? null;
		},

		// The account of a Tebex buyer: FiveM (CFX.re) id first, Rockstar license next, else a unique exact name.
		// null when there is no FiveM data or nothing matches. Returns { userId, username, discordId, method }.
		async findByTebexPlayer({ uuid = '', name = '' } = {}) {
			if (!(await enabled())) return null;
			const id = String(uuid ?? '').trim().replace(/^(fivem|license):/i, '');
			const found = (row, method) => row && { userId: row.userid, username: row.username, discordId: row.discord?.replace(/^discord:/, '') || null, method };
			if (/^\d{1,12}$/.test(id)) {
				const [row] = await query('SELECT userid, username, discord FROM fivem.users WHERE fivem = ? LIMIT 1', [`fivem:${id}`]);
				if (row) return found(row, 'fivem');
			}
			if (/^[a-f0-9]{40}$/i.test(id)) {
				const [row] = await query('SELECT userid, username, discord FROM fivem.users WHERE license = ? OR license2 = ? LIMIT 1', [`license:${id}`, `license2:${id}`]);
				if (row) return found(row, 'license');
			}
			const player = String(name ?? '').trim();
			if (player) {
				const rows = await query('SELECT userid, username, discord FROM fivem.users WHERE username = ? LIMIT 2', [player.slice(0, 80)]);
				if (rows.length === 1) return found(rows[0], 'name');
			}
			return null;
		},

		// Variables {fivem.*} of a Discord member for message templates (tickets…). No IP, token or money.
		// null when there is no FiveM data; every key set to "inconnu" when the account is not linked.
		async discordVars(discordId) {
			if (!(await enabled())) return null;
			const empty = Object.fromEntries(FIVEM_VARIABLES.map(v => [v.key, 'inconnu']));
			const userId = await service.findByDiscord(discordId);
			if (!userId) return { ...empty, 'fivem.linked': 'Non' };
			const [[u], [summary], groups, rows, [sanctions]] = await Promise.all([
				query('SELECT userid, username, license FROM fivem.users WHERE userid = ?', [userId]),
				service.summaries([userId]),
				groupsMap(),
				query('SELECT * FROM fivem.players WHERE "userId" = ? ORDER BY last_updated DESC NULLS LAST', [userId]),
				when('admindash_sanctions', () => query('SELECT COUNT(*) AS n FROM fivem.admindash_sanctions WHERE target_dbid = ?', [userId]), [{ n: 0 }]),
			]);
			const chars = rows.map(r => character(r, groups));
			const main = chars[0];
			const or = (value, fallback = 'aucun') => (value === null || value === undefined || value === '' ? fallback : value);
			return {
				...empty,
				'fivem.linked': 'Oui',
				'fivem.dbid': userId,
				'fivem.account': or(u?.username, 'inconnu'),
				'fivem.license': or(u?.license?.replace(/^license:/, ''), 'inconnu'),
				'fivem.characters': chars.length,
				'fivem.characters.list': or(chars.map(c => `${c.name} (${c.citizenId})`).join(', ')),
				'fivem.character': or(main?.name),
				'fivem.citizenid': or(main?.citizenId),
				'fivem.phone': or(main?.phone),
				'fivem.job': or(main?.job?.label),
				'fivem.job.grade': or(main?.job?.gradeLabel ?? main?.job?.grade),
				'fivem.gang': or(main?.gang?.label),
				'fivem.playtime': `${Math.round((summary?.playSeconds ?? 0) / 3600)} h`,
				'fivem.sessions': summary?.sessions ?? 0,
				'fivem.lastseen': summary?.lastSeen ? new Date(summary.lastSeen).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' }) : 'jamais',
				'fivem.online': summary?.online ? 'Oui' : 'Non',
				'fivem.sanctions': Number(sanctions?.n) || 0,
			};
		},

		// Everything the staff may see about one account, filtered by permissions
		async player(actor, userId) {
			need(actor, 'fivemdata.view');
			await ready();
			const [u] = await query('SELECT userid, username, discord, license, license2, fivem FROM fivem.users WHERE userid = ?', [userId]);
			if (!u) throw new NotFoundError('Joueur introuvable dans la base FiveM.');
			const canMoney = actor.can('fivemdata.economy');
			const canInventory = actor.can('fivemdata.inventory');
			const groups = await groupsMap();
			const rows = await query('SELECT * FROM fivem.players WHERE "userId" = ? ORDER BY cid', [userId]);
			const characters = rows.map(r => character(r, groups));
			const cids = characters.map(c => c.citizenId);
			const licenses = [u.license, u.license2].filter(Boolean);
			const anyCid = cids.length ? cids : ['-'];
			const anyLicense = licenses.length ? licenses : ['-'];
			const vehicleColumns = await mirror.columns('player_vehicles') ?? [];
			const inventoryColumns = canInventory ? ['glovebox', 'trunk'].filter(c => vehicleColumns.some(k => k.name === c)) : [];

			const [sessions, sessionTotals, sessionChars, vehicles, groupsRows, duty, jail, sanctions, bans, reports, properties, flows, premium, premiumLogs, skins] = await Promise.all([
				when('bl_mc_sessions', () => query('SELECT id, joined_at, left_at, drop_reason, name FROM fivem.bl_mc_sessions WHERE user_id = ? ORDER BY joined_at DESC LIMIT 50', [userId])),
				when('bl_mc_sessions', () => query(`SELECT COUNT(*) AS count, MIN(joined_at) AS first, SUM(${played('joined_at', 'left_at')}) AS seconds,
					SUM(CASE WHEN joined_at > NOW() - INTERVAL '7 days' THEN ${played('joined_at', 'left_at')} ELSE 0 END) AS week,
					COUNT(*) FILTER (WHERE left_at IS NULL AND joined_at > NOW() - INTERVAL '1 day') AS online FROM fivem.bl_mc_sessions WHERE user_id = ?`, [userId]), [{}]),
				when('bl_mc_session_chars', () => query('SELECT sc.session_id, sc.citizenid FROM fivem.bl_mc_session_chars sc JOIN fivem.bl_mc_sessions s ON s.id = sc.session_id WHERE s.user_id = ? ORDER BY s.joined_at DESC LIMIT 100', [userId])),
				when('player_vehicles', () => query(`SELECT citizenid, vehicle, plate, fakeplate, garage, fuel, engine, body, state, depotprice, drivingdistance, nickname, favorite, last_out_at, owner_job, owner_gang${inventoryColumns.map(c => `, ${c}`).join('')} FROM fivem.player_vehicles WHERE citizenid = ANY(?) OR license = ANY(?)`, [anyCid, anyLicense])),
				when('player_groups', () => query('SELECT citizenid, "group" AS name, type, grade, hired_at FROM fivem.player_groups WHERE citizenid = ANY(?)', [anyCid])),
				when('job_duty_time', () => query('SELECT citizenid, job_name, seconds FROM fivem.job_duty_time WHERE citizenid = ANY(?)', [anyCid])),
				when('xt_prison', () => query('SELECT identifier, jailtime FROM fivem.xt_prison WHERE identifier = ANY(?)', [anyCid])),
				when('admindash_sanctions', () => query('SELECT id, type, reason, duration_minutes, issued_by_name, created_at FROM fivem.admindash_sanctions WHERE target_dbid = ? ORDER BY created_at DESC LIMIT 100', [userId])),
				when('bans', () => query('SELECT id, reason, expire, bannedby FROM fivem.bans WHERE license = ANY(?) OR discord = ?', [anyLicense, u.discord ?? '-'])),
				when('admindash_reports', () => query('SELECT id, message, status, priority, category, claimed_by_name, resolved_by_name, created_at, resolved_at FROM fivem.admindash_reports WHERE sender_citizenid = ANY(?) ORDER BY created_at DESC LIMIT 50', [anyCid])),
				when('properties', () => query('SELECT id, owner, property_name, price, rent_interval FROM fivem.properties WHERE owner = ANY(?)', [anyCid])),
				canMoney ? when('bank_flows', () => query('SELECT created_at, kind, from_cid, to_cid, amount, note FROM fivem.bank_flows WHERE from_license = ANY(?) OR to_license = ANY(?) OR from_cid = ANY(?) OR to_cid = ANY(?) ORDER BY created_at DESC LIMIT 50', [anyLicense, anyLicense, anyCid, anyCid])) : [],
				canMoney ? Promise.all([
					when('premium_points', () => query('SELECT balance FROM fivem.premium_points WHERE license = ANY(?)', [anyLicense])),
					when('premium_loyalty', () => query('SELECT balance FROM fivem.premium_loyalty WHERE license = ANY(?)', [anyLicense])),
				]) : [[], []],
				canMoney ? when('premium_shop_logs', () => query('SELECT action, details, amount, entry_label, created_at FROM fivem.premium_shop_logs WHERE license = ANY(?) OR citizenid = ANY(?) ORDER BY created_at DESC LIMIT 50', [anyLicense, anyCid])) : [],
				when('playerskins', () => query('SELECT citizenid, COUNT(*) AS n FROM fivem.playerskins WHERE citizenid = ANY(?) GROUP BY citizenid', [anyCid])),
			]);
			const extras = await playerExtras({ userId, cids: anyCid, licenses, canMoney, canInventory });
			const totals = sessionTotals[0] ?? {};
			const charOf = cid => characters.find(c => c.citizenId === cid)?.name ?? cid;
			const groupLabel = name => groups.get(name)?.label ?? name;

			const result = {
				account: {
					userId: u.userid, username: u.username, discordId: u.discord?.replace(/^discord:/, '') ?? null,
					license: u.license, license2: u.license2, fivemId: u.fivem?.replace(/^fivem:/, '') ?? null,
				},
				playtime: {
					online: Number(totals.online ?? 0) > 0,
					sessions: Number(totals.count ?? 0),
					firstSeen: ms(totals.first),
					totalSeconds: Number(totals.seconds ?? 0),
					weekSeconds: Number(totals.week ?? 0),
					lastSessions: sessions.map(s => ({
						joinedAt: ms(s.joined_at), leftAt: ms(s.left_at), dropReason: s.drop_reason, name: s.name,
						characters: sessionChars.filter(c => c.session_id === s.id).map(c => charOf(c.citizenid)),
					})),
				},
				characters: characters.map(c => ({
					...c,
					money: canMoney ? c.money : undefined,
					coins: canMoney ? c.coins : undefined,
					inventory: canInventory ? c.inventory.filter(Boolean).map(i => ({ name: i.name, count: i.count, slot: i.slot })) : undefined,
					outfits: Number(skins.find(s => s.citizenid === c.citizenId)?.n ?? 0),
					groups: groupsRows.filter(g => g.citizenid === c.citizenId).map(g => ({ name: g.name, label: groupLabel(g.name), type: g.type, grade: g.grade, gradeLabel: groups.get(g.name)?.grades?.[g.grade]?.name ?? null, hiredAt: ms(g.hired_at) })),
					duty: duty.filter(d => d.citizenid === c.citizenId).map(d => ({ job: d.job_name, label: groupLabel(d.job_name), seconds: Number(d.seconds) })),
					jail: Number(jail.find(j => j.identifier === c.citizenId)?.jailtime ?? 0),
					properties: properties.filter(p => p.owner === c.citizenId).map(p => ({ id: p.id, name: p.property_name, price: p.price, rentInterval: p.rent_interval })),
				})),
				vehicles: vehicles.map(v => ({
					owner: charOf(v.citizenid), model: v.vehicle, plate: v.plate, fakePlate: v.fakeplate || null, garage: v.garage,
					state: Number(v.state) === 1 ? 'garage' : Number(v.state) === 2 ? 'fourrière' : 'dehors', fuel: v.fuel, engine: Math.round((v.engine ?? 1000) / 10), body: Math.round((v.body ?? 1000) / 10),
					depotPrice: v.depotprice, distance: v.drivingdistance, nickname: v.nickname, favorite: Boolean(v.favorite), lastOut: v.last_out_at ? Number(v.last_out_at) * 1000 : null,
					ownerJob: v.owner_job, ownerGang: v.owner_gang,
					...(canInventory ? { glovebox: json(v.glovebox, []).filter(Boolean).map(i => ({ name: i.name, count: i.count })), trunk: json(v.trunk, []).filter(Boolean).map(i => ({ name: i.name, count: i.count })) } : {}),
				})),
				sanctions: sanctions.map(s => ({ id: s.id, type: s.type, reason: s.reason, durationMinutes: s.duration_minutes, by: s.issued_by_name, at: ms(s.created_at) })),
				bans: bans.map(b => ({ id: b.id, reason: b.reason, expire: b.expire ? Number(b.expire) * 1000 : null, by: b.bannedby })),
				reports: reports.map(r => ({ id: r.id, message: r.message, status: r.status, priority: r.priority, category: r.category, claimedBy: r.claimed_by_name, resolvedBy: r.resolved_by_name, at: ms(r.created_at), resolvedAt: ms(r.resolved_at) })),
				economy: canMoney ? {
					total: characters.reduce((n, c) => n + Number(c.money.cash ?? 0) + Number(c.money.bank ?? 0), 0),
					flows: flows.map(f => ({ at: ms(f.created_at), kind: f.kind, from: f.from_cid ? charOf(f.from_cid) : null, to: f.to_cid ? charOf(f.to_cid) : null, amount: Number(f.amount), note: f.note })),
					premium: { points: Number(premium[0][0]?.balance ?? 0), loyalty: Number(premium[1][0]?.balance ?? 0), logs: premiumLogs.map(l => ({ action: l.action, label: l.entry_label, amount: l.amount, details: l.details, at: ms(l.created_at) })) },
				} : null,
				permissions: { economy: canMoney, inventory: canInventory, logs: actor.can('fivemdata.logs') },
			};
			Object.assign(result, shapeExtras(extras, charOf));
			// Who looked at whom: these sheets hold personal data
			await audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'fivemdata.view', target: String(userId), details: { joueur: u.username } });
			return result;
		},

		// Every log of the game in one feed (admin menu, garages, jobs, MDT…), newest first; `before` is a timestamp in ms
		async gameLogs(actor, { source = '', search = '', before = null, limit = 100 } = {}) {
			need(actor, 'fivemdata.logs');
			const sources = await visibleSources(actor, source);
			if (!sources.length) return [];
			const q = String(search).trim();
			const like = `%${q.replace(/[\\%_]/g, c => `\\${c}`)}%`;
			// Each source sorted and cut first (its date index), the union only merges the newest rows of each
			const cap = Math.min(200, Number(limit) || 100);
			const filters = `${before ? ' AND at < to_timestamp(? / 1000.0)' : ''}${q ? ' AND (actor ILIKE ? OR action ILIKE ? OR target ILIKE ? OR details ILIKE ?)' : ''}`;
			const params = [];
			const parts = sources.map((src) => {
				params.push(...(before ? [Number(before)] : []), ...(q ? [like, like, like, like] : []), cap);
				return `(SELECT * FROM (${sourceSelect(src)}) s WHERE at IS NOT NULL${filters} ORDER BY at DESC LIMIT ?)`;
			});
			const rows = await query(`SELECT * FROM (${parts.join(' UNION ALL ')}) logs ORDER BY at DESC LIMIT ?`, [...params, cap]);
			return rows.map(r => ({ source: r.source, at: ms(r.at), actor: r.actor, action: r.action, target: r.target, details: r.details }));
		},

		// The log sources this server has, with their volume (all time from the mirror's count, 30 days by the date index)
		async logSources(actor) {
			need(actor, 'fivemdata.logs');
			const sources = await visibleSources(actor, '');
			if (!sources.length) return [];
			const totals = Object.fromEntries((await mirror.status()).tables.map(t => [t.name, t.rows]));
			const rows = await query(sources.map(src => `SELECT '${src.key}'::text AS source, COUNT(*) AS recent FROM fivem."${src.table}" WHERE ${src.at ?? 'created_at'} > NOW() - INTERVAL '30 days'`).join(' UNION ALL '));
			return sources.map((src) => {
				const r = rows.find(x => x.source === src.key);
				return { key: src.key, label: src.label, total: Number(totals[src.table] ?? 0), recent: Number(r?.recent ?? 0) };
			});
		},

		// Who holds what in game, per account: jobs and gangs (current and multi-job, with grade) and the staff role
		// seen at the last admin-menu session. Used to check Discord roles against the game.
		async memberships() {
			await ready();
			const groups = await groupsMap();
			const [users, chars, multi, staff] = await Promise.all([
				query('SELECT userid, username, discord, license, license2 FROM fivem.users'),
				query('SELECT "userId", citizenid, charinfo, job, gang FROM fivem.players'),
				when('player_groups', () => query('SELECT citizenid, "group" AS name, type, grade FROM fivem.player_groups')),
				when('admindash_staff_sessions', () => query(`SELECT DISTINCT ON (license) id, license, role_name, last_seen_at FROM fivem.admindash_staff_sessions
					WHERE started_at > NOW() - INTERVAL '60 days' ORDER BY license, id DESC`)),
			]);
			const byUser = new Map();
			for (const c of chars) byUser.set(c.userId, [...(byUser.get(c.userId) ?? []), c]);
			const byCid = new Map();
			for (const m of multi) byCid.set(m.citizenid, [...(byCid.get(m.citizenid) ?? []), m]);
			const hash = l => String(l ?? '').replace(/^license2?:/, '');
			// The same license is written with or without its "license:" prefix: the latest session wins
			const staffBy = new Map();
			for (const s of staff) {
				const cur = staffBy.get(hash(s.license));
				if (!cur || Number(s.id) > Number(cur.id)) staffBy.set(hash(s.license), s);
			}
			return users.map((u) => {
				const held = new Map();
				const add = (name, type, grade, holder) => {
					if (!name || name === 'none' || name === 'unemployed') return;
					const key = `${type}:${name}`;
					const cur = held.get(key);
					if (!cur || grade > cur.grade) held.set(key, { name, type, grade, label: groups.get(name)?.label ?? name, gradeLabel: groups.get(name)?.grades?.[grade]?.name ?? null, character: holder });
				};
				for (const c of byUser.get(u.userid) ?? []) {
					const name = character(c, groups).name;
					const job = json(c.job, {});
					const gang = json(c.gang, {});
					add(job.name, 'job', Number(job.grade?.level ?? job.grade ?? 0), name);
					add(gang.name, 'gang', Number(gang.grade?.level ?? gang.grade ?? 0), name);
					for (const g of byCid.get(c.citizenid) ?? []) add(g.name, g.type === 'gang' ? 'gang' : 'job', Number(g.grade ?? 0), name);
				}
				const role = [u.license, u.license2].map(l => l && staffBy.get(hash(l))).filter(Boolean).sort((a, b) => Number(b.id) - Number(a.id))[0];
				return {
					userId: u.userid, username: u.username, discordId: u.discord?.replace(/^discord:/, '') ?? null,
					groups: [...held.values()],
					staff: role ? { name: role.role_name, lastSeen: ms(role.last_seen_at) } : null,
				};
			});
		},

		// Every job, gang and staff role of the game, to link them to Discord roles
		async catalog(actor) {
			need(actor, 'fivemdata.view');
			const groups = await groupsMap();
			const staff = await when('admindash_roles', () => query('SELECT name, label FROM fivem.admindash_roles ORDER BY label'));
			return {
				jobs: [...groups.entries()].filter(([, g]) => g.type !== 'gang').map(([name, g]) => ({ name, label: g.label, grades: Object.entries(g.grades ?? {}).map(([grade, v]) => ({ grade: Number(grade), name: v?.name ?? grade })) })),
				gangs: [...groups.entries()].filter(([, g]) => g.type === 'gang').map(([name, g]) => ({ name, label: g.label, grades: Object.entries(g.grades ?? {}).map(([grade, v]) => ({ grade: Number(grade), name: v?.name ?? grade })) })),
				staff: staff.map(s => ({ name: s.name, label: s.label })),
			};
		},

		// Crossed statistics: attendance, retention, staff coverage, wealth, justice, phone, and Discord activity of the players
		async insights(actor) {
			need(actor, 'fivemdata.view');
			await ready();
			return insightsReport({ query, when, groupsMap, canMoney: actor.can('fivemdata.economy'), discordActivity: discord?.activity, discordMembers: discord?.members, now });
		},

		// The whole server: activity, jobs and gangs, vehicles, justice, world, staff, economy
		async server(actor) {
			need(actor, 'fivemdata.view');
			await ready();
			return serverReport({ query, when, groupsMap, canMoney: actor.can('fivemdata.economy'), now, rowCount: name => mirror.counted(name) });
		},

		// Server overview: players, online now, playtime, staff in service, jobs headcount
		async overview(actor) {
			need(actor, 'fivemdata.view');
			await ready();
			const [[counts], online, week, staff, jobs, topPlay] = await Promise.all([
				query(`SELECT (SELECT COUNT(*) FROM fivem.users) AS accounts, ${(await has('players')) ? '(SELECT COUNT(*) FROM fivem.players)' : '0'} AS characters`),
				when('bl_mc_sessions', () => query('SELECT COUNT(DISTINCT user_id) AS n FROM fivem.bl_mc_sessions WHERE left_at IS NULL AND joined_at > NOW() - INTERVAL \'1 day\''), [{ n: 0 }]),
				when('bl_mc_sessions', () => query(`SELECT COUNT(DISTINCT user_id) AS players, SUM(${played('joined_at', 'left_at')}) AS seconds FROM fivem.bl_mc_sessions WHERE joined_at > NOW() - INTERVAL '7 days'`), [{}]),
				when('admindash_staff_sessions', () => query(`SELECT staff_name, role_name, SUM(${seconds('started_at', 'COALESCE(ended_at, last_seen_at)')}) AS seconds,
					BOOL_OR(ended_at IS NULL AND last_seen_at > NOW() - INTERVAL '10 minutes') AS active
					FROM fivem.admindash_staff_sessions WHERE started_at > NOW() - INTERVAL '30 days' GROUP BY staff_name, role_name ORDER BY seconds DESC NULLS LAST LIMIT 20`)),
				when('player_groups', () => query('SELECT "group" AS name, type, COUNT(*) AS members FROM fivem.player_groups GROUP BY "group", type ORDER BY members DESC')),
				when('bl_mc_sessions', () => query(`SELECT s.user_id, u.username, SUM(${played('s.joined_at', 's.left_at')}) AS seconds
					FROM fivem.bl_mc_sessions s JOIN fivem.users u ON u.userid = s.user_id WHERE s.joined_at > NOW() - INTERVAL '30 days' GROUP BY s.user_id, u.username ORDER BY seconds DESC LIMIT 10`)),
			]);
			const groups = await groupsMap();
			return {
				accounts: Number(counts.accounts), characters: Number(counts.characters), online: Number(online[0]?.n ?? 0),
				week: { players: Number(week[0]?.players ?? 0), seconds: Number(week[0]?.seconds ?? 0) },
				staff: staff.map(s => ({ name: s.staff_name, role: s.role_name, seconds: Number(s.seconds ?? 0), active: Boolean(s.active) })),
				jobs: jobs.map(j => ({ name: j.name, label: groups.get(j.name)?.label ?? j.name, type: j.type, members: Number(j.members) })),
				topPlaytime: topPlay.map(t => ({ userId: t.user_id, username: t.username, seconds: Number(t.seconds) })),
				at: now(),
			};
		},

		// Nothing to close: the mirror lives in the bot's own database
		async close() {
			return undefined;
		},
	};
	return service;
}
