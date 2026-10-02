import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestCore, MAIN } from '../helpers.js';
import { createVariables, usesFivem } from '../../src/core/variables.js';
import { fillText } from '../../src/core/customCommands/engine.js';

const MEMBER = '300000000000000001';

function setup({ fivemVars = async () => ({ 'fivem.dbid': 42 }), enabled = true } = {}) {
	const { executor } = createTestCore();
	executor.memberRoles.set(`${MAIN}:${MEMBER}`, ['800000000000000001']);
	executor.roles.set(MAIN, [{ id: '800000000000000001', name: 'Citoyen' }]);
	const calls = [];
	const variables = createVariables({
		executor, logger: { warn: () => undefined },
		fivemVars: async (id) => { calls.push(id); return fivemVars(id); },
		fivemEnabled: () => enabled,
	});
	return { variables, calls };
}

test('member variables: Discord member, server, and FiveM only when asked', async () => {
	const { variables, calls } = setup();
	const vars = await variables.member(MAIN, MEMBER);
	assert.equal(vars.user, `<@${MEMBER}>`);
	assert.equal(vars['user.id'], MEMBER);
	assert.equal(vars['member.roles'], 'Citoyen');
	assert.equal(vars.server, 'Serveur');
	assert.equal(vars['fivem.dbid'], undefined);
	assert.equal(calls.length, 0);

	const withFivem = await variables.member(MAIN, MEMBER, { fivem: true });
	assert.equal(withFivem['fivem.dbid'], 42);
});

test('a FiveM failure never breaks the other variables', async () => {
	const { variables } = setup({ fivemVars: async () => { throw new Error('ECONNREFUSED'); } });
	const vars = await variables.member(MAIN, MEMBER, { fivem: true });
	assert.equal(vars['user.id'], MEMBER);
	assert.equal(vars['fivem.dbid'], undefined);
});

test('catalog: FiveM group only when the database is set up', () => {
	assert.ok(setup().variables.catalog('member').some(g => g.title === 'Compte FiveM'));
	assert.ok(!setup({ enabled: false }).variables.catalog('member').some(g => g.title === 'Compte FiveM'));
	assert.ok(!setup().variables.catalog('server').some(g => g.title === 'Membre'));
	assert.equal(usesFivem({ content: 'id {fivem.dbid}' }), true);
	assert.equal(usesFivem('salut {user}'), false);
});

test('custom commands read the shared variables lazily, FiveM included', async () => {
	const { variables, calls } = setup();
	let shared = null;
	const io = {
		now: Date.now, random: () => 0,
		sharedVars: async (fivem) => {
			if (!shared || (fivem && !shared.fivem)) shared = { fivem, vars: await variables.member(MAIN, MEMBER, { fivem }) };
			return shared.vars;
		},
	};
	const ctx = { user: { id: MEMBER, name: 'Léa' }, options: {}, serverName: 'Serveur' };
	assert.equal(await fillText('{user.name} sans FiveM', ctx, io), 'Léa sans FiveM');
	assert.equal(calls.length, 0);
	assert.equal(await fillText('{member.roles} · dbid {fivem.dbid} · {inconnue}', ctx, io), 'Citoyen · dbid 42 · {inconnue}');
	assert.equal(calls.length, 1);
});
