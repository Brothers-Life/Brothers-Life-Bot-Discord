import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectScam, extractHosts, extractInvites } from '../../src/core/automod/scam.js';
import { createAutomodEngine, normalizeConfig, DEFAULT_CONFIG } from '../../src/core/automod/engine.js';

test('scam: known domains and lookalikes', () => {
	assert.match(detectScam('get your gift https://discord-nitro.gift/abc'), /connu/);
	assert.match(detectScam('https://dlscord-login.com/xyz'), /faux lien/);
	assert.match(detectScam('go steamcomnmunity.com/tradeoffer'), /faux lien|connu/);
	assert.match(detectScam('https://disc0rd-app.com/login'), /faux lien/);
	assert.match(detectScam('https://steamcommunlty.com/id/x'), /faux lien/);
});

test('scam: legit links are never flagged', () => {
	for (const text of [
		'https://discord.com/channels/1/2',
		'rejoins discord.gg/brotherslife',
		'la doc https://discordjs.guide/ et https://discord.js.org',
		'mon profil https://steamcommunity.com/id/pedro',
		'https://store.steampowered.com/app/730',
		'free nitro ? non merci',
		'https://youtube.com/watch?v=abc',
	]) {
		assert.equal(detectScam(text), null, text);
	}
});

test('scam: bait sentences need a link', () => {
	assert.match(detectScam('Free Nitro for everyone! https://gift-drops.xyz'), /appât/);
	assert.match(detectScam('Crypto giveaway, claim here: bit-rewards.online/claim'), /appât/);
	assert.equal(detectScam('free nitro when?'), null);
});

test('scam: @everyone with a link, custom domains and patterns', () => {
	assert.match(detectScam('@everyone https://random-site.com', { hasEveryone: true }), /everyone/);
	assert.equal(detectScam('@everyone https://random-site.com', { hasEveryone: true, blockEveryoneLinks: false }), null);
	assert.match(detectScam('https://evil.example.com/x', { customDomains: ['example.com'] }), /connu/);
	assert.match(detectScam('vend compte https://shop.io', { customPatterns: ['vend compte'] }), /motif/);
});

test('hosts and invites extraction', () => {
	assert.deepEqual(extractHosts('a https://www.Example.com/x b test.xyz c'), ['example.com', 'test.xyz']);
	assert.deepEqual(extractInvites('viens discord.gg/abc et https://discord.com/invite/xyz'), ['abc', 'xyz']);
});

test('config normalization keeps known keys and bounds', () => {
	const config = normalizeConfig({ spam: { maxMessages: 3, action: 'ban', evil: true }, scam: { action: 'nope' }, enabled: 'yes' });
	assert.equal(config.spam.maxMessages, 3);
	assert.equal(config.spam.action, 'ban');
	assert.equal(config.spam.evil, undefined);
	assert.equal(config.scam.action, DEFAULT_CONFIG.scam.action);
	assert.equal(config.enabled, true);
});

function engineAt() {
	let clock = 1_000_000;
	const engine = createAutomodEngine({ now: () => clock });
	return { engine, tick: (ms) => { clock += ms; } };
}

const message = (over = {}) => ({ guildId: 'g', userId: 'u', content: 'hello', mentionCount: 0, attachmentCount: 0, hasEveryone: false, ...over });

test('engine: message burst', () => {
	const { engine, tick } = engineAt();
	const config = normalizeConfig();
	let result = null;
	for (let i = 0; i < 7 && !result; i++) {
		result = engine.evaluate(config, message({ content: `msg ${i}` }));
		tick(300);
	}
	assert.equal(result.rule, 'spam');
	assert.equal(result.action, 'timeout');
	assert.equal(result.timeoutMinutes, 10);
});

test('engine: slow messages are fine', () => {
	const { engine, tick } = engineAt();
	const config = normalizeConfig();
	for (let i = 0; i < 20; i++) {
		assert.equal(engine.evaluate(config, message({ content: `msg ${i}` })), null);
		tick(2000);
	}
});

test('engine: duplicates, mentions and uploads', () => {
	const config = normalizeConfig();
	{
		const { engine, tick } = engineAt();
		let result = null;
		for (let i = 0; i < 6 && !result; i++) {
			result = engine.evaluate(config, message({ content: 'ACHETEZ' }));
			tick(4000);
		}
		assert.equal(result.rule, 'duplicates');
	}
	{
		const { engine } = engineAt();
		assert.equal(engine.evaluate(config, message({ mentionCount: 7 })).rule, 'mentions');
		assert.equal(engine.evaluate(config, message({ userId: 'x', attachmentCount: 5 })).rule, 'uploads');
	}
	{
		const { engine, tick } = engineAt();
		let result = null;
		for (let i = 0; i < 4 && !result; i++) {
			result = engine.evaluate(config, message({ content: `pic ${i}`, attachmentCount: 3 }));
			tick(5000);
		}
		assert.equal(result.rule, 'uploads');
		assert.match(result.reason, /9 fichiers en 30 s/);
	}
});

test('engine: edits only check content rules; disabled config does nothing', () => {
	const { engine } = engineAt();
	const config = normalizeConfig();
	assert.equal(engine.evaluate(config, message({ content: 'https://dlscord.gift/x' }), { edited: true }).rule, 'scam');
	assert.equal(engine.evaluate(config, message({ mentionCount: 50 }), { edited: true }), null);
	assert.equal(engine.evaluate(normalizeConfig({ enabled: false }), message({ content: 'https://dlscord.gift/x' })), null);
});

test('engine: invites when enabled, with allowed codes', () => {
	const { engine } = engineAt();
	const config = normalizeConfig({ invites: { enabled: true, allowedCodes: ['brotherslife'] } });
	assert.equal(engine.evaluate(config, message({ content: 'discord.gg/brotherslife' })), null);
	assert.equal(engine.evaluate(config, message({ content: 'discord.gg/autre' })).rule, 'invite');
});
