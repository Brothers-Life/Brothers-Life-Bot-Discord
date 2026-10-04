import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withNetwork, ALICE, BOB, MAIN } from '../helpers.js';
import { createPublicPage, normalizePublicPage, CACHE_MS } from '../../src/core/publicPage.js';
import { parseRichText } from '../../src/core/richText.js';
import { createWebServer } from '../../src/web/server.js';

const STAFF_ROLE = '700000000000000011';
const CHANNEL = '610000000000000001';
const HOUR = 3_600_000;
const noop = () => undefined;

function fakeFivem() {
	return {
		list: () => [{
			id: 1, name: 'BRL RP', address: '51.75.12.34:30120', joinCode: 'abc123', messages: [],
			status: { online: true, players: 2, max: 64, hostname: 'x', list: [{ id: 7, name: 'Léa', ping: 30 }, { id: 3, name: 'Tom', ping: 40 }], checkedAt: 1, onlineSince: 1000, peak: 5, error: null },
		}],
	};
}

async function setup({ maintenance = () => null } = {}) {
	let clock = Date.UTC(2026, 9, 10, 18, 0);
	const ctx = await withNetwork();
	const { core, executor, owner } = ctx;
	const publicPage = createPublicPage({
		settings: core.settings, audit: core.audit, network: core.network, ranks: core.ranks, executor, fivem: fakeFivem(),
		rpEvents: core.rpEvents, recruitment: core.recruitment, maintenance, logger: { warn: noop }, now: () => clock,
	});
	// A staff rank linked to a role of the main server, held by Alice; Bob has it directly
	const rank = core.ranks.create(owner, { name: 'Modérateur', level: 10, color: '#ff9628' });
	core.ranks.setRoleLinks(owner, rank.id, [STAFF_ROLE]);
	executor.memberRoles.set(`${MAIN}:${ALICE}`, [STAFF_ROLE]);
	await core.ranks.assignDirect(owner, BOB, rank.id);
	return { ...ctx, publicPage, rank, advance: (ms) => { clock += ms; }, at: () => clock };
}

test('disabled by default: no view at all', async () => {
	const { publicPage } = await setup();
	assert.equal(publicPage.enabled(), false);
	assert.equal(await publicPage.view(), null);
});

test('sections follow their toggles; status hides the address and player names unless asked', async () => {
	const { publicPage, owner, rank } = await setup();
	publicPage.save(owner, { enabled: true, staff: { enabled: true, rankIds: [rank.id] }, rules: { enabled: true, text: '# Règlement\nPas de **freekill**.' } });
	const view = await publicPage.view();
	assert.equal(view.status[0].name, 'BRL RP');
	assert.equal(view.status[0].players, 2);
	assert.equal(view.status[0].joinUrl, 'https://cfx.re/join/abc123');
	assert.equal(view.status[0].playerNames, undefined);
	assert.ok(!JSON.stringify(view).includes('51.75.12.34'), 'no server address');
	assert.equal(view.staff[0].name, 'Modérateur');
	assert.equal(view.staff[0].members.length, 2);
	assert.equal(view.rules[0].type, 'h');
	assert.equal(view.discord.guilds.length, 1);
	assert.equal(view.maintenance, null, 'no fivemEvents service: block absent');

	publicPage.save(owner, { enabled: true, status: { enabled: true, showPlayerNames: true }, discord: { enabled: false }, events: { enabled: false }, links: { enabled: false } });
	const next = await publicPage.view();
	assert.deepEqual(next.status[0].playerNames, ['Léa', 'Tom']);
	assert.equal(next.discord, undefined);
	assert.equal(next.events, undefined);
	assert.equal(next.staff, undefined, 'staff off by default');
	assert.equal(next.rules, undefined);
});

test('nothing sensitive: no Discord IDs, no player IDs, no RSVPs', async () => {
	const { publicPage, owner, rank, core, executor, at } = await setup();
	executor.channels.set(CHANNEL, { guildId: MAIN, name: 'events' });
	await core.rpEvents.save(owner, { title: 'Course', description: 'Départ au port', startsAt: at() + 2 * HOUR, endsAt: at() + 3 * HOUR, image: 'https://cdn.example.com/course.png', targets: [{ guildId: MAIN, channelId: CHANNEL }] });
	await core.rpEvents.rsvp(ALICE, (core.rpEvents.upcoming()[0]).id, 'going');
	core.recruitment.savePosition(owner, MAIN, { name: 'Modérateur', config: { open: true } });
	await core.sanctions.create(owner, { type: 'warn', userId: BOB, reason: 'Secret' });
	publicPage.save(owner, { enabled: true, staff: { enabled: true, rankIds: [rank.id] }, recruitment: { enabled: true }, status: { enabled: true, showPlayerNames: true } });
	const view = await publicPage.view();
	const json = JSON.stringify(view);
	for (const id of [ALICE, BOB, MAIN, STAFF_ROLE]) assert.ok(!json.includes(id), `no id ${id}`);
	assert.ok(!json.includes('Secret'), 'no sanction');
	assert.ok(!json.includes('ping'), 'no player ping or id');
	assert.equal(view.events[0].title, 'Course');
	assert.equal(view.events[0].going, 1);
	assert.equal(view.events[0].image, 'https://cdn.example.com/course.png');
	assert.equal(view.recruitment[0].name, 'Modérateur');
});

test('maintenance block from fivemEvents when present, cached 30 s, refreshed on save', async () => {
	let state = { maintenance: { active: true, reason: 'Mise à jour', since: 5 }, nextRestart: null };
	const { publicPage, owner, advance } = await setup({ maintenance: () => state });
	publicPage.save(owner, { enabled: true });
	assert.equal((await publicPage.view()).maintenance.maintenance.reason, 'Mise à jour');
	state = { maintenance: { active: false }, nextRestart: { at: Date.UTC(2030, 0, 1) } };
	assert.equal((await publicPage.view()).maintenance.maintenance.active, true, 'cached');
	advance(CACHE_MS + 1);
	const view = await publicPage.view();
	assert.equal(view.maintenance.maintenance.active, false);
	assert.equal(view.maintenance.maintenance.reason, null);
	assert.equal(view.maintenance.nextRestart.at, Date.UTC(2030, 0, 1));
});

test('settings: links must be http(s), only public.manage can save', async () => {
	const { publicPage, owner, core } = await setup();
	assert.throws(() => publicPage.save(owner, { links: { shop: 'javascript:alert(1)' } }), /Boutique/);
	const saved = publicPage.save(owner, { links: { enabled: true, shop: 'https://brl.tebex.io', items: [{ label: 'TikTok', url: 'https://tiktok.com/@brl' }, { label: '', url: 'https://x' }] } });
	assert.equal(saved.links.items.length, 1);
	assert.equal(normalizePublicPage({ links: { shop: 'ftp://x' } }).links.shop, '', 'stored junk is dropped on read');
	const alice = await core.ranks.resolve(ALICE);
	assert.throws(() => publicPage.save(alice, { enabled: true }), { code: 'FORBIDDEN' });
});

test('rules: HTML never goes through, links only http(s)', () => {
	const blocks = parseRichText('## Titre <script>\n- **gras** et [site](https://brl.fr)\n- [piège](javascript:void)\n1. un\n\nTexte <img src=x onerror=1>\n---');
	assert.deepEqual(blocks.map(b => b.type), ['h', 'ul', 'ol', 'p', 'hr']);
	assert.equal(blocks[0].level, 2);
	assert.deepEqual(blocks[1].items[0], [{ t: 'b', v: 'gras' }, { t: 'text', v: ' et ' }, { t: 'link', v: 'site', href: 'https://brl.fr' }]);
	assert.deepEqual(blocks[1].items[1], [{ t: 'text', v: 'piège' }]);
	// Raw text stays text: React escapes it when rendering
	assert.equal(blocks[3].lines[0][0].v, 'Texte <img src=x onerror=1>');
});

test('routes: /api/public-page and /public answer 404 while the page is off', async () => {
	const { core, owner } = await withNetwork();
	const runtime = { info: () => ({ version: 'v1.0.0', supervised: false }) };
	const web = await createWebServer({
		config: core.config, core, runtime, consoleLog: { lines: () => [], subscribe: () => noop }, versions: {},
		logger: { info: noop, warn: noop, error: noop }, staticDir: '/nonexistent', tls: null,
	});
	const { app } = web;
	assert.equal((await app.inject({ method: 'GET', url: '/api/public-page' })).statusCode, 404);
	assert.equal((await app.inject({ method: 'GET', url: '/public' })).statusCode, 404);
	assert.equal((await app.inject({ method: 'GET', url: '/api/public-page/config' })).statusCode, 401, 'settings need a session');

	core.publicPage.save(owner, { enabled: true });
	const res = await app.inject({ method: 'GET', url: '/api/public-page' });
	assert.equal(res.statusCode, 200);
	assert.equal(res.json().title, 'Brothers Life');
	assert.equal(res.headers['cache-control'], 'no-store');
	assert.equal((await app.inject({ method: 'GET', url: '/public' })).statusCode, 200);
	await app.close();
});
