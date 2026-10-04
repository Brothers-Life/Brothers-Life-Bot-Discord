import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, MAIN, ALICE } from '../helpers.js';
import { createFivemEvents, cleanEventData, defaultConfig, eventVariables } from '../../src/core/fivemEvents.js';
import { ForbiddenError, ValidationError } from '../../src/core/errors.js';
import { fivemPayload } from '../../src/bot/fivemUi.js';

const ANNOUNCE = '611000000000000001';
const LOGS = '611000000000000002';
const ROLE = '612000000000000001';
const START = Date.UTC(2026, 9, 5, 18, 0);

async function setup() {
	const ctx = await withNetwork();
	const { core, executor } = ctx;
	executor.channels.set(ANNOUNCE, { guildId: MAIN, name: 'annonces-fivem' });
	executor.channels.set(LOGS, { guildId: MAIN, name: 'logs-fivem' });
	await core.logs.setRoute(ctx.owner, MAIN, 'fivemevents', LOGS);
	const clock = { at: START };
	const status = { maintenance: [], republished: 0 };
	const fivem = { setMaintenance: m => status.maintenance.push(m), republish: async () => { status.republished += 1; } };
	const events = createFivemEvents({ db: core.db, settings: core.settings, audit: core.audit, logs: core.logs, executor, network: core.network, variables: core.variables, fivem, logger: { warn: () => undefined }, now: () => clock.at });
	// The bridge's key: only fivem.events
	const bridge = { id: ctx.owner.id, source: 'panel', can: p => p === 'fivem.events' };
	const enableAll = (patch = {}) => {
		const config = defaultConfig();
		for (const e of Object.values(config.events)) {
			e.enabled = true;
			if (e.targets) e.targets = [{ guildId: MAIN, channelId: ANNOUNCE, ping: 'roles', roleIds: [ROLE], publish: false }];
		}
		config.maintenance.targets = [{ guildId: MAIN, channelId: ANNOUNCE, ping: 'none', roleIds: [], publish: false }];
		return events.saveConfig(ctx.owner, { ...config, ...patch });
	};
	executor.sent.length = 0;
	return { ...ctx, events, clock, status, bridge, enableAll };
}

test('event data is cleaned: no identifiers kept, color codes removed', () => {
	const clean = cleanEventData({ author: '^1Admin', reason: 'RDM', targetIds: ['license:abc', 'ip:1.2.3.4'], targetHwids: ['x'], targetName: 'Léa', targetDiscord: '123', expiration: false, secondsRemaining: 300 });
	assert.deepEqual(clean, { author: 'Admin', reason: 'RDM', secondsRemaining: 300, targetName: 'Léa' });
	const vars = eventVariables({ secondsRemaining: 900 }, { server: 'BRL', at: START });
	assert.equal(vars['txadmin.minutes'], 15);
	assert.equal(vars['txadmin.restart.relative'], `<t:${Math.round((START + 900_000) / 1000)}:R>`);
	assert.equal(eventVariables({}, { server: null, at: START })['txadmin.duration'], 'définitif');
});

test('only a key with fivem.events can send events; disabled events are only stored', async () => {
	const { events, owner, bridge, executor } = await setup();
	await assert.rejects(events.ingest({ ...owner, can: () => false }, { type: 'announcement', data: {} }), ForbiddenError);
	const res = await events.ingest(bridge, { type: 'announcement', data: { author: 'Admin', message: 'Coucou' } });
	assert.equal(res.status, 'disabled');
	assert.equal(executor.announcements.length, 0);
	assert.equal(events.recent()[0].status, 'disabled');
	await assert.rejects(events.ingest(bridge, { type: 'nope' }), ValidationError);
});

test('announcement posted with the template, variables filled and only the chosen roles pinged', async () => {
	const { events, bridge, executor, enableAll } = await setup();
	enableAll();
	const res = await events.ingest(bridge, { type: 'announcement', server: 'Brothers Life', data: { author: 'Pedro', message: 'Event ce soir !' } });
	assert.equal(res.status, 'posted');
	const sent = executor.announcements[0];
	assert.equal(sent.channelId, ANNOUNCE);
	assert.equal(sent.payload.embed.description, 'Event ce soir !');
	assert.equal(sent.payload.embed.footerText, 'Par Pedro');
	assert.deepEqual([sent.target.ping, sent.target.roleIds], ['roles', [ROLE]]);
});

test('restart countdown: only chosen thresholds, each once per restart, next restart exposed', async () => {
	const { events, bridge, executor, clock, enableAll } = await setup();
	enableAll();
	const send = secondsRemaining => events.ingest(bridge, { type: 'scheduledRestart', server: 'BRL', data: { secondsRemaining } });
	assert.equal((await send(1800)).status, 'posted');
	assert.deepEqual(events.publicState().nextRestart, { at: START + 1_800_000 });
	// Same warning a minute later (second resource, retry after the 15 s window): not posted twice
	clock.at += 20_000;
	assert.equal((await send(1780)).status, 'duplicate');
	clock.at = START + 20 * 60_000;
	assert.equal((await send(600)).status, 'ignored');
	clock.at = START + 25 * 60_000;
	assert.equal((await send(300)).status, 'posted');
	assert.equal(executor.announcements.length, 2);
	assert.match(executor.announcements[1].payload.embed.title, /5 min/);
	// Skipped: no next restart any more
	await events.ingest(bridge, { type: 'scheduledRestartSkipped', data: { author: 'Admin', secondsRemaining: 300 } });
	assert.equal(events.publicState().nextRestart, null);
});

test('the same event twice in a few seconds is a duplicate', async () => {
	const { events, bridge, executor, enableAll } = await setup();
	enableAll();
	await events.ingest(bridge, { type: 'serverStarted', server: 'BRL', data: {} });
	assert.equal((await events.ingest(bridge, { type: 'serverStarted', server: 'BRL', data: {} })).status, 'duplicate');
	assert.equal(executor.announcements.length, 1);
});

test('player events go to the staff log category, never to the public channels', async () => {
	const { core, events, bridge, executor, enableAll } = await setup();
	enableAll();
	const res = await events.ingest(bridge, { type: 'playerBanned', server: 'BRL', data: { author: 'Admin', reason: 'Cheat', targetName: 'Léa', targetDiscord: ALICE, durationTranslated: '7 jours', targetIds: ['license:x'] } });
	assert.equal(res.status, 'logged');
	await core.logs.flush();
	const log = executor.sent.find(s => s.channelId === LOGS && s.message.type === 'playerBanned');
	assert.equal(log.message.title, 'Joueur banni (txAdmin)');
	assert.equal(log.message.thumbnailUserId, ALICE);
	assert.ok(log.message.fields.some(f => f.name === 'Durée' && f.value === '7 jours'));
	assert.ok(!JSON.stringify(events.recent()[0].data).includes('license'));
	assert.equal(executor.announcements.length, 0);
});

test('maintenance: announced, shown in the status messages, mutes the public events, then ended', async () => {
	const { core, events, owner, bridge, executor, status, clock, enableAll } = await setup();
	enableAll();
	const state = await events.setMaintenance(owner, { active: true, reason: 'Mise à jour 2.0' });
	assert.equal(state.maintenance.active, true);
	assert.equal(state.maintenance.reason, 'Mise à jour 2.0');
	assert.match(executor.announcements.at(-1).payload.embed.description, /Mise à jour 2\.0/);
	assert.equal(status.maintenance.at(-1).active, true);
	assert.ok(status.republished >= 1);
	await assert.rejects(events.setMaintenance(owner, { active: true }), ValidationError);

	assert.equal((await events.ingest(bridge, { type: 'serverStarted', data: {} })).status, 'muted');
	clock.at += 90 * 60_000;
	await events.setMaintenance(owner, { active: false });
	assert.match(executor.announcements.at(-1).payload.embed.description, /1 h 30/);
	assert.equal(status.maintenance.at(-1), null);
	assert.equal(events.publicState().maintenance.active, false);
	assert.deepEqual(core.audit.query({ action: 'fivemevents.maintenance_off' }).length, 1);
	await assert.rejects(events.setMaintenance({ ...owner, can: () => false }, { active: true }), ForbiddenError);
});

test('settings: an enabled event needs a channel, @everyone needs its permission, test sends sample data', async () => {
	const { events, owner, executor, enableAll } = await setup();
	const config = defaultConfig();
	config.events.announcement.enabled = true;
	assert.throws(() => events.saveConfig(owner, config), ValidationError);
	config.events.announcement.targets = [{ guildId: MAIN, channelId: ANNOUNCE, ping: 'everyone', roleIds: [], publish: false }];
	const limited = { ...owner, can: p => p !== 'announcements.everyone' };
	assert.throws(() => events.saveConfig(limited, config), ForbiddenError);
	enableAll();
	const res = await events.test(owner, 'scheduledRestart');
	assert.equal(res.status, 'posted');
	assert.equal(events.publicState().nextRestart, null);
	assert.equal(events.recent()[0].test, true);
	assert.equal(executor.announcements.length, 1);
});

test('status message shows the maintenance', () => {
	const server = { name: 'BRL', joinCode: null, config: { color: '#ff9628', showPlayers: false }, maintenance: { reason: 'MAJ', since: START } };
	const embed = fivemPayload({ server, status: { online: true, players: 3, max: 64, list: [], checkedAt: START } }).embeds[0].toJSON();
	assert.equal(embed.fields[0].value, '🛠️ Maintenance');
	assert.match(embed.description, /MAJ/);
});
