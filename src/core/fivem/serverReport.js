import { unix, seconds } from './sql.js';

const ms = value => (value ? new Date(value).getTime() : null);
const num = value => Number(value ?? 0);
const json = (text, fallback) => {
	try {
		return typeof text === 'string' ? JSON.parse(text) : text ?? fallback;
	}
	catch {
		return fallback;
	}
};
const fullName = (charinfo, fallback) => {
	const info = json(charinfo, {});
	return `${info.firstname ?? ''} ${info.lastname ?? ''}`.trim() || fallback;
};
const isoDay = date => new Date(date).toISOString().slice(0, 10);
// A number of a JSON text column (NULL when absent or not a number, instead of failing the query)
const jnum = (col, key) => `(CASE WHEN (fivem.j(${col}) ->> '${key}') ~ '^-?[0-9]+([.][0-9]+)?$' THEN (fivem.j(${col}) ->> '${key}')::numeric END)`;
// Hours and weekdays as seen in France
const paris = col => `(${col} AT TIME ZONE 'Europe/Paris')`;

// Most players connected at once per day, from the sessions (sweep over joins and leaves)
export function peaks(sessions, nowMs) {
	const events = [];
	for (const s of sessions) {
		const start = ms(s.joined_at);
		const end = ms(s.left_at) ?? nowMs;
		if (!start || end < start) continue;
		events.push([start, 1], [end, -1]);
	}
	events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	const byDay = new Map();
	let current = 0;
	for (const [at, delta] of events) {
		current += delta;
		const day = isoDay(at);
		byDay.set(day, Math.max(byDay.get(day) ?? 0, current));
	}
	return byDay;
}

// Everything about the server as a whole; money only with the economy permission.
// rowCount(table): rows of a table only counted by the mirror (its rows are not copied), null when unknown
export async function serverReport({ query, when, groupsMap, canMoney, now = Date.now, rowCount = async () => null }) {
	const groups = await groupsMap();
	const label = name => groups.get(name)?.label ?? name;
	const days30 = 'INTERVAL \'30 days\'';

	const [
		sessions30, firsts, hourly, drops, onlineNow, totals,
		groupMembers, dutyFlags, dutyTotals, weekDuty, levels, openState, payroll, invoices, safeCounts, gangMeta,
		vehicleStates, topModels, byGarage, customGarages,
		jailed, sanctionTypes, sanctionsRecent, bans, reports, calls,
		safezones, safezoneVisits, harvestZones, harvestTop, counts,
		staffRoles, staffSessions, staffActions, staffSanctions, staffReports, staffMessages,
	] = await Promise.all([
		when('bl_mc_sessions', () => query(`SELECT user_id, joined_at, left_at FROM fivem.bl_mc_sessions WHERE joined_at > NOW() - ${days30} OR left_at IS NULL ORDER BY joined_at LIMIT 20000`)),
		// The day as text: a DATE would come back as a local midnight and could shift by one day
		when('bl_mc_sessions', () => query(`SELECT to_char(${paris('f')}, 'YYYY-MM-DD') AS d, COUNT(*) AS n FROM (SELECT MIN(joined_at) AS f FROM fivem.bl_mc_sessions GROUP BY user_id) x WHERE f > NOW() - ${days30} GROUP BY 1`)),
		// Monday = 0, like WEEKDAY() before
		when('bl_mc_sessions', () => query(`SELECT EXTRACT(ISODOW FROM ${paris('joined_at')}) - 1 AS dow, EXTRACT(HOUR FROM ${paris('joined_at')}) AS h, COUNT(DISTINCT user_id) AS n
			FROM fivem.bl_mc_sessions WHERE joined_at > NOW() - INTERVAL '60 days' GROUP BY 1, 2`)),
		when('bl_mc_sessions', () => query(`SELECT LEFT(drop_reason, 80) AS reason, COUNT(*) AS n FROM fivem.bl_mc_sessions WHERE drop_reason IS NOT NULL AND drop_reason <> '' AND joined_at > NOW() - ${days30} GROUP BY 1 ORDER BY n DESC LIMIT 10`)),
		when('bl_mc_sessions', () => query('SELECT s.user_id, u.username, s.joined_at FROM fivem.bl_mc_sessions s JOIN fivem.users u ON u.userid = s.user_id WHERE s.left_at IS NULL AND s.joined_at > NOW() - INTERVAL \'1 day\' ORDER BY s.joined_at')),
		when('bl_mc_sessions', () => query(`SELECT COUNT(*) AS sessions, COUNT(DISTINCT user_id) AS players, AVG(${seconds('joined_at', 'left_at')}) AS "avgSeconds",
			SUM(${seconds('joined_at', 'COALESCE(left_at, NOW())')}) AS seconds FROM fivem.bl_mc_sessions WHERE joined_at > NOW() - ${days30}`), [{}]),

		when('player_groups', () => query('SELECT "group" AS name, type, COUNT(*) AS members FROM fivem.player_groups GROUP BY "group", type')),
		query('SELECT fivem.j(job) ->> \'name\' AS name, SUM(CASE WHEN fivem.j(job) ->> \'onduty\' = \'true\' THEN 1 ELSE 0 END) AS "onDuty" FROM fivem.players GROUP BY 1'),
		when('job_duty_time', () => query('SELECT job_name, SUM(seconds) AS seconds FROM fivem.job_duty_time GROUP BY job_name')),
		when('job_week_duty', () => query('SELECT job_name, SUM(seconds) AS seconds, COUNT(DISTINCT citizenid) AS people FROM fivem.job_week_duty WHERE week_start = (SELECT MAX(week_start) FROM fivem.job_week_duty) GROUP BY job_name')),
		when('job_level_state', () => query('SELECT job_name, level, xp, title FROM fivem.job_level_state')),
		when('job_open_state', () => query('SELECT job_name, is_open, changed_by, changed_at FROM fivem.job_open_state')),
		canMoney ? when('job_payroll_runs', () => query('SELECT job_name, total_amount, employee_count, run_by_name, created_at FROM fivem.job_payroll_runs ORDER BY created_at DESC LIMIT 50')) : [],
		canMoney ? when('selfmenu_invoices', () => query('SELECT job_name, COUNT(*) AS count, SUM(amount) AS total, SUM(CASE WHEN settled <> 0 THEN 0 ELSE amount END) AS unpaid FROM fivem.selfmenu_invoices GROUP BY job_name')) : [],
		when('job_safe_log', () => query(`SELECT job_name, COUNT(*) AS n FROM fivem.job_safe_log WHERE created_at > NOW() - ${days30} GROUP BY job_name`)),
		when('qbx_gang_meta', () => query('SELECT gang_name, category, max_members, xp FROM fivem.qbx_gang_meta')),

		when('player_vehicles', () => query(`SELECT COUNT(*) AS total, SUM(CASE WHEN state = 0 THEN 1 ELSE 0 END) AS out_, SUM(CASE WHEN state = 1 THEN 1 ELSE 0 END) AS garage, SUM(CASE WHEN state = 2 THEN 1 ELSE 0 END) AS impound,
			SUM(CASE WHEN engine < 500 OR body < 500 THEN 1 ELSE 0 END) AS damaged, SUM(CASE WHEN fakeplate IS NOT NULL AND fakeplate <> '' THEN 1 ELSE 0 END) AS "fakePlates" FROM fivem.player_vehicles`), [{}]),
		when('player_vehicles', () => query('SELECT vehicle AS model, COUNT(*) AS n FROM fivem.player_vehicles GROUP BY vehicle ORDER BY n DESC LIMIT 12')),
		when('player_vehicles', () => query('SELECT garage, COUNT(*) AS n FROM fivem.player_vehicles WHERE garage IS NOT NULL AND state = 1 GROUP BY garage ORDER BY n DESC LIMIT 12')),
		when('qbx_custom_garages', () => query('SELECT COUNT(*) AS n FROM fivem.qbx_custom_garages'), [{ n: 0 }]),

		when('xt_prison', () => query('SELECT x.identifier, x.jailtime, p.charinfo FROM fivem.xt_prison x LEFT JOIN fivem.players p ON p.citizenid = x.identifier WHERE x.jailtime > 0 ORDER BY x.jailtime DESC')),
		when('admindash_sanctions', () => query(`SELECT type, COUNT(*) AS n FROM fivem.admindash_sanctions WHERE created_at > NOW() - ${days30} GROUP BY type`)),
		when('admindash_sanctions', () => query('SELECT id, target_dbid, target_name, type, reason, duration_minutes, issued_by_name, created_at FROM fivem.admindash_sanctions ORDER BY created_at DESC LIMIT 30')),
		when('bans', () => query('SELECT id, name, reason, expire, bannedby FROM fivem.bans ORDER BY id DESC')),
		when('admindash_reports', () => query('SELECT id, sender_name, message, status, priority, category, claimed_by_name, resolved_by_name, created_at, resolved_at FROM fivem.admindash_reports ORDER BY created_at DESC LIMIT 30')),
		when('mdt_calls', () => query(`SELECT id, code, title, place, priority, state, caller_name, closed_by, ${unix('created_at')} AS created, ${unix('closed_at')} AS closed FROM fivem.mdt_calls ORDER BY created_at DESC LIMIT 20`)),

		when('bl_safezones_zones', () => query('SELECT name, is_active FROM fivem.bl_safezones_zones ORDER BY name')),
		when('bl_safezones_visits', () => query('SELECT zone_name, COUNT(*) AS visits, SUM(seconds) AS seconds FROM fivem.bl_safezones_visits GROUP BY zone_name')),
		when('harvest_zones', () => query('SELECT id, label, item, amount, enabled, stock_enabled, current_stock, max_stock, access, access_value FROM fivem.harvest_zones ORDER BY label')),
		when('harvest_zone_player_stats', () => query('SELECT player_name, total_harvested FROM fivem.harvest_zone_player_stats ORDER BY total_harvested DESC LIMIT 10')),
		Promise.all([
			['blips', 'admindash_blips'], ['doors', 'ox_doorlock'], ['shops', 'shops'], ['markets', 'market_markets'], ['mapObjects', 'mapeditor_objects'],
			['craftingTables', 'bl_crafting_tables'], ['recipes', 'bl_crafting_recipes'], ['tvScreens', 'tv_screens'], ['billboards', 'billboards'], ['djVenues', 'dj_venues'],
			['teleports', 'qbx_teleport_overrides'], ['hotels', 'bl_hotels'], ['companies', 'sky_phone_company_profiles'], ['stashes', 'ox_inventory'], ['outfits', 'playerskins'],
		].map(async ([key, table]) => [key, num((await rowCount(table)) ?? (await when(table, () => query(`SELECT COUNT(*) AS n FROM fivem."${table}"`), [{ n: 0 }]))[0]?.n)])),

		when('admindash_roles', () => query('SELECT r.id, r.name, r.label, r.protected, COUNT(a.action_key) AS actions FROM fivem.admindash_roles r LEFT JOIN fivem.admindash_role_actions a ON a.role_id = r.id GROUP BY r.id, r.name, r.label, r.protected ORDER BY actions DESC')),
		when('admindash_staff_sessions', () => query(`SELECT staff_name, role_name, COUNT(*) AS sessions, SUM(${seconds('started_at', 'COALESCE(ended_at, last_seen_at)')}) AS seconds,
			MAX(COALESCE(ended_at, last_seen_at)) AS "lastSeen", MAX(CASE WHEN ended_at IS NULL AND last_seen_at > NOW() - INTERVAL '10 minutes' THEN 1 ELSE 0 END) AS active
			FROM fivem.admindash_staff_sessions WHERE started_at > NOW() - ${days30} GROUP BY staff_name, role_name`)),
		when('admindash_audit_log', () => query(`SELECT issued_by_name AS name, COUNT(*) AS n FROM fivem.admindash_audit_log WHERE created_at > NOW() - ${days30} GROUP BY 1`)),
		when('admindash_sanctions', () => query(`SELECT issued_by_name AS name, COUNT(*) AS n FROM fivem.admindash_sanctions WHERE created_at > NOW() - ${days30} GROUP BY 1`)),
		when('admindash_reports', () => query(`SELECT COALESCE(resolved_by_name, claimed_by_name) AS name, COUNT(*) AS n FROM fivem.admindash_reports WHERE created_at > NOW() - ${days30} AND COALESCE(resolved_by_name, claimed_by_name) IS NOT NULL GROUP BY 1`)),
		when('admindash_staffmsg_history', () => query('SELECT issued_by_name, line, target_label, created_at FROM fivem.admindash_staffmsg_history ORDER BY created_at DESC LIMIT 15')),
	]);

	// Activity per day over 30 days
	const nowMs = now();
	const peak = peaks(sessions30, nowMs);
	const perDay = new Map();
	for (const s of sessions30) {
		const day = isoDay(ms(s.joined_at));
		const entry = perDay.get(day) ?? { players: new Set(), sessions: 0, seconds: 0 };
		entry.players.add(s.user_id);
		entry.sessions += 1;
		entry.seconds += Math.max(0, ((ms(s.left_at) ?? nowMs) - ms(s.joined_at)) / 1000);
		perDay.set(day, entry);
	}
	const newByDay = new Map(firsts.map(f => [isoDay(ms(f.d)), num(f.n)]));
	const days = Array.from({ length: 30 }, (_, i) => isoDay(nowMs - (29 - i) * 86_400_000)).map((day) => {
		const e = perDay.get(day);
		return { day, players: e?.players.size ?? 0, sessions: e?.sessions ?? 0, hours: Math.round((e?.seconds ?? 0) / 360) / 10, peak: peak.get(day) ?? 0, newPlayers: newByDay.get(day) ?? 0 };
	});
	const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
	for (const h of hourly) grid[num(h.dow)][num(h.h)] = num(h.n);

	// Jobs and gangs, one line each with everything known about them
	const find = (rows, key, name) => rows.find(r => r[key] === name);
	const jobs = [...groups.entries()].map(([name, g]) => {
		const lastPayroll = find(payroll, 'job_name', name);
		const inv = find(invoices, 'job_name', name);
		const meta = find(gangMeta, 'gang_name', name);
		const level = find(levels, 'job_name', name);
		const open = find(openState, 'job_name', name);
		const week = find(weekDuty, 'job_name', name);
		return {
			name, label: g.label, type: g.type,
			grades: Object.entries(g.grades ?? {}).map(([grade, v]) => ({ grade: Number(grade), name: v?.name ?? grade, payment: v?.payment ?? null, isBoss: Boolean(v?.isboss) })),
			members: num(groupMembers.filter(m => m.name === name).reduce((n, m) => n + num(m.members), 0)),
			onDuty: num(find(dutyFlags, 'name', name)?.onDuty),
			dutySeconds: num(find(dutyTotals, 'job_name', name)?.seconds),
			weekDutySeconds: num(week?.seconds), weekPeople: num(week?.people),
			level: level ? { level: num(level.level), xp: num(level.xp), title: level.title } : null,
			open: open ? { isOpen: Boolean(open.is_open), by: open.changed_by } : null,
			payroll: lastPayroll ? { total: num(lastPayroll.total_amount), employees: num(lastPayroll.employee_count), by: lastPayroll.run_by_name, at: ms(lastPayroll.created_at) } : null,
			invoices: inv ? { count: num(inv.count), total: num(inv.total), unpaid: num(inv.unpaid) } : null,
			safeMoves: num(find(safeCounts, 'job_name', name)?.n),
			gang: meta ? { category: meta.category, maxMembers: meta.max_members, xp: num(meta.xp) } : null,
		};
	}).sort((a, b) => b.members - a.members || a.label.localeCompare(b.label));

	// Staff: one line per staff member with time in service, actions, sanctions and reports handled
	const staffByName = new Map();
	for (const s of staffSessions) {
		const cur = staffByName.get(s.staff_name) ?? { name: s.staff_name, roles: [], seconds: 0, sessions: 0, lastSeen: null, active: false };
		cur.roles.push(s.role_name);
		cur.seconds += num(s.seconds);
		cur.sessions += num(s.sessions);
		cur.lastSeen = Math.max(cur.lastSeen ?? 0, ms(s.lastSeen) ?? 0) || null;
		cur.active ||= Boolean(num(s.active));
		staffByName.set(s.staff_name, cur);
	}
	for (const [rows, key] of [[staffActions, 'actions'], [staffSanctions, 'sanctions'], [staffReports, 'reports']]) {
		for (const r of rows) {
			if (!r.name) continue;
			const cur = staffByName.get(r.name) ?? { name: r.name, roles: [], seconds: 0, sessions: 0, lastSeen: null, active: false };
			cur[key] = num(r.n);
			staffByName.set(r.name, cur);
		}
	}

	const report = {
		at: nowMs,
		activity: {
			days, heatmap: grid,
			totals: { sessions: num(totals[0]?.sessions), players: num(totals[0]?.players), hours: Math.round(num(totals[0]?.seconds) / 3600), avgMinutes: Math.round(num(totals[0]?.avgSeconds) / 60), peak: Math.max(0, ...peak.values()) },
			drops: drops.map(d => ({ reason: d.reason, count: num(d.n) })),
			online: onlineNow.map(o => ({ userId: o.user_id, username: o.username, since: ms(o.joined_at) })),
		},
		jobs,
		vehicles: {
			total: num(vehicleStates[0]?.total), out: num(vehicleStates[0]?.out_), garage: num(vehicleStates[0]?.garage), impound: num(vehicleStates[0]?.impound),
			damaged: num(vehicleStates[0]?.damaged), fakePlates: num(vehicleStates[0]?.fakePlates), customGarages: num(customGarages[0]?.n),
			models: topModels.map(m => ({ model: m.model, count: num(m.n) })),
			garages: byGarage.map(g => ({ garage: g.garage, count: num(g.n) })),
		},
		justice: {
			jailed: jailed.map(j => ({ citizenId: j.identifier, name: fullName(j.charinfo, j.identifier), months: num(j.jailtime) })),
			sanctions30: Object.fromEntries(sanctionTypes.map(s => [s.type, num(s.n)])),
			sanctions: sanctionsRecent.map(s => ({ id: s.id, userId: s.target_dbid, target: s.target_name, type: s.type, reason: s.reason, durationMinutes: s.duration_minutes, by: s.issued_by_name, at: ms(s.created_at) })),
			bans: bans.map(b => ({ id: b.id, name: b.name, reason: b.reason, expire: b.expire ? b.expire * 1000 : null, by: b.bannedby })),
			reports: reports.map(r => ({ id: r.id, sender: r.sender_name, message: r.message, status: r.status, priority: r.priority, category: r.category, claimedBy: r.claimed_by_name, resolvedBy: r.resolved_by_name, at: ms(r.created_at), resolvedAt: ms(r.resolved_at) })),
			calls: calls.map(c => ({ id: c.id, code: c.code, title: c.title, place: c.place, priority: c.priority, state: c.state, caller: c.caller_name, closedBy: c.closed_by, at: ms(c.created), closedAt: ms(c.closed) })),
		},
		world: {
			counts: Object.fromEntries(counts),
			safezones: safezones.map(z => ({ name: z.name, active: Boolean(z.is_active), visits: num(find(safezoneVisits, 'zone_name', z.name)?.visits), seconds: num(find(safezoneVisits, 'zone_name', z.name)?.seconds) })),
			harvest: harvestZones.map(z => ({ id: z.id, label: z.label, item: z.item, amount: num(z.amount), enabled: Boolean(z.enabled), stock: z.stock_enabled ? { current: num(z.current_stock), max: num(z.max_stock) } : null, access: z.access && z.access !== 'all' ? `${z.access}${z.access_value ? ` : ${label(z.access_value)}` : ''}` : null })),
			harvesters: harvestTop.map(h => ({ name: h.player_name, total: num(h.total_harvested) })),
		},
		staff: {
			roles: staffRoles.map(r => ({ id: r.id, name: r.name, label: r.label, protected: Boolean(r.protected), actions: num(r.actions) })),
			members: [...staffByName.values()].map(s => ({ actions: 0, sanctions: 0, reports: 0, ...s })).sort((a, b) => b.seconds - a.seconds || b.actions - a.actions),
			messages: staffMessages.map(m => ({ by: m.issued_by_name, line: m.line, target: m.target_label, at: ms(m.created_at) })),
		},
		economy: canMoney ? await economy({ query, when }) : null,
	};
	return report;
}

async function economy({ query, when }) {
	const [[money = {}], fortunes, accounts, flows, premium, crates, topItems, gifts, promos, crypto, phoneTx] = await Promise.all([
		query(`SELECT SUM(${jnum('money', 'cash')}) AS cash, SUM(${jnum('money', 'bank')}) AS bank, SUM(${jnum('money', 'crypto')}) AS crypto FROM fivem.players`),
		query(`SELECT citizenid, charinfo, ${jnum('money', 'cash')} AS cash, ${jnum('money', 'bank')} AS bank FROM fivem.players
			ORDER BY COALESCE(${jnum('money', 'cash')}, 0) + COALESCE(${jnum('money', 'bank')}, 0) DESC LIMIT 10`),
		when('bank_accounts_new', () => query('SELECT id, amount, creator, isfrozen, is_savings FROM fivem.bank_accounts_new ORDER BY amount DESC NULLS LAST')),
		when('bank_flows', () => query('SELECT kind, COUNT(*) AS n, SUM(amount) AS total FROM fivem.bank_flows WHERE created_at > NOW() - INTERVAL \'30 days\' GROUP BY kind ORDER BY total DESC NULLS LAST')),
		Promise.all([
			when('premium_points', () => query('SELECT SUM(balance) AS n FROM fivem.premium_points'), [{}]),
			when('premium_loyalty', () => query('SELECT SUM(balance) AS n FROM fivem.premium_loyalty'), [{}]),
			when('premium_shop_item_purchases', () => query('SELECT COUNT(*) AS n FROM fivem.premium_shop_item_purchases WHERE created_at > NOW() - INTERVAL \'30 days\''), [{}]),
			when('premium_bundle_purchases', () => query('SELECT COUNT(*) AS n FROM fivem.premium_bundle_purchases WHERE created_at > NOW() - INTERVAL \'30 days\''), [{}]),
		]),
		when('premium_crate_openings', () => query('SELECT rarity, COUNT(*) AS n FROM fivem.premium_crate_openings GROUP BY rarity ORDER BY n DESC')),
		when('premium_shop_item_purchases', () => query('SELECT i.label, COUNT(*) AS n, MAX(i.price) AS price FROM fivem.premium_shop_item_purchases p LEFT JOIN fivem.premium_shop_items i ON i.id = p.item_id GROUP BY p.item_id, i.label ORDER BY n DESC LIMIT 10')),
		when('premium_gifts', () => query('SELECT COUNT(*) AS n, SUM(CASE WHEN status = \'opened\' THEN 1 ELSE 0 END) AS opened FROM fivem.premium_gifts'), [{}]),
		when('premium_promo_redemptions', () => query('SELECT COUNT(*) AS n FROM fivem.premium_promo_redemptions'), [{ n: 0 }]),
		when('sky_phone_crypto_markets', () => query('SELECT id, price, price_scale, issued_supply, status FROM fivem.sky_phone_crypto_markets ORDER BY id')),
		when('sky_phone_bank_transactions', () => query('SELECT kind, COUNT(*) AS n, SUM(amount) AS total FROM fivem.sky_phone_bank_transactions GROUP BY kind')),
	]);
	const one = rows => num(rows[0]?.n);
	return {
		cash: num(money.cash), bank: num(money.bank), crypto: num(money.crypto),
		fortunes: fortunes.map(f => ({ citizenId: f.citizenid, name: fullName(f.charinfo, f.citizenid), cash: num(f.cash), bank: num(f.bank) })),
		accounts: { total: accounts.reduce((n, a) => n + num(a.amount), 0), list: accounts.slice(0, 25).map(a => ({ id: a.id, amount: num(a.amount), creator: a.creator, frozen: Boolean(a.isfrozen), savings: Boolean(a.is_savings) })) },
		flows: flows.map(f => ({ kind: f.kind, count: num(f.n), total: num(f.total) })),
		phone: phoneTx.map(t => ({ kind: t.kind, count: num(t.n), total: num(t.total) })),
		premium: {
			points: one(premium[0]), loyalty: one(premium[1]), purchases30: one(premium[2]) + one(premium[3]),
			crates: crates.map(c => ({ rarity: c.rarity, count: num(c.n) })),
			topItems: topItems.map(i => ({ label: i.label ?? '?', count: num(i.n), price: num(i.price) })),
			gifts: { sent: num(gifts[0]?.n), opened: num(gifts[0]?.opened) }, promos: one(promos),
		},
		cryptoMarkets: crypto.map(c => ({ id: c.id, price: num(c.price) / (num(c.price_scale) || 1), supply: num(c.issued_supply), status: c.status })),
	};
}
