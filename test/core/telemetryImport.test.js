import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openTestDb, createScratchDatabase } from '../db.js';
import { createSettings } from '../../src/db/index.js';
import { importTelemetry, IMPORT_SETTING } from '../../src/core/telemetry/importer.js';

const silent = { info: () => undefined, warn: () => undefined };

// The old panel's database (bl-panel-api schema.sql), with a few rows
async function oldDatabase() {
	const old = await createScratchDatabase({ migrate: false });
	await old.exec(fs.readFileSync(new URL('../fixtures/old-telemetry-schema.sql', import.meta.url), 'utf8'));
	await old.raw(`INSERT INTO events (id, ts, type, citizenid, player_name, data) VALUES
		(5, now(), 'death', 'ABC12345', 'Léa', '{"cause":"chute","license":"license:abc","nested":{"ip":"1.2.3.4","x":1}}'),
		(9, now(), 'purchase', 'ABC12345', 'Léa', '{"article":"pain"}')`);
	await old.raw('INSERT INTO economy_snapshots (player_count, total_cash) VALUES (12, 5000), (14, 5200)');
	await old.raw('INSERT INTO panel_users (discord_id, access) VALUES (\'100000000000000001\', \'granted\')');
	return old;
}

test('the old telemetry database is copied once, without player identifiers, ids and sequences kept', async () => {
	const db = await openTestDb();
	const settings = createSettings(db);
	const old = await oldDatabase();
	const counts = await importTelemetry({ db, url: old.options.connectionString, settings, logger: silent });
	assert.equal(counts.events, 2);
	assert.equal(counts.economy_snapshots, 2);

	const events = await db.query('SELECT id, type, data FROM tel_events ORDER BY id');
	assert.deepEqual(events.map(e => e.id), [5, 9]);
	const data = typeof events[0].data === 'string' ? JSON.parse(events[0].data) : events[0].data;
	assert.deepEqual(data, { cause: 'chute', nested: { x: 1 } });
	// New rows continue after the copied ids
	await db.raw('INSERT INTO tel_events (type) VALUES (\'chat\')');
	assert.equal((await db.query('SELECT MAX(id) AS id FROM tel_events'))[0].id, 10);
	assert.equal((await db.query('SELECT COUNT(*) AS n FROM tel_economy_snapshots'))[0].n, 2);

	// Done once: a restart copies nothing more
	assert.ok(await settings.get(IMPORT_SETTING));
	assert.equal(await importTelemetry({ db, url: old.options.connectionString, settings, logger: silent }), null);
	assert.equal((await db.query('SELECT COUNT(*) AS n FROM tel_events'))[0].n, 3);
});
