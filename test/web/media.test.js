import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerMediaRoutes } from '../../src/web/routes/media.js';
import { registerStatusRoutes } from '../../src/web/routes/status.js';

const noop = () => undefined;
const silent = { warn: noop };

function setup({ media = true, status = 200 } = {}) {
	const calls = [];
	const fetchImpl = async (input, options = {}) => {
		const url = new URL(input);
		calls.push({ url, options });
		if (url.pathname.endsWith('/api/v1/folders')) {
			return Response.json({
				status: 'ok',
				data: {
					folder: url.searchParams.get('parent') ? { id: 8, name: 'items', path: 'fichiers/ox_inventory/items', parent: 'fichiers/ox_inventory', files: 1, bytes: 1200 } : null,
					children: [{ id: 7, name: 'items', path: 'fichiers/ox_inventory/items', parent: 'fichiers/ox_inventory', files: 1, bytes: 1200 }],
				},
			});
		}
		return Response.json({
			status: 'ok',
			data: {
				items: [
					{ id: 'abc', name: 'water.png', folder: 'ox_inventory/items', kind: 'image', mime: 'image/png', size: 1200, url: 'https://media.example/n/ox_inventory/items/water.png', createdAt: '2026-11-15T12:00:00.000Z', named: true },
					{ id: 'bad', name: 'bad.png', folder: 'ox_inventory/items', kind: 'image', mime: 'image/png', size: 100, url: 'https://attacker.example/image.png', named: false },
				],
				nextCursor: 'water.png',
			},
		}, { status });
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
		itemsFolder: 'ox_inventory/items',
		vehiclesFolder: 'rup_vehiclespawner/vehicules',
	});
});

test('image catalogue proxies paginated image results and rejects URLs on another origin', async () => {
	const { routes, calls } = setup();
	const route = routes.get('/api/media/images');
	assert.equal(route.options.config.permission, 'fivemdata.view');
	const result = await route.handler({ query: { q: 'water', cursor: 'next', folder: 'fichiers/ox_inventory/items' } });
	assert.deepEqual(result, {
		items: [{
			id: 'abc',
			name: 'water.png',
			folder: 'ox_inventory/items',
			mime: 'image/png',
			size: 1200,
			url: 'https://media.example/n/ox_inventory/items/water.png',
			createdAt: '2026-11-15T12:00:00.000Z',
			named: true,
		}],
		nextCursor: 'water.png',
	});
	assert.equal(calls[0].url.searchParams.get('kind'), 'image');
	assert.equal(calls[0].url.searchParams.get('recursive'), '0');
	assert.equal(calls[0].url.searchParams.get('folder'), 'fichiers/ox_inventory/items');
	assert.equal(calls[0].url.searchParams.get('q'), 'water');
	assert.equal(calls[0].url.searchParams.get('cursor'), 'next');
	assert.equal(calls[0].options.headers.Authorization, 'secret-read-key');
	assert.equal(calls[0].options.redirect, 'error');
});

test('folder explorer lists children and the current folder path through the read-only proxy', async () => {
	const { routes, calls } = setup();
	const route = routes.get('/api/media/folders');
	assert.equal(route.options.config.permission, 'fivemdata.view');
	assert.deepEqual(await route.handler({ query: { parent: 'fichiers/ox_inventory' } }), {
		folder: { id: 8, name: 'items', path: 'fichiers/ox_inventory/items', parent: 'fichiers/ox_inventory', files: 1, bytes: 1200 },
		children: [{ id: 7, name: 'items', path: 'fichiers/ox_inventory/items', parent: 'fichiers/ox_inventory', files: 1, bytes: 1200 }],
	});
	assert.equal(calls[0].url.pathname, '/api/v1/folders');
	assert.equal(calls[0].url.searchParams.get('parent'), 'fichiers/ox_inventory');
	assert.equal(calls[0].options.headers.Authorization, 'secret-read-key');
});

test('media image endpoint reports missing service configuration', async () => {
	const { routes } = setup({ media: false });
	await assert.rejects(routes.get('/api/media/images').handler({ query: {} }), { status: 503, code: 'MEDIA_NOT_CONFIGURED' });
});

test('media image endpoint explains upstream authentication failures without exposing the key', async () => {
	const { routes } = setup({ status: 401 });
	await assert.rejects(
		routes.get('/api/media/images').handler({ query: {} }),
		{ status: 502, code: 'MEDIA_UPSTREAM_ERROR', message: /MEDIA_READ_KEY est refusée/ },
	);
});

function statusSetup({ media = true, status = 200 } = {}) {
	const calls = [];
	const routes = new Map();
	const app = { get: (path, options, handler) => routes.set(path, { options, handler }) };
	const fetchImpl = async (input, options) => {
		calls.push({ url: new URL(input), options });
		return Response.json({ status: 'ok', data: { items: [] } }, { status });
	};
	const core = {
		config: { MEDIA_BASE_URL: media ? 'https://media.example/base' : '', MEDIA_READ_KEY: media ? 'secret-read-key' : '' },
		db: { raw: async () => ({ rows: [] }) },
		executor: { status: () => ({ ready: false }) },
		cache: { status: async () => ({ configured: false }) },
		settings: { get: async (_key, fallback) => fallback },
		fivemMirror: { status: async () => ({ lastSync: null, tables: [] }) },
	};
	const runtime = { info: () => ({ version: 'test' }) };
	registerStatusRoutes(app, { core, runtime, fetchImpl, logger: silent });
	return { routes, calls };
}

test('service status checks the media API with the read key and reports latency', async () => {
	const { routes, calls } = statusSetup();
	const result = await routes.get('/api/status').handler();
	const media = result.services.find((service) => service.key === 'media');
	assert.equal(media.state, 'ok');
	assert.equal(media.metrics.target, 'https://media.example');
	assert.equal(typeof media.metrics.latency, 'number');
	assert.equal(calls[0].url.pathname, '/base/api/v1/files');
	assert.equal(calls[0].url.searchParams.get('kind'), 'image');
	assert.equal(calls[0].url.searchParams.get('limit'), '1');
	assert.equal(calls[0].options.headers.Authorization, 'secret-read-key');
	assert.equal(JSON.stringify(result).includes('secret-read-key'), false);
});

test('service status reports media key permission errors clearly', async () => {
	const { routes } = statusSetup({ status: 403 });
	const result = await routes.get('/api/status').handler();
	const media = result.services.find((service) => service.key === 'media');
	assert.equal(media.state, 'down');
	assert.match(media.detail, /droit files:read/);
});
