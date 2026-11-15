import { num, int, text, arrayOf, clampInt } from './util.js';

// bl_telemetry 1.6: the periodic readings of the game (companies, gangs, money by reason, server health) and
// the views built on them and on the new events (duty, business_open, money_move, item_move).
// Readings are photos: the last one is kept for the live display, their history for the curves.

const TYPES = new Set(['business_snapshot', 'gang_snapshot', 'money_flow', 'health_snapshot']);
// A reading older than this is no longer "now" (the game sends one every 5 minutes)
export const LIVE_MS = 15 * 60_000;

const bool = v => (v === true || v === false ? v : null);
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const jobOf = v => {
	const job = text(v, 60);
	return job && /^[\w .:'-]+$/.test(job) ? job : null;
};

export function createSnapshots({ q, now }) {
	const at = 'to_timestamp($1/1000.0)';

	async function business(ts, d) {
		const rows = arrayOf(d.rows, 500).map(obj).filter(r => text(r.job, 60));
		const col = fn => rows.map(fn);
		if (rows.length) {
			// A reading replayed late never replaces a newer one
			await q(`INSERT INTO tel_business_latest (job, ts, label, type, open, online, on_duty, employees, balance, level, xp, week_duty_s)
				SELECT u.job, ${at}, u.label, u.type, u.open, COALESCE(u.online, 0), COALESCE(u.on_duty, 0), COALESCE(u.employees, 0), u.balance, u.level, u.xp, u.week_duty_s
				FROM unnest($2::text[], $3::text[], $4::text[], $5::boolean[], $6::int[], $7::int[], $8::int[], $9::bigint[], $10::int[], $11::bigint[], $12::bigint[])
					AS u(job, label, type, open, online, on_duty, employees, balance, level, xp, week_duty_s)
				ON CONFLICT (job) DO UPDATE SET ts = EXCLUDED.ts, label = EXCLUDED.label, type = EXCLUDED.type, open = EXCLUDED.open, online = EXCLUDED.online,
					on_duty = EXCLUDED.on_duty, employees = EXCLUDED.employees, balance = EXCLUDED.balance, level = EXCLUDED.level, xp = EXCLUDED.xp, week_duty_s = EXCLUDED.week_duty_s
				WHERE tel_business_latest.ts <= EXCLUDED.ts`,
			[ts, col(r => text(r.job, 60)), col(r => text(r.label, 120)), col(r => text(r.type, 40)), col(r => bool(r.open)), col(r => int(r.online)), col(r => int(r.on_duty)),
				col(r => int(r.employees)), col(r => num(r.balance)), col(r => int(r.level)), col(r => num(r.xp)), col(r => num(r.week_duty_s))]);
			await q(`INSERT INTO tel_business_history (ts, job, open, online, on_duty, employees, balance)
				SELECT ${at}, * FROM unnest($2::text[], $3::boolean[], $4::int[], $5::int[], $6::int[], $7::bigint[])`,
			[ts, col(r => text(r.job, 60)), col(r => bool(r.open)), col(r => int(r.online)), col(r => int(r.on_duty)), col(r => int(r.employees)), col(r => num(r.balance))]);
		}
		// Companies that left the reading (no employee, nobody connected any more) leave the live list
		await q(`DELETE FROM tel_business_latest WHERE ts < ${at}`, [ts]);
		const t = obj(d.totals);
		await q(`INSERT INTO tel_business_totals (ts, jobs, open, on_duty, online, safes, duty_by_type) VALUES (${at}, $2, $3, $4, $5, $6, $7)`,
			[ts, int(t.jobs), int(t.open), int(t.on_duty), int(t.online), num(t.safes), JSON.stringify(obj(t.duty_by_type))]);
	}

	async function gangs(ts, d) {
		const rows = arrayOf(d.rows, 500).map(obj).filter(r => text(r.gang, 60));
		const col = fn => rows.map(fn);
		if (rows.length) {
			await q(`INSERT INTO tel_gang_latest (gang, ts, label, online, members, xp, category, max_members, territories)
				SELECT u.gang, ${at}, u.label, COALESCE(u.online, 0), COALESCE(u.members, 0), u.xp, u.category, u.max_members, u.territories
				FROM unnest($2::text[], $3::text[], $4::int[], $5::int[], $6::bigint[], $7::text[], $8::int[], $9::int[]) AS u(gang, label, online, members, xp, category, max_members, territories)
				ON CONFLICT (gang) DO UPDATE SET ts = EXCLUDED.ts, label = EXCLUDED.label, online = EXCLUDED.online, members = EXCLUDED.members, xp = EXCLUDED.xp,
					category = EXCLUDED.category, max_members = EXCLUDED.max_members, territories = EXCLUDED.territories
				WHERE tel_gang_latest.ts <= EXCLUDED.ts`,
			[ts, col(r => text(r.gang, 60)), col(r => text(r.label, 120)), col(r => int(r.online)), col(r => int(r.members)), col(r => num(r.xp)), col(r => text(r.category, 60)),
				col(r => int(r.max_members)), col(r => int(r.territories))]);
		}
		await q(`DELETE FROM tel_gang_latest WHERE ts < ${at}`, [ts]);
	}

	async function moneyFlow(ts, d) {
		const rows = arrayOf(d.flows, 400).map(obj).filter(r => text(r.type, 30) && text(r.action, 20));
		if (!rows.length) return;
		const col = fn => rows.map(fn);
		await q(`INSERT INTO tel_money_flows (ts, window_s, money_type, action, reason, total, n, max)
			SELECT ${at}, $2, u.money_type, u.action, u.reason, COALESCE(u.total, 0), COALESCE(u.n, 0), u.max
			FROM unnest($3::text[], $4::text[], $5::text[], $6::bigint[], $7::int[], $8::bigint[]) AS u(money_type, action, reason, total, n, max)`,
		[ts, int(d.window_s), col(r => text(r.type, 30)), col(r => text(r.action, 20)), col(r => text(r.reason, 60) ?? 'inconnu'), col(r => num(r.total)), col(r => int(r.n)), col(r => num(r.max))]);
	}

	async function health(ts, d) {
		const hitches = obj(d.hitches);
		const list = (v, fn) => arrayOf(v, 25).map(obj).map(fn);
		const counts = v => Object.fromEntries(Object.entries(obj(v)).slice(0, 20).map(([k, n]) => [String(k).slice(0, 30), int(n) ?? 0]));
		const data = {
			server_uptime_s: num(d.server_uptime_s), telemetry_uptime_s: num(d.telemetry_uptime_s),
			resources: counts(d.resources), hitch_total_ms: int(hitches.total_ms),
			slow_queries: list(d.slow_queries, r => ({ resource: text(r.resource, 80), n: int(r.n), max_ms: int(r.max_ms), avg_ms: int(r.avg_ms) })),
			errors: list(d.errors, r => ({ resource: text(r.resource, 80), n: int(r.n), sample: text(r.sample, 400) })),
			drops: counts(d.drops), connects: counts(d.connects), item_moves_suppressed: int(d.item_moves_suppressed),
		};
		await q(`INSERT INTO tel_health (ts, window_s, players, max_players, staff_on_duty, ping_avg, ping_max, hitches, hitch_max_ms, queue, data)
			VALUES (${at}, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
		[ts, int(d.window_s), int(d.players), int(d.max_players), int(d.staff_on_duty), int(d.ping_avg), int(d.ping_max), int(hitches.n), int(hitches.max_ms), int(d.queue), JSON.stringify(data)]);
	}

	// Columns of game tables copied by the mirror (schema "fivem"), by table: what a query may name.
	// The sales journal of the shops has no documented columns: they are looked up, never guessed.
	async function mirrored(names) {
		const r = await q('SELECT name, columns FROM fivem_mirror_tables WHERE name = ANY($1) AND mode <> \'count\'', [names]);
		return new Map(r.rows.map(t => [t.name, Array.isArray(t.columns) ? t.columns : []]));
	}
	const NUMERIC = new Set(['bigint', 'numeric', 'integer', 'double precision']);
	const column = (columns, candidates, types) => candidates.find(name => columns.some(c => c.name === name && (!types || types.has(c.type))));

	// Money of one company from the game's own tables: payroll runs, sales per day
	async function businessMoney(job, d) {
		const tables = await mirrored(['job_payroll_runs', 'store_sales']);
		const out = { payroll: [], sales: [] };
		if (tables.has('job_payroll_runs')) {
			out.payroll = (await q(`SELECT created_at AS ts, total_amount AS total, employee_count AS employees, run_by_name AS by FROM fivem.job_payroll_runs
				WHERE job_name = $1 AND created_at > now() - make_interval(days => $2) ORDER BY created_at DESC LIMIT 50`, [job, d])).rows;
		}
		const sales = tables.get('store_sales');
		if (sales) {
			const jobCol = column(sales, ['job_name', 'job']);
			const dateCol = column(sales, ['created_at', 'sold_at', 'at'], new Set(['timestamptz']));
			const amountCol = column(sales, ['total', 'amount', 'total_price', 'price'], NUMERIC);
			if (jobCol && dateCol && amountCol) {
				out.sales = (await q(`SELECT to_char("${dateCol}" AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS day, COUNT(*)::int AS n, COALESCE(SUM("${amountCol}"), 0)::bigint AS total
					FROM fivem.store_sales WHERE "${jobCol}" = $1 AND "${dateCol}" > now() - make_interval(days => $2) GROUP BY 1 ORDER BY 1`, [job, d])).rows;
			}
		}
		return out;
	}

	const period = hours => clampInt(hours, 24, 1, 24 * 90);
	const bucket = hours => Math.max(300, Math.round(hours * 3600 / 300));
	const fresh = ts => (ts ? now() - new Date(ts).getTime() < LIVE_MS : false);

	const views = {
		// Every company as of the last reading; `current` false when the game stopped sending (figures are then the last known)
		async businesses() {
			const [rows, totals] = await Promise.all([
				q('SELECT job, ts, label, type, open, online, on_duty, employees, balance, level, xp, week_duty_s FROM tel_business_latest ORDER BY on_duty DESC, online DESC, employees DESC, job'),
				q('SELECT ts, jobs, open, on_duty, online, safes, duty_by_type FROM tel_business_totals ORDER BY ts DESC LIMIT 1'),
			]);
			const ts = rows.rows[0]?.ts ?? totals.rows[0]?.ts ?? null;
			return { ts, current: fresh(ts), totals: totals.rows[0] ?? null, rows: rows.rows };
		},

		// One company: its curves, opening hours, time on duty per employee
		// money: payroll runs and sales per day are added (economy permission, checked by the caller)
		async business({ job: name, days, money = false } = {}) {
			const job = jobOf(name);
			const d = clampInt(days, 7, 1, 90);
			if (!job) return { job: null, latest: null, history: [], openings: [], duty: [], payroll: null, sales: null };
			const b = bucket(d * 24);
			const [latest, history, openings, duty, cash] = await Promise.all([
				q('SELECT job, ts, label, type, open, online, on_duty, employees, balance, level, xp, week_duty_s FROM tel_business_latest WHERE job = $1', [job]),
				q(`SELECT floor(extract(epoch FROM ts) / ${b}) * ${b} * 1000 AS t, MAX(online) AS online, MAX(on_duty) AS on_duty, MAX(employees) AS employees,
						(array_agg(balance ORDER BY ts DESC))[1] AS balance, bool_or(open) AS open
					FROM tel_business_history WHERE job = $1 AND ts > now() - make_interval(days => $2) GROUP BY 1 ORDER BY 1`, [job, d]),
				q(`SELECT ts, (data->>'open')::boolean AS open, (data->>'on_duty')::int AS on_duty FROM tel_events
					WHERE subtype = 'business_open' AND data->>'job' = $1 AND ts > now() - make_interval(days => $2) ORDER BY ts DESC LIMIT 300`, [job, d]),
				// A shift is counted when it ends (duration_s comes with the end of duty)
				q(`SELECT citizenid, MAX(player_name) AS name, COUNT(*)::int AS shifts, SUM((data->>'duration_s')::numeric)::bigint AS seconds, MAX(ts) AS last,
						COUNT(*) FILTER (WHERE data->>'dropped' = 'true')::int AS dropped
					FROM tel_events WHERE subtype = 'duty' AND data->>'job' = $1 AND data->>'on' = 'false' AND (data->>'duration_s') ~ '^[0-9]+([.][0-9]+)?$'
						AND ts > now() - make_interval(days => $2) AND citizenid IS NOT NULL
					GROUP BY citizenid ORDER BY seconds DESC LIMIT 200`, [job, d]),
				money ? businessMoney(job, d) : { payroll: null, sales: null },
			]);
			return { job, days: d, latest: latest.rows[0] ?? null, current: fresh(latest.rows[0]?.ts), history: history.rows, openings: openings.rows, duty: duty.rows, payroll: cash.payroll, sales: cash.sales };
		},

		async gangs() {
			const rows = await q('SELECT gang, ts, label, online, members, xp, category, max_members, territories FROM tel_gang_latest ORDER BY online DESC, members DESC, gang');
			const ts = rows.rows[0]?.ts ?? null;
			return { ts, current: fresh(ts), rows: rows.rows };
		},

		// Where money comes from and where it goes: by reason over the period, and the net creation over time.
		// A transfer between two players shows twice (one out, one in): it is not created money.
		async flows({ hours } = {}) {
			const h = period(hours);
			const b = bucket(h);
			const [reasons, curve] = await Promise.all([
				q(`SELECT money_type, action, reason, SUM(total)::bigint AS total, SUM(n)::int AS n, MAX(max) AS max FROM tel_money_flows
					WHERE ts > now() - make_interval(hours => $1) GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 300`, [h]),
				q(`SELECT floor(extract(epoch FROM ts) / ${b}) * ${b} * 1000 AS t,
						COALESCE(SUM(total) FILTER (WHERE action = 'add'), 0)::bigint AS "in", COALESCE(SUM(total) FILTER (WHERE action = 'remove'), 0)::bigint AS "out"
					FROM tel_money_flows WHERE ts > now() - make_interval(hours => $1) GROUP BY 1 ORDER BY 1`, [h]),
			]);
			const sum = action => reasons.rows.filter(r => r.action === action).reduce((n, r) => n + Number(r.total), 0);
			return { hours: h, in: sum('add'), out: sum('remove'), reasons: reasons.rows, curve: curve.rows };
		},

		// Big movements to check (duplication, suspicious transfers): money above the game's threshold, weapons and stacks of items
		async moves({ hours, kind } = {}) {
			const h = period(hours);
			const subtypes = kind === 'money' ? ['money_move'] : kind === 'item' ? ['item_move'] : ['money_move', 'item_move'];
			const r = await q(`SELECT ts, subtype, citizenid, player_name, data FROM tel_events
				WHERE subtype = ANY($1) AND ts > now() - make_interval(hours => $2) ORDER BY ts DESC LIMIT 500`, [subtypes, h]);
			return { hours: h, rows: r.rows };
		},

		async health({ hours } = {}) {
			const h = period(hours);
			const b = bucket(h);
			const [latest, curve, windows] = await Promise.all([
				q('SELECT ts, window_s, players, max_players, staff_on_duty, ping_avg, ping_max, hitches, hitch_max_ms, queue, data FROM tel_health ORDER BY ts DESC LIMIT 1'),
				q(`SELECT floor(extract(epoch FROM ts) / ${b}) * ${b} * 1000 AS t, MAX(players) AS players, ROUND(AVG(ping_avg))::int AS ping_avg, MAX(ping_max) AS ping_max,
						SUM(hitches)::int AS hitches, MAX(hitch_max_ms) AS hitch_max_ms, MAX(queue) AS queue
					FROM tel_health WHERE ts > now() - make_interval(hours => $1) GROUP BY 1 ORDER BY 1`, [h]),
				q('SELECT data FROM tel_health WHERE ts > now() - make_interval(hours => $1) ORDER BY ts DESC LIMIT 2000', [h]),
			]);
			// Per resource over the period: errors and slow queries; drops and connections summed
			const errors = new Map();
			const slow = new Map();
			const drops = {};
			const connects = {};
			for (const { data } of windows.rows) {
				for (const e of data?.errors ?? []) {
					const cur = errors.get(e.resource) ?? { resource: e.resource, n: 0, sample: e.sample };
					cur.n += e.n ?? 0;
					errors.set(e.resource, cur);
				}
				for (const s of data?.slow_queries ?? []) {
					const cur = slow.get(s.resource) ?? { resource: s.resource, n: 0, max_ms: 0 };
					cur.n += s.n ?? 0;
					cur.max_ms = Math.max(cur.max_ms, s.max_ms ?? 0);
					slow.set(s.resource, cur);
				}
				for (const [k, n] of Object.entries(data?.drops ?? {})) drops[k] = (drops[k] ?? 0) + n;
				for (const [k, n] of Object.entries(data?.connects ?? {})) connects[k] = (connects[k] ?? 0) + n;
			}
			const top = map => [...map.values()].sort((a, b2) => b2.n - a.n).slice(0, 25);
			return { hours: h, latest: latest.rows[0] ?? null, current: fresh(latest.rows[0]?.ts), curve: curve.rows, errors: top(errors), slowQueries: top(slow), drops, connects };
		},
	};

	return {
		// true when the event was one of the readings (it is then not copied into tel_events)
		async ingest(type, ts, data) {
			if (!TYPES.has(type)) return false;
			const d = obj(data);
			if (type === 'business_snapshot') await business(ts, d);
			else if (type === 'gang_snapshot') await gangs(ts, d);
			else if (type === 'money_flow') await moneyFlow(ts, d);
			else await health(ts, d);
			// Even an empty reading (no money moved in the window) is a sign that the game sends it
			await q(`INSERT INTO tel_reading_receipts (type, last_at) VALUES ($2, ${at}) ON CONFLICT (type) DO UPDATE
				SET last_at = GREATEST(tel_reading_receipts.last_at, EXCLUDED.last_at), count = tel_reading_receipts.count + 1`, [ts, type]);
			return true;
		},
		views,
	};
}
