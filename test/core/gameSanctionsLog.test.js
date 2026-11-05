import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGameSanctionsLog, durationText, sanctionLogMessage } from '../../src/core/fivem/sanctionsLog.js';

const ALICE = '100000000000000002';

function setup(rows = [], { copy = true } = {}) {
	const store = new Map();
	const settings = { get: async (k, d = null) => (store.has(k) ? store.get(k) : d), set: async (k, v) => store.set(k, v) };
	const logged = [];
	const logs = { registerCategory: () => undefined, log: async (guildId, category, message) => logged.push({ guildId, category, message }) };
	const table = { rows };
	const fivemData = {
		sanctionsAfter: async (after, { limit }) => {
			if (!copy) return null;
			const last = Math.max(0, ...table.rows.map(r => r.id));
			if (after === null) return { last, rows: [] };
			return { last, rows: table.rows.filter(r => r.id > after).slice(0, limit) };
		},
	};
	return { service: createGameSanctionsLog({ fivemData, settings, logs, logger: { warn: () => undefined } }), logged, table, store };
}

const row = (id, extra = {}) => ({ id, userId: 1, targetName: 'Tony', username: 'pedro', type: 'warn', reason: 'RP', minutes: null, issuedBy: 'Kenzo', at: Date.now(), discordId: ALICE, ...extra });

test('in-game sanctions: the first pass starts at the end, then each new one is logged once', async () => {
	const { service, logged, table } = setup([row(1), row(2)]);
	assert.equal(await service.tick(), 0);
	assert.equal(logged.length, 0, 'old sanctions are not flooded');
	table.rows.push(row(3, { type: 'ban', minutes: 1440 * 3, discordId: null }), row(4));
	assert.equal(await service.tick(), 2);
	assert.equal(await service.tick(), 0);
	assert.deepEqual(logged.map(l => l.category), ['fivemsanctions', 'fivemsanctions']);
	const ban = logged[0].message;
	assert.equal(ban.title, 'Bannissement en jeu');
	assert.equal(ban.color, 'danger');
	assert.match(ban.fields.find(f => f.name === 'Joueur').value, /aucun Discord lié/);
	assert.equal(ban.fields.find(f => f.name === 'Durée').value, '3 j');
	assert.match(logged[1].message.fields.find(f => f.name === 'Joueur').value, new RegExp(`<@${ALICE}>`));
	assert.equal(logged[1].message.thumbnailUserId, ALICE);
});

test('in-game sanctions: a burst is spread over passes, a reset table starts over, no copy does nothing', async () => {
	const { service, logged, table, store } = setup([]);
	await service.tick();
	for (let id = 1; id <= 25; id++) table.rows.push(row(id));
	assert.equal(await service.tick(), 20);
	assert.equal(await service.tick(), 5);
	assert.equal(logged.length, 25);
	table.rows = [row(1)];
	assert.equal(await service.tick(), 0);
	assert.equal(store.get('fivemSanctions.cursor'), 1);

	const none = setup([], { copy: false });
	assert.equal(await none.service.tick(), 0);
	assert.equal(none.logged.length, 0);
});

test('in-game sanctions: durations and unknown types read well', () => {
	assert.equal(durationText(null, 'ban'), 'définitive');
	assert.equal(durationText(null, 'warn'), null);
	assert.equal(durationText(30, 'jail'), '30 min');
	assert.equal(durationText(90, 'jail'), '1.5 h');
	assert.equal(sanctionLogMessage(row(1, { type: 'slap' })).title, 'Sanction (slap) en jeu');
});
