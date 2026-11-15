import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerMediaRoutes } from '../../src/web/routes/media.js';

const noop = () => undefined;
const silent = { warn: noop };

function setup({ media = true } = {}) {
	const calls = [];
	const fetchImpl = async (input, options = {}) => {
		const url = new URL(input);
		calls.push({ url, options });
		return Response.json({
			status: 'ok',
			data: {
				items: [
					{ id: 'abc', name: 'water.png', folder: 'inventaire/items', kind: 'image', mime: 'image/png', size: 1200, url: 'https://media.example/n/inventaire/items/water.png', createdAt: '2026-11-15T12:00:00.000Z', named: true },
					{ id: 'bad', name: 'bad.png', folder: 'inventaire/items', kind: 'image', mime: 'image/png', size: 100, url: 'https://attacker.example/image.png', named: false },
				],
				nextCursor: 'water.png',
			},
		});
	};
	const routes = new Map();
	const app = { get: (path, options, handler) => routes.set(path, { options, handler }) };
	registerMediaRoutes(app, {
		config: {
			MEDIA_BASE_URL: media ? 'https://media.example' : '',
			MEDIA_READ_KEY: media ? 'secret-read-key' : '',
		},
		fetchImpl,
		logger: silent,
	});
	return { routes, calls };
}

test('media config is available to the panel without exposing the read key', async () => {
	const { routes } = setup();
	const route = routes.get('/api/media/config');
	assert.equal(route.options.config.permission, null);
	assert.deepEqual(await route.handler(), {
		enabled: true,
		baseUrl: 'https://media.example',
		itemsFolder: 'inventaire/items',
		vehiclesFolder: 'inventaire/vehicles',
	});
});

test('image catalogue proxies paginated image results and rejects URLs on another origin', async () => {
	const { routes, calls } = setup();
	const route = routes.get('/api/media/images');
	assert.equal(route.options.config.permission, 'fivemdata.view');
	const result = await route.handler({ query: { q: 'water', cursor: 'next' } });
	assert.deepEqual(result, {
		items: [{
			id: 'abc',
			name: 'water.png',
			folder: 'inventaire/items',
			mime: 'image/png',
			size: 1200,
			url: 'https://media.example/n/inventaire/items/water.png',
			createdAt: '2026-11-15T12:00:00.000Z',
			named: true,
		}],
		nextCursor: 'water.png',
	});
	assert.equal(calls[0].url.searchParams.get('kind'), 'image');
	assert.equal(calls[0].url.searchParams.get('recursive'), '1');
	assert.equal(calls[0].url.searchParams.get('q'), 'water');
	assert.equal(calls[0].url.searchParams.get('cursor'), 'next');
	assert.equal(calls[0].options.headers.Authorization, 'secret-read-key');
	assert.equal(calls[0].options.redirect, 'error');
});

test('media image endpoint reports missing service configuration', async () => {
	const { routes } = setup({ media: false });
	await assert.rejects(routes.get('/api/media/images').handler({ query: {} }), { status: 503, code: 'MEDIA_NOT_CONFIGURED' });
});
