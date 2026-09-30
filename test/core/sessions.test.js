import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db/index.js';
import { createSessions } from '../../src/core/sessions.js';

function setup() {
	let clock = 1_000_000;
	const sessions = createSessions({ db: openDb(':memory:'), ttlMs: 10_000_000, idleMs: 1_000_000, now: () => clock });
	return { sessions, advance: (ms) => { clock += ms; } };
}

test('creates a random session and finds it back', () => {
	const { sessions } = setup();
	const id = sessions.create({ discordId: '123', username: 'alice' });
	assert.ok(id.length >= 40);
	assert.equal(sessions.touch(id).discordId, '123');
	assert.equal(sessions.touch('nope'), null);
});

test('expires after inactivity', () => {
	const { sessions, advance } = setup();
	const id = sessions.create({ discordId: '123' });
	advance(900_000);
	assert.ok(sessions.touch(id), 'activity refreshes the session');
	advance(900_000);
	assert.ok(sessions.touch(id));
	advance(1_000_001);
	assert.equal(sessions.touch(id), null);
});

test('expires after its lifetime even when active', () => {
	const { sessions, advance } = setup();
	const id = sessions.create({ discordId: '123' });
	for (let i = 0; i < 11; i++) {
		advance(950_000);
		sessions.touch(id);
	}
	assert.equal(sessions.touch(id), null);
});

test('revocation', () => {
	const { sessions } = setup();
	const a = sessions.create({ discordId: '1' });
	sessions.create({ discordId: '1' });
	const c = sessions.create({ discordId: '2' });
	assert.equal(sessions.list('1').length, 2);
	assert.equal(sessions.revoke(a), true);
	assert.equal(sessions.revokeAllFor('1'), 1);
	assert.deepEqual(sessions.list().map(s => s.id), [c]);
});
