// Turns the named parameters of a query (@name, :name, $name) into `?` placeholders, and binds the
// values the way better-sqlite3 did: positional arguments, arrays (flattened) and/or one object of named values.

// Splits a query into its placeholders, skipping strings, quoted identifiers and comments
export function compile(sql) {
	const slots = [];
	let out = '';
	let positional = 0;
	for (let i = 0; i < sql.length; i++) {
		const ch = sql[i];
		if (ch === '\'' || ch === '"' || ch === '`') {
			const end = closing(sql, i, ch);
			out += sql.slice(i, end + 1);
			i = end;
			continue;
		}
		if (ch === '-' && sql[i + 1] === '-') {
			const end = sql.indexOf('\n', i);
			const stop = end === -1 ? sql.length : end;
			out += sql.slice(i, stop);
			i = stop - 1;
			continue;
		}
		if (ch === '/' && sql[i + 1] === '*') {
			const end = sql.indexOf('*/', i + 2);
			const stop = end === -1 ? sql.length : end + 2;
			out += sql.slice(i, stop);
			i = stop - 1;
			continue;
		}
		if (ch === '?') {
			slots.push(positional++);
			out += '?';
			continue;
		}
		if ((ch === '@' || ch === ':' || ch === '$') && /[A-Za-z_]/.test(sql[i + 1] ?? '') && !/[\w]/.test(sql[i - 1] ?? '')) {
			const match = /^[A-Za-z_]\w*/.exec(sql.slice(i + 1));
			slots.push(match[0]);
			out += '?';
			i += match[0].length;
			continue;
		}
		out += ch;
	}
	return { sql: out, slots, named: slots.some(s => typeof s === 'string') };
}

function closing(sql, start, quote) {
	for (let i = start + 1; i < sql.length; i++) {
		if (sql[i] === '\\' && quote !== '`') {
			i++;
			continue;
		}
		if (sql[i] === quote) {
			// Doubled quote = escaped quote
			if (sql[i + 1] === quote) {
				i++;
				continue;
			}
			return i;
		}
	}
	return sql.length - 1;
}

function isPlainObject(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value) && !Buffer.isBuffer(value) && !(value instanceof Date) && !ArrayBuffer.isView(value);
}

export function normalize(value) {
	if (value === undefined || value === null) return null;
	if (typeof value === 'boolean') return value ? 1 : 0;
	if (typeof value === 'bigint') return value.toString();
	if (typeof value === 'number' || typeof value === 'string' || Buffer.isBuffer(value) || value instanceof Date) return value;
	if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
	throw new TypeError(`SQL parameters can only be numbers, strings, buffers, dates and null (got ${typeof value}). Serialize objects with JSON.stringify.`);
}

// Values in placeholder order
export function bind(compiled, args) {
	const positional = [];
	let named = null;
	for (const arg of args) {
		if (Array.isArray(arg)) positional.push(...arg);
		else if (compiled.named && isPlainObject(arg)) named = arg;
		else positional.push(arg);
	}
	return compiled.slots.map((slot) => {
		if (typeof slot === 'number') {
			if (slot >= positional.length) throw new RangeError(`Missing SQL parameter #${slot + 1}`);
			return normalize(positional[slot]);
		}
		if (!named || !(slot in named)) throw new RangeError(`Missing named SQL parameter "${slot}"`);
		return normalize(named[slot]);
	});
}
