import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, ALICE, BOB, MAIN } from '../helpers.js';
import { ForbiddenError, ValidationError } from '../../src/core/errors.js';
import { normalizeBuilt } from '../../src/core/embedBuilder.js';

const COUNT = '610000000000000101';
const WORDS = '610000000000000102';
const MEDIA = '610000000000000103';
const NEWS = '610000000000000104';
const STICKY = '610000000000000105';
const CAROL = '300000000000000051';

async function setup() {
	const ctx = await withNetwork();
	for (const [id, name, announcement] of [[COUNT, 'compteur'], [WORDS, 'un-mot'], [MEDIA, 'photos'], [NEWS, 'annonces', true], [STICKY, 'general']]) {
		ctx.executor.channels.set(id, { guildId: MAIN, name, announcement: Boolean(announcement) });
	}
	let n = 0;
	const say = (channelId, authorId, content, extra = {}) => ctx.core.channelFeatures.onMessage({ guildId: MAIN, channelId, messageId: String(700000000000001000n + BigInt(++n)), authorId, bot: false, self: false, content, attachments: 0, mediaEmbeds: 0, staff: false, ...extra });
	return { ...ctx, say };
}

test('counting: the right number in turn, a mistake resets the count, a deleted number is announced', async () => {
	const { core, owner, executor, say } = await setup();
	await core.channelFeatures.set(owner, { guildId: MAIN, channelId: COUNT, kind: 'counting' });
	await say(COUNT, ALICE, '1');
	await say(COUNT, BOB, '2 on y va');
	await say(COUNT, BOB, '3');
	assert.equal(executor.reactions.at(-1)[2], '❌', 'twice in a row breaks the series');
	assert.match(executor.messages.at(-1).payload.content, /cassé la série à \*\*2\*\*/);
	await say(COUNT, ALICE, '1');
	await say(COUNT, BOB, 'blabla');
	assert.ok(executor.deleted.some(([c]) => c === COUNT), 'text without a number is removed');
	const state = core.channelFeatures.list(MAIN).find(f => f.kind === 'counting').state;
	assert.deepEqual([state.count, state.best, state.fails], [1, 2, 1]);
	await core.channelFeatures.onDelete(COUNT, state.lastMessageId);
	assert.match(executor.messages.at(-1).payload.content, /prochain est \*\*2\*\*/);
	core.channelFeatures.setCount(owner, COUNT, 50);
	await say(COUNT, CAROL, '51');
	assert.equal(executor.reactions.at(-1)[2], '✅');
});

test('one word each: the story is told word by word, a sentence ends with a dot', async () => {
	const { core, owner, executor, say } = await setup();
	await core.channelFeatures.set(owner, { guildId: MAIN, channelId: WORDS, kind: 'oneword', config: { minWords: 3 } });
	await say(WORDS, ALICE, 'Il');
	await say(WORDS, ALICE, 'était');
	assert.match(executor.temporary.at(-1).content, /quelqu’un d’autre/);
	await say(WORDS, BOB, 'deux mots');
	assert.match(executor.temporary.at(-1).content, /un seul mot/);
	await say(WORDS, BOB, 'était');
	await say(WORDS, ALICE, 'une');
	await say(WORDS, CAROL, 'fois.');
	const sentence = executor.messages.at(-1).payload.embed;
	assert.equal(sentence.description, '« Il était une fois. »');
	assert.match(sentence.footerText, /4 mots · 3 participants/);
	assert.equal(core.channelFeatures.list(MAIN)[0].state.words.length, 0);
});

test('media only, auto-publish, sticky message; one game per channel; permission', async () => {
	const { core, owner, executor, say } = await setup();
	await core.channelFeatures.set(owner, { guildId: MAIN, channelId: MEDIA, kind: 'mediaonly' });
	await say(MEDIA, ALICE, 'regardez !', { attachments: 1 });
	await say(MEDIA, ALICE, 'https://imgur.com/a/b');
	await say(MEDIA, ALICE, 'joli', { staff: true });
	assert.equal(executor.deleted.length, 0);
	await say(MEDIA, ALICE, 'trop bien');
	assert.equal(executor.deleted.length, 1);
	await assert.rejects(core.channelFeatures.set(owner, { guildId: MAIN, channelId: MEDIA, kind: 'counting' }), /déjà un autre jeu/);

	await assert.rejects(core.channelFeatures.set(owner, { guildId: MAIN, channelId: STICKY, kind: 'autopublish' }), /salon d’annonces/);
	await core.channelFeatures.set(owner, { guildId: MAIN, channelId: NEWS, kind: 'autopublish', config: { onlyBots: false } });
	await say(NEWS, ALICE, 'Nouvelle mise à jour');
	assert.equal(executor.crossposted.length, 1);

	await core.channelFeatures.set(owner, { guildId: MAIN, channelId: STICKY, kind: 'sticky', config: { payload: { content: 'Lisez les règles 👆', embed: { enabled: false } }, delaySeconds: 3 } });
	const first = core.channelFeatures.list(MAIN).find(f => f.kind === 'sticky').state.messageId;
	assert.ok(first, 'posted at once');
	await core.channelFeatures.remove(owner, STICKY, 'sticky');
	assert.ok(executor.deleted.some(([c, m]) => c === STICKY && m === first), 'removed with its message');
	await assert.rejects(core.channelFeatures.set({ id: ALICE, can: () => false }, { guildId: MAIN, channelId: COUNT, kind: 'counting' }), ForbiddenError);
});

test('verification: button or captcha, young accounts refused, slow newcomers kicked', async () => {
	let clock = Date.now();
	const ctx = await withNetwork();
	const { core, owner, executor } = ctx;
	const VERIFIED = '800000000000000101';
	const UNVERIFIED = '800000000000000102';
	assert.throws(() => core.verification.setConfig(owner, MAIN, { enabled: true }), ValidationError);
	core.verification.setConfig(owner, MAIN, { enabled: true, mode: 'captcha', channelId: '610000000000000200', verifiedRoleId: VERIFIED, unverifiedRoleId: UNVERIFIED, minAccountAgeDays: 7, kickAfterMinutes: 30 });
	await core.verification.publish(owner, MAIN);
	assert.equal(executor.verificationPanels[0].config.mode, 'captcha');

	await core.verification.memberJoined(MAIN, ALICE);
	assert.ok(executor.memberRoles.get(`${MAIN}:${ALICE}`).includes(UNVERIFIED));
	await assert.rejects(core.verification.start(MAIN, ALICE, { accountCreatedAt: Date.now() - 86_400_000 }), /au moins 7 jours/);
	const { code } = await core.verification.start(MAIN, ALICE, { accountCreatedAt: Date.now() - 90 * 86_400_000 });
	assert.match(code, /^[A-Z2-9]{5}$/);
	await assert.rejects(core.verification.answer(MAIN, ALICE, 'XXXXX'), /il te reste 2 essais/);
	await core.verification.answer(MAIN, ALICE, ` ${code.toLowerCase()} `);
	const roles = executor.memberRoles.get(`${MAIN}:${ALICE}`);
	assert.ok(roles.includes(VERIFIED) && !roles.includes(UNVERIFIED));
	assert.equal(core.verification.pending(MAIN), 0);

	// Not verified within 30 minutes: kicked
	executor.members.set(MAIN, new Set([BOB]));
	await core.verification.memberJoined(MAIN, BOB);
	clock += 0;
	core.db.prepare('UPDATE verification_pending SET joined_at = ? WHERE user_id = ?').run(clock - 31 * 60_000, BOB);
	await core.verification.tick();
	assert.ok(executor.calls.some(c => c[0] === 'kick' && c[2] === BOB));

	core.verification.setConfig(owner, MAIN, { enabled: true, mode: 'button', verifiedRoleId: VERIFIED });
	assert.deepEqual(await core.verification.start(MAIN, CAROL), { verified: true });
});

test('embed builder: several embeds and link buttons, posted then edited in place, moved to another channel', async () => {
	const { core, owner, executor } = await withNetwork();
	assert.throws(() => normalizeBuilt({ content: '', embeds: [{}] }), /vide/);
	assert.throws(() => normalizeBuilt({ content: 'x', buttons: [{ label: 'Site', url: 'pas un lien' }] }), /Lien de bouton invalide/);
	const saved = await core.embedBuilder.save(owner, { name: '', payload: { content: '', embeds: [{ title: 'Règlement', description: 'Respect', color: '#ff9628', fields: [] }, { description: 'Partie 2', fields: [] }], buttons: [{ label: 'Site', url: 'https://brotherslife.fr' }] } });
	assert.deepEqual([saved.name, saved.payload.embeds.length, saved.payload.buttons.length], ['Règlement', 2, 1]);
	const posted = await core.embedBuilder.post(owner, saved.id, { guildId: MAIN, channelId: '610000000000000300' });
	assert.equal(executor.builtMessages.at(-1).messageId, null);
	await core.embedBuilder.save(owner, { id: saved.id, name: 'Règles', payload: { ...posted.payload, content: 'Mis à jour' } });
	assert.deepEqual([executor.builtMessages.at(-1).messageId, executor.builtMessages.at(-1).payload.content], [posted.messageId, 'Mis à jour'], 'edited in place');
	await core.embedBuilder.post(owner, saved.id, { guildId: MAIN, channelId: '610000000000000301' });
	assert.ok(executor.deleted.some(([c, m]) => c === '610000000000000300' && m === posted.messageId), 'moved: the old message is deleted');
	await core.embedBuilder.remove(owner, saved.id);
	assert.equal(core.embedBuilder.list().length, 0);
});
