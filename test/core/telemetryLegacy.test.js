import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createTestCore, OWNER, ALICE, BOB, MAIN } from '../helpers.js';
import { createScratchDatabase } from '../db.js';
import { takeOverLegacyPanel, legacyTelemetryConfig, LEGACY_RANKS } from '../../src/core/telemetry/legacy.js';

const silent = { info: () => undefined, warn: () => undefined, success: () => undefined };
const CAROL = '100000000000000004';
const TOKEN = '491be7e3dd6af6ca15254a6562925c7426e58f47';

// Variables of the old panel-api and panel services, as they were set
const LEGACY = {
	INGEST_TOKEN: TOKEN, FIVEM_BASE: 'http://203.0.113.5:30120', PANEL_TZ: 'Europe/Brussels',
	ALERT_MONEY_JUMP: '100000000', ALERT_ERRORS_5MIN: '40', ALERT_ANTICHEAT_CHANNEL: 'ac',
	RETENTION_DAYS: '200', RETENTION_LOGS_DAYS: '14',
	WEBMASTER_DISCORD_IDS: `${OWNER},${ALICE}`, DISCORD_ALLOWED_ROLE_IDS: '700000000000000001, 700000000000000002', DISCORD_GUILD_ID: MAIN,
};

async function oldPanelDatabase() {
	const old = await createScratchDatabase({ migrate: false });
	await old.exec(fs.readFileSync(new URL('../fixtures/old-telemetry-schema.sql', import.meta.url), 'utf8'));
	await old.raw(`INSERT INTO panel_users (discord_id, access) VALUES ('${BOB}', 'granted'), ('${CAROL}', 'revoked'), ('${ALICE}', 'granted')`);
	return old;
}

test('the old panel variables become the telemetry settings', () => {
	const cfg = legacyTelemetryConfig(LEGACY);
	assert.equal(cfg.ingestToken, TOKEN);
	assert.deepEqual(cfg.alerts, { errors5min: 40, moneyJump: 100000000, anticheatChannel: 'ac' });
	assert.equal(cfg.retention.events, 200);
	assert.equal(cfg.retention.server_logs, 14);
	assert.equal(cfg.retention.perf_metrics, undefined);
	assert.deepEqual(legacyTelemetryConfig({}), {});
});

test('settings and accesses of the old panel are taken over once, without overwriting', async () => {
	const old = await oldPanelDatabase();
	const { core, db } = await createTestCore({ LEGACY_PANEL: LEGACY, TELEMETRY_IMPORT_FROM: old.options.connectionString });
	const out = await takeOverLegacyPanel({ core, db, config: core.config, logger: silent });
	assert.deepEqual(out.access, { webmasters: 1, accounts: 1, roles: 2 });

	const owner = await core.ranks.resolve(OWNER);
	const cfg = await core.telemetry.config(owner);
	assert.equal(cfg.hasIngestToken, true);
	assert.equal(cfg.fivemBase, 'http://203.0.113.5:30120');
	assert.equal(cfg.timezone, 'Europe/Brussels');
	assert.equal(cfg.alerts.moneyJump, 100000000);
	assert.equal(cfg.retention.server_logs, 14);

	// Alice was a webmaster, Bob was allowed by hand, Carol was removed, the owner already has everything
	const alice = await core.ranks.resolve(ALICE);
	assert.ok(alice.can('telemetry.manage') && alice.can('panel.access'));
	const bob = await core.ranks.resolve(BOB);
	assert.ok(bob.can('telemetry.view') && !bob.can('telemetry.manage'));
	assert.equal((await core.ranks.resolve(CAROL)).can('panel.access'), false);
	const viewer = (await core.ranks.list()).find(r => r.name === LEGACY_RANKS.viewer.name);
	assert.equal((await db.query('SELECT COUNT(*) AS n FROM rank_roles WHERE rank_id = ? AND guild_id = ?', viewer.id, MAIN))[0].n, 2);

	// Changed from the panel afterwards: a restart keeps the change and creates nothing more
	await core.telemetry.setConfig(owner, { alerts: { moneyJump: 5000 } });
	const again = await takeOverLegacyPanel({ core, db, config: core.config, logger: silent });
	assert.equal(again.settings, null);
	assert.equal(again.access, null);
	assert.equal((await core.telemetry.config(owner)).alerts.moneyJump, 5000);
	assert.equal((await core.ranks.list()).filter(r => r.name.startsWith('FiveM —')).length, 2);
});

test('nothing to take over without old panel variables', async () => {
	const { core, db } = await createTestCore();
	const out = await takeOverLegacyPanel({ core, db, config: core.config, logger: silent });
	assert.equal(out.settings, null);
	assert.equal(out.access, null);
	assert.equal(await core.settings.get('telemetry.config', null), null);
});
