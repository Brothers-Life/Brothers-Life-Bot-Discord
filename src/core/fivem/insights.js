import { dayOf } from '../stats.js';

const H = 3_600_000;
const DAY = 86_400_000;
const SLOT = 10 * 60_000;
const ms = value => (value ? new Date(value).getTime() : null);
const num = value => Number(value ?? 0);
const round = (n, digits = 1) => Math.round(n * 10 ** digits) / 10 ** digits;
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
const hourOf = at => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' }).format(at));

export function median(values) {
	if (!values.length) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// 0 = everybody has the same, 1 = one person has everything
export function gini(values) {
	const list = values.filter(v => v >= 0).sort((a, b) => a - b);
	const total = list.reduce((a, b) => a + b, 0);
	if (list.length < 2 || !total) return 0;
	const weighted = list.reduce((sum, v, i) => sum + (i + 1) * v, 0);
	return (2 * weighted) / (list.length * total) - (list.length + 1) / list.length;
}

export function pearson(xs, ys) {
	const n = xs.length;
	if (n < 3) return null;
	const mx = xs.reduce((a, b) => a + b, 0) / n;
	const my = ys.reduce((a, b) => a + b, 0) / n;
	let cov = 0;
	let vx = 0;
	let vy = 0;
	for (let i = 0; i < n; i++) {
		cov += (xs[i] - mx) * (ys[i] - my);
		vx += (xs[i] - mx) ** 2;
		vy += (ys[i] - my) ** 2;
	}
	return vx && vy ? cov / Math.sqrt(vx * vy) : null;
}

// How many intervals cover each 10-minute slot between `from` and `to`
export function coverage(intervals, from, to) {
	const slots = new Array(Math.ceil((to - from) / SLOT)).fill(0);
	for (const [start, end] of intervals) {
		const a = Math.max(0, Math.floor((start - from) / SLOT));
		const b = Math.min(slots.length - 1, Math.floor((Math.min(end, to) - from) / SLOT));
		for (let i = a; i <= b; i++) slots[i]++;
	}
	return slots;
}

// Weekly cohorts: of the players who came for the first time in a week, how many came back the following weeks
export function cohorts(sessions, nowMs, weeks = 8) {
	const monday = (at) => {
		const d = new Date(at);
		const day = (d.getUTCDay() + 6) % 7;
		return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
	};
	const first = new Map();
	const weeksOf = new Map();
	for (const s of sessions) {
		const at = ms(s.joined_at);
		if (!at) continue;
		if (!first.has(s.user_id) || at < first.get(s.user_id)) first.set(s.user_id, at);
		if (!weeksOf.has(s.user_id)) weeksOf.set(s.user_id, new Set());
		weeksOf.get(s.user_id).add(monday(at));
	}
	const thisWeek = monday(nowMs);
	const rows = [];
	for (let w = weeks - 1; w >= 0; w--) {
		const start = thisWeek - w * 7 * DAY;
		const members = [...first].filter(([, at]) => monday(at) === start).map(([id]) => id);
		const back = [];
		for (let k = 1; k <= 4 && start + k * 7 * DAY <= thisWeek; k++) {
			const target = start + k * 7 * DAY;
			back.push(members.length ? Math.round((members.filter(id => weeksOf.get(id).has(target)).length / members.length) * 100) : null);
		}
		rows.push({ week: new Date(start).toISOString().slice(0, 10), players: members.length, back });
	}
	return rows;
}

// Everything crossed: game sessions, staff service, money, jobs, justice, phone, and Discord activity of the same people
export async function insightsReport({ query, when, groupsMap, canMoney, discordActivity, discordMembers, now = Date.now }) {
	const nowMs = now();
	const from30 = nowMs - 30 * DAY;
	const groups = await groupsMap();
	const label = name => groups.get(name)?.label ?? name;

	const [sessions, users, chars, staffSessions, reports, sanctions, vehicles, calls, health, weekStats, checkins, ticks, markets, balances] = await Promise.all([
		when('bl_mc_sessions', () => query('SELECT user_id, joined_at, left_at FROM bl_mc_sessions WHERE joined_at > NOW() - INTERVAL 120 DAY ORDER BY joined_at LIMIT 100000')),
		query('SELECT userid, username, discord FROM users'),
		query('SELECT userId, citizenid, charinfo, job, gang, money FROM players'),
		when('admindash_staff_sessions', () => query('SELECT staff_name, started_at, COALESCE(ended_at, last_seen_at) AS ended FROM admindash_staff_sessions WHERE started_at > NOW() - INTERVAL 30 DAY')),
		when('admindash_reports', () => query('SELECT created_at, claimed_at, resolved_at, claimed_by_name, resolved_by_name, category FROM admindash_reports WHERE created_at > NOW() - INTERVAL 90 DAY')),
		when('admindash_sanctions', () => query('SELECT target_dbid, target_name, type, issued_by_name, created_at FROM admindash_sanctions')),
		when('player_vehicles', () => query('SELECT citizenid, vehicle, fuel, engine, body, state, owner_job FROM player_vehicles')),
		when('sky_phone_calls', () => query('SELECT status, started_at, answered_at, duration_seconds FROM sky_phone_calls WHERE started_at > NOW() - INTERVAL 60 DAY')),
		when('sky_phone_health_daily', () => query('SELECT activity_date, SUM(steps) AS steps, SUM(distance_meters) AS meters, COUNT(DISTINCT owner_identifier) AS people FROM sky_phone_health_daily WHERE activity_date > NOW() - INTERVAL 30 DAY GROUP BY activity_date ORDER BY activity_date')),
		when('job_week_stats', () => query('SELECT job_name, week_start, stats, xp_gained, level_after FROM job_week_stats ORDER BY week_start DESC LIMIT 60')),
		when('player_jobs_activity', () => query('SELECT job, last_checkin FROM player_jobs_activity WHERE last_checkin IS NOT NULL')),
		canMoney ? when('sky_phone_crypto_market_ticks', () => query(`SELECT market_id, DATE_FORMAT(created_at, '%Y-%m-%d %H:00') AS d, AVG(price) AS price FROM sky_phone_crypto_market_ticks
			WHERE created_at > (SELECT MAX(created_at) FROM sky_phone_crypto_market_ticks) - INTERVAL 30 DAY GROUP BY market_id, d ORDER BY d`)) : [],
		canMoney ? when('sky_phone_crypto_markets', () => query('SELECT id, price, price_scale FROM sky_phone_crypto_markets')) : [],
		canMoney ? when('sky_phone_crypto_balances', () => query('SELECT asset_id, COUNT(DISTINCT account_id) AS holders FROM sky_phone_crypto_balances WHERE available + locked > 0 GROUP BY asset_id')) : [],
	]);

	const intervals = sessions.map(s => [ms(s.joined_at), ms(s.left_at) ?? nowMs, s.user_id]).filter(([a, b]) => a && b >= a);
	const recent = intervals.filter(([, b]) => b >= from30);

	// --- Attendance: DAU/WAU/MAU, concurrency per hour, session lengths, retention, churn
	const activeSince = since => new Set(intervals.filter(([, b]) => b >= nowMs - since).map(([, , u]) => u)).size;
	const playerSlots = coverage(recent, from30, nowMs);
	const byHour = Array.from({ length: 24 }, () => ({ total: 0, max: 0, slots: 0 }));
	playerSlots.forEach((count, i) => {
		const h = byHour[hourOf(from30 + i * SLOT)];
		h.total += count;
		h.max = Math.max(h.max, count);
		h.slots++;
	});
	const lengths = recent.map(([a, b]) => (b - a) / 60_000);
	const BUCKETS = [[0, 15, '< 15 min'], [15, 30, '15-30 min'], [30, 60, '30 min-1 h'], [60, 120, '1-2 h'], [120, 240, '2-4 h'], [240, Infinity, '4 h et +']];
	const lastSeen = new Map();
	for (const [, b, u] of intervals) lastSeen.set(u, Math.max(lastSeen.get(u) ?? 0, b));
	const churn = { active7: 0, away7: 0, away14: 0, away30: 0 };
	for (const at of lastSeen.values()) {
		const away = nowMs - at;
		if (away < 7 * DAY) churn.active7++;
		else if (away < 14 * DAY) churn.away7++;
		else if (away < 30 * DAY) churn.away14++;
		else churn.away30++;
	}

	// Game hours per account and per day (for the Discord crossing)
	const gameByUser = new Map();
	const gameByDay = new Map();
	for (const [a, b, u] of recent) {
		const hours = (Math.min(b, nowMs) - Math.max(a, from30)) / H;
		gameByUser.set(u, (gameByUser.get(u) ?? 0) + hours);
		const day = dayOf(a);
		if (!gameByDay.has(day)) gameByDay.set(day, new Set());
		gameByDay.get(day).add(u);
	}

	// --- Staff: presence when players are online, response times
	const staffSlots = coverage(staffSessions.map(s => [ms(s.started_at), ms(s.ended)]).filter(([a, b]) => a && b >= a), from30, nowMs);
	const staffByHour = Array.from({ length: 24 }, () => ({ withPlayers: 0, uncovered: 0, staff: 0 }));
	playerSlots.forEach((players, i) => {
		if (!players) return;
		const h = staffByHour[hourOf(from30 + i * SLOT)];
		h.withPlayers++;
		h.staff += staffSlots[i];
		if (!staffSlots[i]) h.uncovered++;
	});
	const occupied = playerSlots.filter(Boolean).length;
	const uncovered = playerSlots.filter((p, i) => p && !staffSlots[i]).length;
	const claimMinutes = reports.filter(r => r.claimed_at).map(r => (ms(r.claimed_at) - ms(r.created_at)) / 60_000).filter(m => m >= 0);
	const resolveMinutes = reports.filter(r => r.resolved_at).map(r => (ms(r.resolved_at) - ms(r.created_at)) / 60_000).filter(m => m >= 0);
	const staffHours = new Map();
	for (const s of staffSessions) staffHours.set(s.staff_name, (staffHours.get(s.staff_name) ?? 0) + Math.max(0, (ms(s.ended) - ms(s.started_at)) / H));

	// --- Characters: money, jobs
	const characters = chars.map((c) => {
		const job = json(c.job, {});
		const gang = json(c.gang, {});
		const money = json(c.money, {});
		return { userId: c.userId, citizenId: c.citizenid, name: fullName(c.charinfo, c.citizenid), job: job.name ?? null, gang: gang.name && gang.name !== 'none' ? gang.name : null, wealth: num(money.cash) + num(money.bank) };
	});
	const playHoursByUser = new Map();
	for (const [a, b, u] of intervals) playHoursByUser.set(u, (playHoursByUser.get(u) ?? 0) + (b - a) / H);

	// --- Justice: repeat offenders, sanctions for 100 h played, by weekday and hour
	const offenders = new Map();
	for (const s of sanctions) {
		if (!['warn', 'kick', 'ban', 'jail'].includes(s.type)) continue;
		const key = s.target_dbid ?? s.target_name;
		const cur = offenders.get(key) ?? { userId: s.target_dbid, name: s.target_name, count: 0, types: {} };
		cur.count++;
		cur.types[s.type] = (cur.types[s.type] ?? 0) + 1;
		offenders.set(key, cur);
	}
	const sanctionGrid = Array.from({ length: 7 }, () => Array(24).fill(0));
	for (const s of sanctions) {
		const at = ms(s.created_at);
		if (!at) continue;
		const d = (new Date(at).getDay() + 6) % 7;
		sanctionGrid[d][hourOf(at)]++;
	}
	const sanctions30 = sanctions.filter(s => ms(s.created_at) >= from30 && s.type !== 'unban' && s.type !== 'unjail').length;
	const hours30 = recent.reduce((n, [a, b]) => n + (Math.min(b, nowMs) - Math.max(a, from30)) / H, 0);

	// --- Jobs: hours of service for each member, check-ins by weekday, weekly stats of the job scripts
	const checkinGrid = Array.from({ length: 7 }, () => Array(24).fill(0));
	for (const c of checkins) {
		const at = num(c.last_checkin) * (num(c.last_checkin) > 1e11 ? 1 : 1000);
		if (!at) continue;
		checkinGrid[(new Date(at).getDay() + 6) % 7][hourOf(at)]++;
	}
	const weekly = weekStats.map(w => ({ job: label(w.job_name), week: num(w.week_start) ? new Date(num(w.week_start) * (num(w.week_start) > 1e11 ? 1 : 1000)).toISOString().slice(0, 10) : String(w.week_start), stats: json(w.stats, {}), xp: num(w.xp_gained), level: num(w.level_after) }));

	// --- Vehicles per player
	const vehiclesByCid = new Map();
	for (const v of vehicles) vehiclesByCid.set(v.citizenid, (vehiclesByCid.get(v.citizenid) ?? 0) + 1);
	const vehiclesPerAccount = new Map();
	for (const c of characters) vehiclesPerAccount.set(c.userId, (vehiclesPerAccount.get(c.userId) ?? 0) + (vehiclesByCid.get(c.citizenId) ?? 0));
	const fleet = [...vehiclesPerAccount.values()];

	// --- Discord crossing (linked accounts only)
	const linked = users.filter(u => u.discord).map(u => ({ userId: u.userid, username: u.username, discordId: u.discord.replace(/^discord:/, '') }));
	const sinceDay = dayOf(from30);
	const discordRows = discordActivity ? discordActivity(sinceDay) : [];
	const discordByUser = new Map();
	const discordByDay = new Map();
	for (const r of discordRows) {
		const cur = discordByUser.get(r.user_id) ?? { messages: 0, voice: 0 };
		cur.messages += num(r.messages);
		cur.voice += num(r.voice_seconds);
		discordByUser.set(r.user_id, cur);
		if (!discordByDay.has(r.day)) discordByDay.set(r.day, new Set());
		if (num(r.messages) || num(r.voice_seconds)) discordByDay.get(r.day).add(r.user_id);
	}
	const linkedDiscordIds = new Set(linked.map(l => l.discordId));
	const crossed = linked.map((l) => {
		const d = discordByUser.get(l.discordId) ?? { messages: 0, voice: 0 };
		const game = round(gameByUser.get(l.userId) ?? 0);
		const voice = round(d.voice / 3600);
		const kind = game >= 1 && (d.messages >= 20 || voice >= 1) ? 'both' : game >= 1 ? 'game' : d.messages >= 20 || voice >= 1 ? 'discord' : 'inactive';
		return { userId: l.userId, username: l.username, discordId: l.discordId, gameHours: game, messages: d.messages, voiceHours: voice, kind };
	});
	const members = discordMembers ? await discordMembers().catch(() => null) : null;
	const days = Array.from({ length: 30 }, (_, i) => dayOf(nowMs - (29 - i) * DAY)).map(day => ({
		day,
		game: gameByDay.get(day)?.size ?? 0,
		discord: discordByDay.get(day)?.size ?? 0,
		both: [...(gameByDay.get(day) ?? [])].filter(u => discordByDay.get(day)?.has(linked.find(l => l.userId === u)?.discordId)).length,
	}));

	const report = {
		at: nowMs,
		attendance: {
			dau: activeSince(DAY), wau: activeSince(7 * DAY), mau: activeSince(30 * DAY),
			stickiness: activeSince(30 * DAY) ? Math.round((activeSince(DAY) / activeSince(30 * DAY)) * 100) : 0,
			byHour: byHour.map((h, hour) => ({ hour, avg: h.slots ? round(h.total / h.slots) : 0, max: h.max })),
			sessionLengths: BUCKETS.map(([a, b, name]) => ({ label: name, count: lengths.filter(l => l >= a && l < b).length })),
			medianSession: Math.round(median(lengths) ?? 0),
			cohorts: cohorts(sessions, nowMs),
			churn,
			hoursPerPlayer: lastSeen.size ? round(hours30 / Math.max(1, activeSince(30 * DAY))) : 0,
		},
		staff: {
			coverage: occupied ? Math.round(((occupied - uncovered) / occupied) * 100) : null,
			uncoveredHours: round((uncovered * SLOT) / H),
			byHour: staffByHour.map((h, hour) => ({ hour, coverage: h.withPlayers ? Math.round(((h.withPlayers - h.uncovered) / h.withPlayers) * 100) : null, staff: h.withPlayers ? round(h.staff / h.withPlayers) : 0 })),
			reports: { count: reports.length, claimMedian: median(claimMinutes) === null ? null : Math.round(median(claimMinutes)), resolveMedian: median(resolveMinutes) === null ? null : Math.round(median(resolveMinutes)), unclaimed: reports.filter(r => !r.claimed_at && !r.resolved_at).length },
			ratio: activeSince(30 * DAY) ? round(staffHours.size / activeSince(30 * DAY), 2) : null,
		},
		justice: {
			per100h: hours30 ? round((sanctions30 / hours30) * 100, 2) : 0,
			repeat: [...offenders.values()].filter(o => o.count >= 2).sort((a, b) => b.count - a.count).slice(0, 15),
			grid: sanctionGrid,
		},
		jobs: {
			checkinGrid,
			weekly,
			jobless: characters.filter(c => !c.job || c.job === 'unemployed').length,
			multi: characters.filter(c => c.job && c.job !== 'unemployed' && c.gang).length,
		},
		vehicles: {
			perPlayer: fleet.length ? round(fleet.reduce((a, b) => a + b, 0) / fleet.length) : 0,
			distribution: [[0, 0, 'aucun'], [1, 1, '1'], [2, 3, '2-3'], [4, 6, '4-6'], [7, Infinity, '7 et +']].map(([a, b, name]) => ({ label: name, count: fleet.filter(n => n >= a && n <= b).length })),
			avgFuel: vehicles.length ? Math.round(vehicles.reduce((n, v) => n + num(v.fuel), 0) / vehicles.length) : 0,
			avgEngine: vehicles.length ? Math.round(vehicles.reduce((n, v) => n + num(v.engine ?? 1000), 0) / vehicles.length / 10) : 0,
			jobFleet: Object.entries(vehicles.reduce((acc, v) => (v.owner_job ? { ...acc, [v.owner_job]: (acc[v.owner_job] ?? 0) + 1 } : acc), {})).map(([job, count]) => ({ job: label(job), count })).sort((a, b) => b.count - a.count),
		},
		phone: {
			calls: calls.length,
			answered: calls.length ? Math.round((calls.filter(c => c.answered_at).length / calls.length) * 100) : null,
			avgSeconds: calls.filter(c => num(c.duration_seconds) > 0).length ? Math.round(median(calls.map(c => num(c.duration_seconds)).filter(Boolean))) : 0,
			health: health.map(h => ({ day: h.activity_date instanceof Date ? dayOf(h.activity_date.getTime()) : String(h.activity_date).slice(0, 10), steps: num(h.steps), km: round(num(h.meters) / 1000), people: num(h.people) })),
		},
		discord: {
			linked: linked.length, accounts: users.length,
			members: members ? members.size : null,
			membersLinked: members ? [...members].filter(id => linkedDiscordIds.has(id)).length : null,
			crossed: crossed.sort((a, b) => b.gameHours - a.gameHours),
			profiles: ['both', 'game', 'discord', 'inactive'].map(kind => ({ kind, count: crossed.filter(c => c.kind === kind).length })),
			correlation: {
				voice: pearson(crossed.map(c => c.gameHours), crossed.map(c => c.voiceHours)),
				messages: pearson(crossed.map(c => c.gameHours), crossed.map(c => c.messages)),
			},
			days,
		},
		economy: null,
	};

	if (canMoney) {
		const wealth = characters.map(c => c.wealth).sort((a, b) => a - b);
		const pct = p => (wealth.length ? wealth[Math.min(wealth.length - 1, Math.floor((p / 100) * wealth.length))] : 0);
		const byJob = new Map();
		for (const c of characters) {
			const key = c.job && c.job !== 'unemployed' ? c.job : 'sans emploi';
			const cur = byJob.get(key) ?? { job: key === 'sans emploi' ? key : label(key), count: 0, total: 0 };
			cur.count++;
			cur.total += c.wealth;
			byJob.set(key, cur);
		}
		const accountWealth = new Map();
		for (const c of characters) accountWealth.set(c.userId, (accountWealth.get(c.userId) ?? 0) + c.wealth);
		const scale = new Map(markets.map(m => [m.id, num(m.price_scale) || 1]));
		const price = new Map(markets.map(m => [m.id, num(m.price) / (num(m.price_scale) || 1)]));
		const top = [...price.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id]) => id);
		// Hourly points (the market moves fast and its history can be short)
		const cryptoDays = [...new Set(ticks.map(t => String(t.d)))].sort();
		report.economy = {
			gini: round(gini(wealth), 2),
			percentiles: { p10: pct(10), p50: pct(50), p90: pct(90), p99: pct(99) },
			top10Share: wealth.length ? Math.round((wealth.slice(-Math.max(1, Math.ceil(wealth.length / 10))).reduce((a, b) => a + b, 0) / Math.max(1, wealth.reduce((a, b) => a + b, 0))) * 100) : 0,
			distribution: [[0, 1000, '< 1 k'], [1000, 10_000, '1-10 k'], [10_000, 50_000, '10-50 k'], [50_000, 200_000, '50-200 k'], [200_000, 1_000_000, '200 k-1 M'], [1_000_000, Infinity, '1 M et +']].map(([a, b, name]) => ({ label: name, count: wealth.filter(w => w >= a && w < b).length })),
			byJob: [...byJob.values()].map(j => ({ ...j, avg: Math.round(j.total / j.count) })).sort((a, b) => b.avg - a.avg),
			perHour: [...accountWealth].map(([userId, w]) => ({ userId, username: users.find(u => u.userid === userId)?.username ?? String(userId), wealth: w, hours: round(playHoursByUser.get(userId) ?? 0), perHour: playHoursByUser.get(userId) >= 1 ? Math.round(w / playHoursByUser.get(userId)) : null }))
				.filter(p => p.perHour !== null).sort((a, b) => b.perHour - a.perHour).slice(0, 10),
			crypto: {
				assets: top,
				points: cryptoDays.map(at => Object.fromEntries([['at', at], ...top.map((id) => {
					const tick = ticks.find(t => t.market_id === id && String(t.d) === at);
					return [id, tick ? round(num(tick.price) / (scale.get(id) ?? 1), 2) : null];
				})])),
				holders: balances.map(b => ({ asset: b.asset_id, holders: num(b.holders) })).filter(b => b.holders).sort((a, b) => b.holders - a.holders),
			},
		};
	}
	return report;
}

