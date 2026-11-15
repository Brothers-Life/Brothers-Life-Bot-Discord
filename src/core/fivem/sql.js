// SQL helpers for the FiveM mirror (PostgreSQL schema "fivem", see mirror.js).
// Queries are written with `?` placeholders; an array value stays one parameter (use `= ANY(?)`).

// `?` outside strings and quoted names -> $1, $2…
export function toPg(sql) {
	let out = '';
	let n = 0;
	for (let i = 0; i < sql.length; i++) {
		const ch = sql[i];
		if (ch === '\'' || ch === '"') {
			let end = i + 1;
			while (end < sql.length) {
				if (sql[end] === ch) {
					if (sql[end + 1] === ch) {
						end += 2;
						continue;
					}
					break;
				}
				end++;
			}
			out += sql.slice(i, end + 1);
			i = end;
			continue;
		}
		out += ch === '?' ? `$${++n}` : ch;
	}
	return out;
}

// A query on the mirror: rows. Values: numbers, strings, Dates, arrays (one parameter each).
export function mirrorQuery(db) {
	return async (sql, params = []) => (await db.raw(toPg(sql), params)).rows;
}

// Unix seconds or milliseconds stored as an integer column -> timestamptz
export const unix = col => `(CASE WHEN ${col} > 100000000000 THEN to_timestamp(${col} / 1000.0) WHEN ${col} > 0 THEN to_timestamp(${col}) END)`;
// Seconds between two timestamps
export const seconds = (from, to) => `EXTRACT(EPOCH FROM (${to}) - (${from}))`;
// A field of a JSON text column of the game
export const jfield = (col, key) => `(fivem.j(${col}) ->> '${key}')`;

// Condition "this session of fivem.bl_mc_sessions is someone in game right now" (alias of the table, if any).
// A session without an end is not enough: a server that restarts or crashes leaves the sessions of that moment
// open for ever. They are told apart by the server start, known from the last health reading of the game
// (bl_telemetry 1.6: time of the reading minus the server uptime); without any reading, an open session of the
// last 24 hours is taken as in game.
export function onlineSession(alias = '') {
	const s = alias ? `${alias}.` : '';
	return `${s}left_at IS NULL AND ${s}joined_at > NOW() - INTERVAL '1 day' AND ${s}joined_at >= COALESCE((
		SELECT h.ts - make_interval(secs => (h.data->>'server_uptime_s')::double precision) - INTERVAL '2 minutes'
		FROM tel_health h WHERE jsonb_typeof(h.data->'server_uptime_s') = 'number' ORDER BY h.ts DESC LIMIT 1), '-infinity'::timestamptz)`;
}
