import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb } from '../db.js';
import { createSessions } from '../../src/core/sessions.js';

async function setup() {
	let clock = 1_000_000;
	const sessions = createSessions({ db: await openTestDb(), ttlMs: 10_000_000, idleMs: 1_000_000, now: () => clock });
	return { sessions, advance: (ms) => { clock += ms; } };
}

test('creates a random session and finds it back', async () => {
	const { sessions } = await setup();
	const id = await sessions.create({ discordId: '123', username: 'alice' });
	assert.ok(id.length >= 40);
	assert.equal((await sessions.touch(id)).discordId, '123');
	assert.equal(await sessions.touch('nope'), null);
});

test('expires after inactivity', async () => {
	const { sessions, advance } = await setup();
	const id = await sessions.create({ discordId: '123' });
	advance(900_000);
	assert.ok(await sessions.touch(id), 'activity refreshes the session');
	advance(900_000);
	assert.ok(await sessions.touch(id));
	advance(1_000_001);
	assert.equal(await sessions.touch(id), null);
});

test('expires after its lifetime even when active', async () => {
	const { sessions, advance } = await setup();
	const id = await sessions.create({ discordId: '123' });
	for (let i = 0; i < 11; i++) {
		advance(950_000);
		await sessions.touch(id);
	}
	assert.equal(await sessions.touch(id), null);
});

test('revocation', async () => {
	const { sessions } = await setup();
	const a = await sessions.create({ discordId: '1' });
	await sessions.create({ discordId: '1' });
	const c = await sessions.create({ discordId: '2' });
	assert.equal((await sessions.list('1')).length, 2);
	assert.equal(await sessions.revoke(a), true);
	assert.equal(await sessions.revokeAllFor('1'), 1);
	assert.deepEqual((await sessions.list()).map(s => s.id), [c]);
});
