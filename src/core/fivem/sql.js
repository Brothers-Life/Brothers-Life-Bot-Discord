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
