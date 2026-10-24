import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb } from '../db.js';
import { createFivemMirror, pgType, toColumn } from '../../src/core/fivem/mirror.js';

const PLAYERS = {
	pk: ['citizenid'],
	columns: [
		{ name: 'citizenid', type: 'varchar', columnType: 'varchar(50)' },
		{ name: 'userId', type: 'int', columnType: 'int(10) unsigned' },
		{ name: 'charinfo', type: 'longtext', columnType: 'longtext' },
		{ name: 'money', type: 'longtext', columnType: 'longtext' },
		{ name: 'last_updated', type: 'timestamp', columnType: 'timestamp' },
		{ name: 'ip', type: 'varchar', columnType: 'varchar(45)' },
	],
};
const FIELDS = ['citizenid', 'userId', 'charinfo', 'money', 'last_updated', 'ip'];

async function setup() {
	const db = await openTestDb();
	const mirror = createFivemMirror({ db, logger: { warn: () => undefined } });
	return { db, mirror };
}

test('mirror: MariaDB types become PostgreSQL types, values are converted', () => {
	assert.equal(pgType({ type: 'datetime' }), 'timestamptz');
	assert.equal(pgType({ type: 'bigint', columnType: 'bigint(20) unsigned' }), 'numeric');
	assert.equal(pgType({ type: 'tinyint', columnType: 'tinyint(1)' }), 'bigint');
	assert.equal(pgType({ type: 'json' }), 'text');
	assert.equal(pgType({ type: 'longblob' }), null);
	assert.equal(toColumn(1_760_000_000_000, 'timestamptz').getTime(), 1_760_000_000_000);
	assert.equal(toColumn(1_760_000_000, 'timestamptz').getTime(), 1_760_000_000_000);
	assert.equal(toColumn(true, 'bigint'), 1);
	assert.equal(toColumn({ a: 1 }, 'text'), '{"a":1}');
	assert.equal(toColumn('a\u0000b', 'text'), 'ab');
	assert.equal(toColumn('', 'bigint'), null);
});

test('mirror: a table is created from its schema, sensitive columns never stored, rows upserted', async () => {
	const { db, mirror } = await setup();
	const first = await mirror.apply({ tables: [{
		name: 'players', mode: 'updated', schemaHash: 'h1', schema: PLAYERS, from: null, cursor: '1000',
		fields: FIELDS, rows: [['ABC123', 1, '{"firstname":"Tony"}', '{"cash":10}', 1_760_000_000_000, '1.2.3.4']],
	}] });
	assert.deepEqual(first.tables.players, { ok: true, inserted: 1, removed: 0, reset: true });
	const columns = (await db.query('SELECT column_name AS c FROM information_schema.columns WHERE table_schema = \'fivem\' AND table_name = \'players\'')).map(r => r.c);
	assert.ok(columns.includes('userId') && !columns.includes('ip'));
	const [row] = await db.query('SELECT "userId", fivem.j(charinfo)->>\'firstname\' AS first, last_updated FROM fivem.players');
	assert.equal(row.userId, 1);
	assert.equal(row.first, 'Tony');
	assert.equal(row.last_updated.getTime(), 1_760_000_000_000);

	// Same schema: only the hash travels; an update and a new row
	const second = await mirror.apply({ tables: [{
		name: 'players', mode: 'updated', schemaHash: 'h1', from: '1000', cursor: '2000',
		fields: FIELDS, rows: [['ABC123', 1, '{"firstname":"Tony"}', '{"cash":99}', 1_760_000_100_000, null], ['XYZ999', 2, 'pas du json', '{}', null, null]],
	}] });
	assert.deepEqual(second.tables.players, { ok: true, inserted: 1, removed: 0 });
	assert.equal((await db.query('SELECT money FROM fivem.players WHERE citizenid = \'ABC123\''))[0].money, '{"cash":99}');
	// Invalid JSON of the game: NULL, not an error
	assert.equal((await db.query('SELECT fivem.j(charinfo) AS j FROM fivem.players WHERE citizenid = \'XYZ999\''))[0].j, null);
	const state = await mirror.state();
	assert.equal(state.players.cursor, '2000');
	assert.equal(state.players.rows, 2);
	assert.deepEqual(await mirror.tables(), new Set(['players']));
});

test('mirror: unknown schema hash asks for the columns, deletes and full key lists remove rows', async () => {
	const { mirror, db } = await setup();
	await mirror.apply({ tables: [{ name: 'players', mode: 'hash', schemaHash: 'h1', schema: PLAYERS, from: null, fields: FIELDS, rows: [['A', 1, '{}', '{}', null, null], ['B', 2, '{}', '{}', null, null], ['C', 3, '{}', '{}', null, null]] }] });
	assert.deepEqual((await mirror.apply({ tables: [{ name: 'players', mode: 'hash', schemaHash: 'h2', fields: FIELDS, rows: [] }] })).tables.players, { needSchema: true });
	await mirror.apply({ tables: [{ name: 'players', mode: 'hash', schemaHash: 'h1', from: 'x', fields: FIELDS, rows: [], deletes: [['A']] }] });
	assert.deepEqual((await db.query('SELECT citizenid FROM fivem.players ORDER BY 1')).map(r => r.citizenid), ['B', 'C']);
	const kept = await mirror.apply({ tables: [{ name: 'players', mode: 'hash', schemaHash: 'h1', from: 'x', fields: FIELDS, rows: [], keep: [['C']] }] });
	assert.equal(kept.tables.players.removed, 1);
	assert.deepEqual((await db.query('SELECT citizenid FROM fivem.players')).map(r => r.citizenid), ['C']);
	assert.equal((await mirror.state()).players.rows, 1);
});

test('mirror: a small table is replaced whole, a changed column type rebuilds the table and asks for a full send', async () => {
	const { mirror, db } = await setup();
	const groups = { pk: ['name'], columns: [{ name: 'name', type: 'varchar' }, { name: 'label', type: 'varchar' }] };
	await mirror.apply({ tables: [{ name: 'management_groups', mode: 'replace', replace: true, schemaHash: 'g1', schema: groups, checksum: '111', fields: ['name', 'label'], rows: [['police', 'LSPD'], ['ems', 'EMS']] }] });
	await mirror.apply({ tables: [{ name: 'management_groups', mode: 'replace', replace: true, schemaHash: 'g1', checksum: '222', fields: ['name', 'label'], rows: [['police', 'LSPD']] }] });
	assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM fivem.management_groups'))[0].n, 1);
	assert.equal((await mirror.state()).management_groups.checksum, '222');

	const changed = { pk: ['name'], columns: [{ name: 'name', type: 'varchar' }, { name: 'label', type: 'int' }] };
	const out = await mirror.apply({ tables: [{ name: 'management_groups', mode: 'hash', schemaHash: 'g2', schema: changed, from: 'somewhere', fields: ['name', 'label'], rows: [['x', 1]] }] });
	assert.deepEqual(out.tables.management_groups, { reset: true });
	assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM fivem.management_groups'))[0].n, 0);
	assert.equal((await mirror.state()).management_groups.checksum, null);
});

test('mirror: a counted-only table keeps its number of rows, no copy; becoming a copy needs its columns', async () => {
	const { mirror, db } = await setup();
	await mirror.apply({ tables: [{ name: 'ox_doorlock', mode: 'count', count: 42 }] });
	assert.equal(await mirror.counted('ox_doorlock'), 42);
	assert.equal((await mirror.tables()).has('ox_doorlock'), false);
	assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM pg_tables WHERE schemaname = \'fivem\''))[0].n, 0);
	assert.deepEqual((await mirror.apply({ tables: [{ name: 'ox_doorlock', mode: 'hash', schemaHash: 'count', fields: [], rows: [] }] })).tables.ox_doorlock, { needSchema: true });
	assert.equal(await mirror.counted('players'), null);
});

test('mirror: forbidden tables and bad names are refused, a bad table does not stop the others', async () => {
	const { mirror } = await setup();
	const out = await mirror.apply({ tables: [
		{ name: 'sky_phone_accounts', mode: 'hash', schemaHash: 'x', schema: PLAYERS, fields: [], rows: [] },
		{ name: 'bad name;', mode: 'hash', schemaHash: 'x', schema: PLAYERS, fields: [], rows: [] },
		{ name: 'players', mode: 'hash', schemaHash: 'x', schema: { pk: ['nope'], columns: PLAYERS.columns }, fields: [], rows: [] },
		{ name: 'bans', mode: 'append', schemaHash: 'b', schema: { pk: ['id'], columns: [{ name: 'id', type: 'int' }, { name: 'reason', type: 'text' }] }, from: null, cursor: '1', fields: ['id', 'reason'], rows: [[1, 'cheat']] },
	] });
	assert.deepEqual(out.tables.sky_phone_accounts, { error: 'refusée' });
	assert.deepEqual(out.tables['bad name;'], { error: 'refusée' });
	assert.equal(out.tables.players.error, 'clé primaire inconnue');
	assert.equal(out.tables.bans.ok, true);
});
