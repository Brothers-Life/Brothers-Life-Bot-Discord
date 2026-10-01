import mysql from 'mysql2/promise';
import { definePermission } from './permissions.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';

definePermission('fivemdata.view', { label: 'Voir les fiches joueurs FiveM (personnages, métier, temps de jeu, sanctions en jeu)', category: 'FiveM' });
definePermission('fivemdata.economy', { label: 'Voir l’argent, la banque et la boutique premium des joueurs FiveM', category: 'FiveM' });
definePermission('fivemdata.inventory', { label: 'Voir l’inventaire et les coffres de véhicules des joueurs FiveM', category: 'FiveM' });
definePermission('fivemdata.logs', { label: 'Voir les logs d’administration du jeu', category: 'FiveM' });
definePermission('fivemdata.manage', { label: 'Configurer la connexion à la base de données FiveM', category: 'FiveM' });

const SNOWFLAKE = /^\d{17,20}$/;
const json = (text, fallback = null) => {
	try {
		return typeof text === 'string' ? JSON.parse(text) : text ?? fallback;
	}
	catch {
		return fallback;
	}
};
const ms = value => (value ? new Date(value).getTime() : null);

export function normalizeDbConfig(input = {}, previous = {}) {
	const host = String(input.host ?? '').trim().slice(0, 200);
	const database = String(input.database ?? '').trim().slice(0, 64);
	const user = String(input.user ?? '').trim().slice(0, 80);
	if (input.enabled && (!host || !database || !user)) throw new ValidationError('Hôte, base et utilisateur sont nécessaires.');
	if (database && !/^[\w$-]+$/.test(database)) throw new ValidationError('Nom de base invalide.');
	const port = Math.round(Number(input.port ?? 3306));
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ValidationError('Port invalide.');
	return {
		enabled: Boolean(input.enabled),
		host, port, database, user,
		// Empty = keep the saved one (the panel never receives it)
		password: input.password ? String(input.password).slice(0, 200) : previous.password ?? '',
	};
}

// Read-only access to the FiveM (Qbox) database: player sheets for the staff, from the panel and the bot.
// Only SELECT queries; tables that do not exist on this server are simply skipped.
export function createFivemData({ audit, settings, logger = console, now = Date.now, createPool = mysql.createPool }) {
	let pool = null;
	let poolKey = null;
	let tables = null;

	const config = () => normalizeDbConfig(settings.get('fivemdb.config', {}), settings.get('fivemdb.config', {}));

	function connection() {
		const cfg = config();
		if (!cfg.enabled) throw new ValidationError('La base de données FiveM n’est pas configurée (page Joueurs FiveM, réglages).');
		const key = JSON.stringify([cfg.host, cfg.port, cfg.database, cfg.user, cfg.password]);
		if (!pool || poolKey !== key) {
			pool?.end().catch(() => undefined);
			pool = createPool({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database, connectionLimit: 3, connectTimeout: 8000, charset: 'utf8mb4', dateStrings: false, supportBigNumbers: true, bigNumberStrings: true });
			poolKey = key;
			tables = null;
		}
		return pool;
	}

	async function query(sql, params = []) {
		try {
			const [rows] = await connection().query({ sql, timeout: 10_000 }, params);
			return rows;
		}
		catch (error) {
			if (error instanceof ValidationError) throw error;
			logger.warn('FiveM database:', error.message);
			throw new ValidationError(`Base FiveM injoignable : ${error.code ?? error.message}`);
		}
	}

	// Which tables this server has (features without their table are skipped)
	async function has(name) {
		if (!tables) tables = new Set((await query('SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()')).map(r => r.t));
		return tables.has(name);
	}
	// A part of the sheet that fails (unexpected column on this server) is left empty, not the whole sheet
	async function when(table, run, fallback = []) {
		if (!(await has(table))) return fallback;
		try {
			return await run();
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
		const rows = await when('management_groups', () => query('SELECT name, type, label, grades FROM management_groups'));
		return new Map(rows.map(g => [g.name, { label: g.label, type: g.type, grades: json(g.grades, {}) }]));
	}

	function need(actor, permission) {
		if (!actor.can(permission)) throw new ForbiddenError(`Permission manquante : ${permission}`);
	}

	const service = {
		// What the panel shows of the settings (never the password)
		settingsView() {
			const cfg = config();
			return { ...cfg, password: undefined, hasPassword: Boolean(cfg.password) };
		},

		async setConfig(actor, input) {
			need(actor, 'fivemdata.manage');
			const cfg = normalizeDbConfig(input, settings.get('fivemdb.config', {}));
			settings.set('fivemdb.config', cfg);
			pool?.end().catch(() => undefined);
			pool = null;
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'fivemdata.config', details: { hôte: cfg.host, base: cfg.database } });
			return service.settingsView();
		},

		// Connection test: tables found and what can be shown
		async test(actor) {
			need(actor, 'fivemdata.manage');
			tables = null;
			const [version] = await query('SELECT VERSION() AS v');
			await has('players');
			const wanted = ['users', 'players', 'bl_mc_sessions', 'admindash_sanctions', 'bans', 'player_vehicles', 'management_groups', 'admindash_reports', 'admindash_staff_sessions', 'premium_points'];
			return { version: version.v, tables: tables.size, features: Object.fromEntries(wanted.map(t => [t, tables.has(t)])) };
		},

		// Players by name (account or character), citizen ID, license, phone, plate or Discord ID; empty = latest seen
		async search(actor, text = '', limit = 30) {
			need(actor, 'fivemdata.view');
			const q = String(text).trim();
			const like = `%${q}%`;
			const rows = q
				? await query(`
					SELECT DISTINCT u.userid FROM users u
					LEFT JOIN players p ON p.userId = u.userid
					WHERE u.username LIKE ? OR u.discord = ? OR u.license = ? OR u.license2 = ? OR p.citizenid = ? OR p.phone_number = ?
						OR CONCAT_WS(' ', JSON_VALUE(p.charinfo, '$.firstname'), JSON_VALUE(p.charinfo, '$.lastname')) LIKE ?
						${(await has('player_vehicles')) ? 'OR p.citizenid IN (SELECT citizenid FROM player_vehicles WHERE plate LIKE ?)' : ''}
					LIMIT ?`,
				[like, `discord:${q}`, q, q, q.toUpperCase(), q, like, ...((await has('player_vehicles')) ? [like] : []), limit])
				: await query('SELECT u.userid FROM users u LEFT JOIN players p ON p.userId = u.userid GROUP BY u.userid ORDER BY MAX(p.last_updated) DESC LIMIT ?', [limit]);
			return service.summaries(rows.map(r => r.userid));
		},

		// One line per account: names, characters, last connection, online now, playtime
		async summaries(userIds) {
			if (!userIds.length) return [];
			const users = await query('SELECT userid, username, discord, license, license2 FROM users WHERE userid IN (?)', [userIds]);
			const chars = await query('SELECT userId, citizenid, charinfo, job, gang, last_updated FROM players WHERE userId IN (?)', [userIds]);
			const sessions = await when('bl_mc_sessions', () => query(`
				SELECT user_id, COUNT(*) AS count, MAX(joined_at) AS lastJoin,
					SUM(TIMESTAMPDIFF(SECOND, joined_at, COALESCE(left_at, NOW()))) AS seconds,
					SUM(left_at IS NULL AND joined_at > NOW() - INTERVAL 1 DAY) AS online
				FROM bl_mc_sessions WHERE user_id IN (?) GROUP BY user_id`, [userIds]));
			const groups = await groupsMap();
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
			if (!SNOWFLAKE.test(String(discordId))) return null;
			const [row] = await query('SELECT userid FROM users WHERE discord = ? LIMIT 1', [`discord:${discordId}`]);
			return row?.userid ?? null;
		},

		// Everything the staff may see about one account, filtered by permissions
		async player(actor, userId) {
			need(actor, 'fivemdata.view');
			const [u] = await query('SELECT userid, username, discord, license, license2, fivem FROM users WHERE userid = ?', [userId]);
			if (!u) throw new NotFoundError('Joueur introuvable dans la base FiveM.');
			const canMoney = actor.can('fivemdata.economy');
			const canInventory = actor.can('fivemdata.inventory');
			const groups = await groupsMap();
			const rows = await query('SELECT * FROM players WHERE userId = ? ORDER BY cid', [userId]);
			const characters = rows.map(r => character(r, groups));
			const cids = characters.map(c => c.citizenId);
			const licenses = [u.license, u.license2].filter(Boolean);
			const anyCid = cids.length ? cids : ['-'];

			const [sessions, sessionTotals, sessionChars, vehicles, groupsRows, duty, jail, sanctions, bans, reports, properties, flows, premium, premiumLogs, skins] = await Promise.all([
				when('bl_mc_sessions', () => query('SELECT id, joined_at, left_at, drop_reason, name FROM bl_mc_sessions WHERE user_id = ? ORDER BY joined_at DESC LIMIT 50', [userId])),
				when('bl_mc_sessions', () => query(`SELECT COUNT(*) AS count, MIN(joined_at) AS first, SUM(TIMESTAMPDIFF(SECOND, joined_at, COALESCE(left_at, NOW()))) AS seconds,
					SUM(CASE WHEN joined_at > NOW() - INTERVAL 7 DAY THEN TIMESTAMPDIFF(SECOND, joined_at, COALESCE(left_at, NOW())) ELSE 0 END) AS week,
					SUM(left_at IS NULL AND joined_at > NOW() - INTERVAL 1 DAY) AS online FROM bl_mc_sessions WHERE user_id = ?`, [userId]), [{}]),
				when('bl_mc_session_chars', () => query('SELECT sc.session_id, sc.citizenid FROM bl_mc_session_chars sc JOIN bl_mc_sessions s ON s.id = sc.session_id WHERE s.user_id = ? ORDER BY s.joined_at DESC LIMIT 100', [userId])),
				when('player_vehicles', () => query(`SELECT citizenid, vehicle, plate, fakeplate, garage, fuel, engine, body, state, depotprice, drivingdistance, nickname, favorite, last_out_at, owner_job, owner_gang${canInventory ? ', glovebox, trunk' : ''} FROM player_vehicles WHERE citizenid IN (?) OR license IN (?)`, [anyCid, licenses])),
				when('player_groups', () => query('SELECT citizenid, `group` AS name, type, grade, hired_at FROM player_groups WHERE citizenid IN (?)', [anyCid])),
				when('job_duty_time', () => query('SELECT citizenid, job_name, seconds FROM job_duty_time WHERE citizenid IN (?)', [anyCid])),
				when('xt_prison', () => query('SELECT identifier, jailtime FROM xt_prison WHERE identifier IN (?)', [anyCid])),
				when('admindash_sanctions', () => query('SELECT id, type, reason, duration_minutes, issued_by_name, created_at FROM admindash_sanctions WHERE target_dbid = ? ORDER BY created_at DESC LIMIT 100', [userId])),
				when('bans', () => query('SELECT id, reason, expire, bannedby FROM bans WHERE license IN (?) OR discord = ?', [licenses, u.discord ?? '-'])),
				when('admindash_reports', () => query('SELECT id, message, status, priority, category, claimed_by_name, resolved_by_name, created_at, resolved_at FROM admindash_reports WHERE sender_citizenid IN (?) ORDER BY created_at DESC LIMIT 50', [anyCid])),
				when('properties', () => query('SELECT id, owner, property_name, price, rent_interval FROM properties WHERE owner IN (?)', [anyCid])),
				canMoney ? when('bank_flows', () => query('SELECT created_at, kind, from_cid, to_cid, amount, note FROM bank_flows WHERE from_license IN (?) OR to_license IN (?) OR from_cid IN (?) OR to_cid IN (?) ORDER BY created_at DESC LIMIT 50', [licenses, licenses, anyCid, anyCid])) : [],
				canMoney ? Promise.all([
					when('premium_points', () => query('SELECT balance FROM premium_points WHERE license IN (?)', [licenses])),
					when('premium_loyalty', () => query('SELECT balance FROM premium_loyalty WHERE license IN (?)', [licenses])),
				]) : [[], []],
				canMoney ? when('premium_shop_logs', () => query('SELECT action, details, amount, entry_label, created_at FROM premium_shop_logs WHERE license IN (?) OR citizenid IN (?) ORDER BY created_at DESC LIMIT 50', [licenses, anyCid])) : [],
				when('playerskins', () => query('SELECT citizenid, COUNT(*) AS n FROM playerskins WHERE citizenid IN (?) GROUP BY citizenid', [anyCid])),
			]);
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
					state: v.state === 1 ? 'garage' : v.state === 2 ? 'fourrière' : 'dehors', fuel: v.fuel, engine: Math.round((v.engine ?? 1000) / 10), body: Math.round((v.body ?? 1000) / 10),
					depotPrice: v.depotprice, distance: v.drivingdistance, nickname: v.nickname, favorite: Boolean(v.favorite), lastOut: v.last_out_at ? v.last_out_at * 1000 : null,
					ownerJob: v.owner_job, ownerGang: v.owner_gang,
					...(canInventory ? { glovebox: json(v.glovebox, []).filter(Boolean).map(i => ({ name: i.name, count: i.count })), trunk: json(v.trunk, []).filter(Boolean).map(i => ({ name: i.name, count: i.count })) } : {}),
				})),
				sanctions: sanctions.map(s => ({ id: s.id, type: s.type, reason: s.reason, durationMinutes: s.duration_minutes, by: s.issued_by_name, at: ms(s.created_at) })),
				bans: bans.map(b => ({ id: b.id, reason: b.reason, expire: b.expire ? b.expire * 1000 : null, by: b.bannedby })),
				reports: reports.map(r => ({ id: r.id, message: r.message, status: r.status, priority: r.priority, category: r.category, claimedBy: r.claimed_by_name, resolvedBy: r.resolved_by_name, at: ms(r.created_at), resolvedAt: ms(r.resolved_at) })),
				economy: canMoney ? {
					total: characters.reduce((n, c) => n + Number(c.money.cash ?? 0) + Number(c.money.bank ?? 0), 0),
					flows: flows.map(f => ({ at: ms(f.created_at), kind: f.kind, from: f.from_cid ? charOf(f.from_cid) : null, to: f.to_cid ? charOf(f.to_cid) : null, amount: Number(f.amount), note: f.note })),
					premium: { points: Number(premium[0][0]?.balance ?? 0), loyalty: Number(premium[1][0]?.balance ?? 0), logs: premiumLogs.map(l => ({ action: l.action, label: l.entry_label, amount: l.amount, details: l.details, at: ms(l.created_at) })) },
				} : null,
				permissions: { economy: canMoney, inventory: canInventory, logs: actor.can('fivemdata.logs') },
			};
			// Who looked at whom: these sheets hold personal data
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'fivemdata.view', target: String(userId), details: { joueur: u.username } });
			return result;
		},

		// Admin actions done in game (admin menu), newest first
		async adminLogs(actor, { search = '', before = null, limit = 100 } = {}) {
			need(actor, 'fivemdata.logs');
			if (!(await has('admindash_audit_log'))) return [];
			const like = `%${String(search).trim()}%`;
			const rows = await query(`SELECT id, issued_by_name, action, target_name, details, created_at FROM admindash_audit_log
				WHERE (? = '' OR issued_by_name LIKE ? OR target_name LIKE ? OR action LIKE ? OR details LIKE ?) ${before ? 'AND id < ?' : ''}
				ORDER BY id DESC LIMIT ?`, [String(search).trim(), like, like, like, like, ...(before ? [before] : []), Math.min(200, limit)]);
			return rows.map(r => ({ id: r.id, by: r.issued_by_name, action: r.action, target: r.target_name, details: r.details, at: ms(r.created_at) }));
		},

		// Server overview: players, online now, playtime, staff in service, jobs headcount
		async overview(actor) {
			need(actor, 'fivemdata.view');
			const [[counts], online, week, staff, jobs, topPlay] = await Promise.all([
				query('SELECT (SELECT COUNT(*) FROM users) AS accounts, (SELECT COUNT(*) FROM players) AS characters'),
				when('bl_mc_sessions', () => query('SELECT COUNT(DISTINCT user_id) AS n FROM bl_mc_sessions WHERE left_at IS NULL AND joined_at > NOW() - INTERVAL 1 DAY'), [{ n: 0 }]),
				when('bl_mc_sessions', () => query('SELECT COUNT(DISTINCT user_id) AS players, SUM(TIMESTAMPDIFF(SECOND, joined_at, COALESCE(left_at, NOW()))) AS seconds FROM bl_mc_sessions WHERE joined_at > NOW() - INTERVAL 7 DAY'), [{}]),
				when('admindash_staff_sessions', () => query(`SELECT staff_name, role_name, SUM(TIMESTAMPDIFF(SECOND, started_at, COALESCE(ended_at, last_seen_at))) AS seconds, MAX(ended_at IS NULL AND last_seen_at > NOW() - INTERVAL 10 MINUTE) AS active
					FROM admindash_staff_sessions WHERE started_at > NOW() - INTERVAL 30 DAY GROUP BY staff_name, role_name ORDER BY seconds DESC LIMIT 20`)),
				when('player_groups', () => query('SELECT `group` AS name, type, COUNT(*) AS members FROM player_groups GROUP BY `group`, type ORDER BY members DESC')),
				when('bl_mc_sessions', () => query(`SELECT s.user_id, u.username, SUM(TIMESTAMPDIFF(SECOND, s.joined_at, COALESCE(s.left_at, NOW()))) AS seconds
					FROM bl_mc_sessions s JOIN users u ON u.userid = s.user_id WHERE s.joined_at > NOW() - INTERVAL 30 DAY GROUP BY s.user_id, u.username ORDER BY seconds DESC LIMIT 10`)),
			]);
			const groups = await groupsMap();
			return {
				accounts: Number(counts.accounts), characters: Number(counts.characters), online: Number(online[0]?.n ?? 0),
				week: { players: Number(week[0]?.players ?? 0), seconds: Number(week[0]?.seconds ?? 0) },
				staff: staff.map(s => ({ name: s.staff_name, role: s.role_name, seconds: Number(s.seconds ?? 0), active: Boolean(Number(s.active)) })),
				jobs: jobs.map(j => ({ name: j.name, label: groups.get(j.name)?.label ?? j.name, type: j.type, members: Number(j.members) })),
				topPlaytime: topPlay.map(t => ({ userId: t.user_id, username: t.username, seconds: Number(t.seconds) })),
				at: now(),
			};
		},

		async close() {
			await pool?.end().catch(() => undefined);
			pool = null;
		},
	};
	return service;
}
