import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, ALICE, MAIN, OTHER } from '../helpers.js';
import { ForbiddenError, ValidationError } from '../../src/core/errors.js';
import { normalizeCard, renderCard } from '../../src/core/cards.js';

const MEMBER = { id: '300000000000000001', username: 'lea', globalName: 'Léa', avatarUrl: null, bot: false };
const WELCOME = '610000000000000001';
const ROLE_MEMBER = '800000000000000001';
const ROLE_NEW = '800000000000000002';

async function setup() {
	const ctx = await withNetwork();
	ctx.executor.channels.set(WELCOME, { guildId: MAIN, name: 'bienvenue' });
	ctx.executor.memberRoles.set(`${MAIN}:${MEMBER.id}`, [ROLE_NEW]);
	return ctx;
}

test('the configuration is validated and needs onboarding.manage', async () => {
	const { core, owner } = await setup();
	const alice = await core.ranks.resolve(ALICE);
	assert.throws(() => core.onboarding.save(alice, MAIN, {}), ForbiddenError);
	assert.throws(() => core.onboarding.save(owner, MAIN, { welcome: { enabled: true } }), /salon/);
	assert.throws(() => core.onboarding.save(owner, OTHER, {}), /réseau/);
	const saved = core.onboarding.save(owner, MAIN, { welcome: { enabled: true, channelId: WELCOME, payload: { content: 'Salut {user} ({memberCount})' } } });
	assert.equal(saved.welcome.payload.content, 'Salut {user} ({memberCount})');
	assert.equal(saved.welcome.card.design.layers.length, 3, 'a default card is ready');
});

test('welcome: message with the variables, card attached, DM, automatic roles', async () => {
	const { core, owner, executor } = await setup();
	core.onboarding.save(owner, MAIN, {
		welcome: {
			enabled: true, channelId: WELCOME,
			payload: { content: 'Bienvenue {user} !', embed: { enabled: true, description: 'Tu es le {memberCount}e, invité par {inviter}', thumbnailUrl: '{user.avatar}' } },
			card: { enabled: true },
			dm: { enabled: true, payload: { content: 'Salut {user.name}, bienvenue sur {server}' } },
		},
		autoroles: { humanRoleIds: [ROLE_MEMBER], botRoleIds: [] },
	});
	await core.onboarding.memberJoined(MAIN, MEMBER, { inviterId: ALICE });
	const sent = executor.messages[0];
	assert.equal(sent.channelId, WELCOME);
	assert.equal(sent.payload.content, `Bienvenue <@${MEMBER.id}> !`);
	assert.equal(sent.payload.embed.description, `Tu es le 100e, invité par <@${ALICE}>`);
	assert.equal(sent.payload.embed.imageUrl, 'attachment://welcome.png');
	assert.match(sent.payload.embed.thumbnailUrl, /^https:\/\//);
	assert.equal(sent.files[0].name, 'welcome.png');
	assert.ok(sent.files[0].buffer.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])), 'a PNG');
	assert.deepEqual(sent.mentionUserIds, [MEMBER.id]);
	assert.equal(executor.dmPayloads[0].payload.content, 'Salut Léa, bienvenue sur Serveur');
	assert.ok(executor.memberRoles.get(`${MAIN}:${MEMBER.id}`).includes(ROLE_MEMBER));
});

test('rules: roles wait for the acceptance, which gives and removes roles', async () => {
	const { core, owner, executor } = await setup();
	core.onboarding.save(owner, MAIN, {
		autoroles: { humanRoleIds: [ROLE_MEMBER] },
		rules: { enabled: true, channelId: WELCOME, acceptRoleIds: ['800000000000000003'], removeRoleIds: [ROLE_NEW] },
	});
	await core.onboarding.memberJoined(MAIN, MEMBER);
	assert.deepEqual(executor.memberRoles.get(`${MAIN}:${MEMBER.id}`), [ROLE_NEW], 'nothing given before accepting');

	const published = await core.onboarding.publishRules(owner, MAIN);
	assert.equal(published.rules.messageId, '680000000000000001');
	await core.onboarding.publishRules(owner, MAIN);
	assert.deepEqual(executor.calls.filter(c => c[0] === 'rules').map(c => c[2]), [null, '680000000000000001'], 'the message is updated in place');

	const result = await core.onboarding.acceptRules(MAIN, MEMBER.id);
	assert.equal(result.already, false);
	assert.deepEqual(executor.memberRoles.get(`${MAIN}:${MEMBER.id}`).sort(), ['800000000000000001', '800000000000000003']);
	assert.equal((await core.onboarding.acceptRules(MAIN, MEMBER.id)).already, true);
});

test('rules: accounts that are too recent are refused', async () => {
	const { core, owner } = await setup();
	core.onboarding.save(owner, MAIN, { rules: { enabled: true, channelId: WELCOME, acceptRoleIds: [ROLE_MEMBER], minAccountAgeDays: 30 } });
	// An ID generated now: the account is brand new
	const fresh = String((BigInt(Date.now() - 1420070400000) << 22n));
	await assert.rejects(core.onboarding.acceptRules(MAIN, fresh), ValidationError);
});

test('boost: message, bonus roles given then taken back', async () => {
	const { core, owner, executor } = await setup();
	core.onboarding.save(owner, MAIN, { boost: { enabled: true, channelId: WELCOME, bonusRoleIds: ['800000000000000009'], end: { enabled: true } } });
	await core.onboarding.boostStarted(MAIN, MEMBER);
	assert.match(executor.messages[0].payload.content, /Merci <@300000000000000001> pour le boost ! Le serveur a maintenant 3 boosts/);
	assert.ok(executor.memberRoles.get(`${MAIN}:${MEMBER.id}`).includes('800000000000000009'));
	await core.onboarding.boostEnded(MAIN, MEMBER);
	assert.ok(!executor.memberRoles.get(`${MAIN}:${MEMBER.id}`).includes('800000000000000009'));
	assert.equal(executor.messages.length, 2);
});

test('cards: layers validated, uploads by content, rendered with an uploaded background', async () => {
	const { core } = await setup();
	assert.throws(() => normalizeCard({ layers: [{ type: 'video' }] }), /type inconnu/);
	const design = normalizeCard({ width: 600, height: 200, background: { type: 'image', image: 'https://evil.example/x.png', overlay: 5 }, layers: [{ type: 'text', text: '{user.name}', font: 'Comic Sans' }] });
	assert.equal(design.background.overlay, 0.9);
	assert.equal(design.layers[0].font, 'Poppins Bold');

	// A 1x1 PNG saved as an upload, then used as the background
	const png = await renderCard({ width: 200, height: 100, background: { type: 'color', color: '#ff0000' }, layers: [] }, {}, { loadSource: async () => null });
	const upload = core.uploads.save(png);
	assert.match(upload.id, /^[a-f0-9]{32}\.png$/);
	assert.equal(core.uploads.save(png).id, upload.id, 'same content, same id');
	assert.throws(() => core.uploads.save(Buffer.from('<svg></svg>')), /Format non accepté/);
	assert.throws(() => core.uploads.file('../bot.db'), /introuvable/);
	const preview = await core.onboarding.previewCard(MAIN, { width: 400, height: 200, background: { type: 'image', image: `upload:${upload.id}` }, layers: [{ type: 'avatar', x: 200, y: 100, size: 80 }] });
	assert.ok(preview.length > 100);
});
