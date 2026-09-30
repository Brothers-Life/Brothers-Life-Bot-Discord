import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, ALICE, BOB, MAIN, OTHER } from '../helpers.js';
import { ForbiddenError } from '../../src/core/errors.js';
import { normalizeCommand } from '../../src/core/customCommands/schema.js';
import { createCustomCommands } from '../../src/core/customCommands/index.js';
import { fillText } from '../../src/core/customCommands/engine.js';

const CHANNEL = '610000000000000001';
const VIP = '800000000000000020';

async function setup() {
	const ctx = await withNetwork();
	const { core, executor } = ctx;
	const waits = [];
	const customCommands = createCustomCommands({
		db: core.db, network: core.network, ranks: core.ranks, audit: core.audit, executor, logs: core.logs, members: core.members,
		moderation: core.moderation, sanctions: core.sanctions, reservedNames: ['ban', 'ticket'], logger: { warn: () => undefined },
		sleep: async (ms) => { waits.push(ms); }, random: () => 0.5,
	});
	return { ...ctx, customCommands, waits };
}

// What the bot layer would do with the flow's messages
function recorder() {
	const out = { replies: [], sent: [], dms: [], reactions: [], deleted: 0 };
	return {
		out,
		respond: {
			reply: async (msg, opts) => out.replies.push({ ...msg, ephemeral: opts.ephemeral, components: opts.components.map(c => c.id) }),
			send: async (channelId, msg) => out.sent.push({ channelId, ...msg }),
			dm: async (userId, msg) => out.dms.push({ userId, ...msg }),
			react: async emoji => out.reactions.push(emoji),
			deleteTrigger: async () => { out.deleted++; },
		},
	};
}

const user = (id, roleIds = [], permissions = []) => ({ id, name: 'Léa', roleIds, permissions, createdAt: Date.now() - 400 * 86_400_000, joinedAt: Date.now() - 2 * 86_400_000 });

test('schema: slash names, reserved names, options order, keyword patterns, empty flows', () => {
	assert.throws(() => normalizeCommand({ name: 'Mauvais Nom', flow: [{ type: 'stop' }] }), /minuscules/);
	assert.throws(() => normalizeCommand({ name: 'ban', flow: [{ type: 'stop' }] }, { reservedNames: new Set(['ban']) }), /existe déjà/);
	const c = normalizeCommand({
		name: 'Salut', description: 'Dire bonjour',
		options: [{ name: 'message', type: 'string' }, { name: 'membre', type: 'user', required: true }],
		flow: [{ type: 'reply', content: 'Salut {option.membre} !' }],
	});
	assert.equal(c.name, 'salut');
	assert.deepEqual(c.options.map(o => o.name), ['membre', 'message'], 'required options first');
	assert.throws(() => normalizeCommand({ name: 'x', trigger: { type: 'keyword', keyword: { mode: 'regex', patterns: ['(('] } }, flow: [{ type: 'stop' }] }), /régulière/);
	assert.throws(() => normalizeCommand({ name: 'x', flow: [] }), /vide/);
	const regex = p => () => normalizeCommand({ name: 'x', trigger: { type: 'keyword', keyword: { mode: 'regex', patterns: [p] } }, flow: [{ type: 'stop' }] });
	for (const risky of ['(a+)+', '(\\w*)*x', '(a)\\1']) assert.throws(regex(risky), /risquée/, risky);
	for (const fine of ['^!r[eè]gles', '(foo|bar)', '\\bdiscord\\b']) assert.doesNotThrow(regex(fine), fine);
	assert.throws(() => normalizeCommand({ name: 'x', flow: [{ type: 'sanction', kind: 'warn', target: 'invoker', reason: 'x' }] }), /option membre/);
	const menu = normalizeCommand({ name: 'Profil', trigger: { type: 'user' }, flow: [{ type: 'reply', content: 'Profil de {option.cible}' }] });
	assert.equal(menu.name, 'Profil', 'right-click names keep their case and spaces');
});

test('variables are filled: user, options, counters, random, choice', async () => {
	const io = { counterGet: async () => 7, random: () => 0.5, now: () => Date.UTC(2026, 9, 1, 12, 5) };
	const ctx = { user: { id: '1' }, options: { membre: { display: '<@2>' } }, serverName: 'Brothers Life', channelId: '3' };
	assert.equal(await fillText('{user} → {option.membre} sur {server} ({counter.points}) {random:1-10} {choice:a|b}', ctx, io, io.now), '<@1> → <@2> sur Brothers Life (7) 6 b');
});

test('flow: conditions with else branch, counters, ephemeral reply with buttons, wait, stop', async () => {
	const { customCommands, owner, waits } = await setup();
	const cmd = await customCommands.save(owner, {
		name: 'daily', description: 'Récompense du jour',
		components: [{ id: 'merci', kind: 'button', label: 'Merci !', flow: [{ type: 'reply', content: 'Avec plaisir {user}', ephemeral: true }] }],
		flow: [
			{ type: 'if', conditions: [{ kind: 'counter', key: 'daily', perUser: true, op: 'gt', value: 0 }], then: [{ type: 'reply', content: 'Déjà pris aujourd’hui.', ephemeral: true }, { type: 'stop' }], else: [] },
			{ type: 'counter', key: 'daily', perUser: true, op: 'add', value: 1 },
			{ type: 'counter', key: 'total', op: 'add', value: 1 },
			{ type: 'wait', seconds: 2 },
			{ type: 'reply', content: 'Bravo {user}, {counter.total} récompense(s) données.', components: ['merci'] },
		],
	});
	const first = recorder();
	await customCommands.execute({ commandId: cmd.id, trigger: 'slash', guildId: MAIN, channelId: CHANNEL, user: user(BOB), respond: first.respond });
	assert.equal(first.out.replies[0].content, `Bravo <@${BOB}>, 1 récompense(s) données.`);
	assert.deepEqual(first.out.replies[0].components, ['merci']);
	assert.deepEqual(waits, [2000]);

	const second = recorder();
	await customCommands.execute({ commandId: cmd.id, trigger: 'slash', guildId: MAIN, channelId: CHANNEL, user: user(BOB), respond: second.respond });
	assert.deepEqual(second.out.replies.map(r => r.content), ['Déjà pris aujourd’hui.'], 'stopped after the first branch');

	const click = recorder();
	await customCommands.execute({ commandId: cmd.id, componentId: 'merci', trigger: 'component', guildId: MAIN, channelId: CHANNEL, user: user(ALICE), respond: click.respond });
	assert.deepEqual(click.out.replies, [{ content: `Avec plaisir <@${ALICE}>`, embed: null, ephemeral: true, components: [] }]);
	assert.equal(customCommands.get(cmd.id).uses, 3);
});

test('access: channels, refused roles, Discord permission, ranks or roles; cooldown; scope', async () => {
	const { core, customCommands, owner } = await setup();
	const cmd = await customCommands.save(owner, {
		name: 'annonce-vip', description: 'x', scope: { mode: 'guilds', guildIds: [MAIN] },
		access: { roleIds: [VIP], channelIds: [CHANNEL], deniedMessage: 'Réservé aux VIP.' }, cooldown: { seconds: 60 },
		flow: [{ type: 'reply', content: 'ok' }],
	});
	const run = (u, channelId = CHANNEL, guildId = MAIN) => customCommands.execute({ commandId: cmd.id, trigger: 'slash', guildId, channelId, user: u, respond: recorder().respond });
	assert.equal((await run(user(BOB))).reason, 'Réservé aux VIP.');
	assert.equal((await run(user(BOB, [VIP]), '610000000000000099')).reason, 'Réservé aux VIP.');
	assert.equal((await run(user(BOB, [VIP]))).ok, true);
	assert.match((await run(user(BOB, [VIP]))).reason, /réessaie/, 'cooldown');
	core.network.activate(owner, OTHER);
	assert.equal((await run(user(ALICE, [VIP]), CHANNEL, OTHER)).denied, true, 'not on this server');
	assert.deepEqual(customCommands.guildCommands(OTHER), []);
	assert.equal(customCommands.guildCommands(MAIN).length, 1);
	assert.ok(customCommands.runs(cmd.id).some(r => r.detail?.startsWith('Refusé')));
});

test('keywords, sensitive blocks need their own permission, sanctions run with the user’s rights', async () => {
	const { core, customCommands, owner } = await setup();
	const kw = await customCommands.save(owner, { name: 'regles', trigger: { type: 'keyword', keyword: { mode: 'startsWith', patterns: ['!regles'] } }, flow: [{ type: 'react', emoji: '📜' }, { type: 'reply', content: 'Voir #règlement' }, { type: 'deleteTrigger' }] });
	assert.deepEqual(customCommands.matchKeywords(MAIN, CHANNEL, '!REGLES stp').map(c => c.id), [kw.id]);
	assert.deepEqual(customCommands.matchKeywords(MAIN, CHANNEL, 'les !regles'), []);
	const r = recorder();
	await customCommands.execute({ commandId: kw.id, trigger: 'keyword', guildId: MAIN, channelId: CHANNEL, user: user(BOB), respond: r.respond });
	assert.deepEqual([r.out.reactions, r.out.deleted], [['📜'], 1]);

	const editor = core.ranks.create(owner, { name: 'Créateur', level: 30, permissions: ['panel.access', 'customcommands.manage'] });
	await core.ranks.assignDirect(owner, ALICE, editor.id);
	const alice = await core.ranks.resolve(ALICE);
	const warnFlow = { name: 'avertir', description: 'x', options: [{ name: 'membre', type: 'user', required: true }], flow: [{ type: 'sanction', kind: 'warn', target: 'option:membre', reason: 'Via /avertir' }] };
	await assert.rejects(customCommands.save(alice, warnFlow), ForbiddenError);
	const warn = await customCommands.save(owner, warnFlow);
	// Bob has no sanctions.warn: the block fails, the flow reports it
	const result = await customCommands.execute({ commandId: warn.id, trigger: 'slash', guildId: MAIN, channelId: CHANNEL, user: user(BOB), options: { membre: { type: 'user', value: ALICE, userId: ALICE, display: `<@${ALICE}>` } }, respond: recorder().respond });
	assert.match(result.warnings.join(), /sanctions\.warn/);
});
