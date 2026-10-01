import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, MAIN } from '../helpers.js';
import { ForbiddenError, ValidationError } from '../../src/core/errors.js';
import { createFivemRoles, normalizeLinks } from '../../src/core/fivemRoles.js';

const COP = '300000000000000091';
const EX_COP = '300000000000000092';
const STRANGER = '300000000000000093';
const ADMIN = '300000000000000094';
const LSPD = '800000000000000191';
const SERGEANT = '800000000000000192';
const STAFF = '800000000000000193';
const TOO_HIGH = '800000000000000194';

const group = (name, type, grade, label) => ({ name, type, grade, label, gradeLabel: null, character: 'John Doe' });
const ACCOUNTS = [
	{ userId: 1, username: 'cop', discordId: COP, groups: [group('police', 'job', 1, 'LSPD')], staff: null },
	{ userId: 2, username: 'excop', discordId: EX_COP, groups: [group('mechanic', 'job', 0, 'Benny’s')], staff: null },
	{ userId: 3, username: 'admin', discordId: ADMIN, groups: [], staff: { name: 'admin', lastSeen: 0 } },
	{ userId: 4, username: 'nolink', discordId: null, groups: [group('police', 'job', 3, 'LSPD')], staff: null },
];

async function setup() {
	const ctx = await withNetwork();
	const { core, executor } = ctx;
	executor.roles.set(MAIN, [
		{ id: LSPD, name: 'LSPD', color: '#0000ff', editable: true },
		{ id: SERGEANT, name: 'Sergent', color: '#0000ff', editable: true },
		{ id: STAFF, name: 'Staff', color: '#ff9628', editable: true },
		{ id: TOO_HIGH, name: 'Direction', color: '#ff0000', editable: false },
	]);
	executor.memberRoles.set(`${MAIN}:${COP}`, []);
	executor.memberRoles.set(`${MAIN}:${EX_COP}`, [LSPD]);
	executor.memberRoles.set(`${MAIN}:${STRANGER}`, [LSPD, TOO_HIGH]);
	executor.memberRoles.set(`${MAIN}:${ADMIN}`, []);
	const roles = createFivemRoles({ fivemData: { memberships: async () => ACCOUNTS }, settings: core.settings, executor, network: core.network, audit: core.audit, logs: core.logs, logger: { warn: () => undefined } });
	roles.setLinks(ctx.owner, [
		{ kind: 'job', name: 'police', minGrade: 0, guildId: MAIN, roleId: LSPD },
		{ kind: 'job', name: 'police', minGrade: 2, guildId: MAIN, roleId: SERGEANT },
		{ kind: 'staff', name: 'admin', guildId: MAIN, roleId: STAFF },
		{ kind: 'gang', name: 'ballas', guildId: MAIN, roleId: TOO_HIGH },
	]);
	return { ...ctx, roles };
}

test('fivem roles: links are validated', () => {
	assert.throws(() => normalizeLinks([{ kind: 'boss', name: 'x', guildId: MAIN, roleId: LSPD }]), ValidationError);
	assert.throws(() => normalizeLinks([{ kind: 'job', name: '', guildId: MAIN, roleId: LSPD }]), ValidationError);
	assert.throws(() => normalizeLinks([{ kind: 'job', name: 'police', guildId: 'x', roleId: LSPD }]), ValidationError);
	const [link] = normalizeLinks([{ kind: 'staff', name: 'admin', minGrade: 5, guildId: MAIN, roleId: STAFF }]);
	assert.equal(link.minGrade, 0);
	assert.ok(link.id);
});

test('fivem roles: the check finds missing and extra roles, grade thresholds and unlinked players', async () => {
	const { roles, owner } = await setup();
	const result = await roles.check(owner);
	const keys = result.issues.map(i => i.key).sort();
	assert.deepEqual(keys, [
		`add:${MAIN}:${ADMIN}:${STAFF}`,
		`add:${MAIN}:${COP}:${LSPD}`,
		`remove:${MAIN}:${EX_COP}:${LSPD}`,
		`remove:${MAIN}:${STRANGER}:${LSPD}`,
		`remove:${MAIN}:${STRANGER}:${TOO_HIGH}`,
	].sort());
	// Grade 1 does not reach the sergeant role (grade 2+)
	assert.equal(result.issues.some(i => i.roleId === SERGEANT), false);
	const stranger = result.issues.find(i => i.key === `remove:${MAIN}:${STRANGER}:${LSPD}`);
	assert.match(stranger.reason, /aucun compte FiveM/);
	assert.equal(result.issues.find(i => i.roleId === TOO_HIGH).fixable, false);
	assert.deepEqual(result.unlinked.map(u => u.username), ['nolink']);
});

test('fivem roles: fixing applies only what the check found, and needs the permission', async () => {
	const { roles, owner, executor } = await setup();
	const someone = { id: '100000000000000099', source: 'panel', can: () => false };
	await assert.rejects(roles.check(someone), ForbiddenError);

	const out = await roles.fix(owner, [`add:${MAIN}:${COP}:${LSPD}`, `remove:${MAIN}:${EX_COP}:${LSPD}`, `remove:${MAIN}:${STRANGER}:${TOO_HIGH}`, `add:${MAIN}:${STRANGER}:${STAFF}`]);
	assert.equal(out.done, 2);
	assert.deepEqual(out.failed.map(f => f.error).sort(), ['déjà réglé', 'rôle au-dessus du bot'].sort());
	assert.deepEqual(executor.memberRoles.get(`${MAIN}:${COP}`), [LSPD]);
	assert.deepEqual(executor.memberRoles.get(`${MAIN}:${EX_COP}`), []);
	assert.equal(executor.calls.some(c => c[0] === 'addRole' && c[2] === STRANGER), false);

	const again = await roles.check(owner);
	assert.equal(again.issues.some(i => i.userId === COP || i.userId === EX_COP), false);
});
