import { AppError } from '../../core/errors.js';

const FILES_PAGE_SIZE = 60;

export function registerMediaRoutes(app, { config, fetchImpl = fetch, logger = console }) {
	const baseUrl = config.MEDIA_BASE_URL;
	const readKey = config.MEDIA_READ_KEY;

	app.get('/api/media/config', { config: { permission: null } }, async () => ({
		enabled: Boolean(baseUrl && readKey),
		baseUrl: baseUrl || null,
		itemsFolder: 'fichiers/ox_inventory/items',
		vehiclesFolder: 'rup_vehiclespawner/vehicules',
	}));

	app.get('/api/media/images', {
		config: { permission: 'fivemdata.view' },
		schema: {
			querystring: {
				type: 'object',
				properties: {
					q: { type: 'string', maxLength: 100 },
					cursor: { type: 'string', maxLength: 500 },
					folder: { type: 'string', maxLength: 400 },
				},
				additionalProperties: false,
			},
		},
	}, async (request) => {
		if (!baseUrl || !readKey) throw new AppError('MEDIA_NOT_CONFIGURED', 'Le service média n’est pas configuré.', 503);

		const endpoint = new URL(`${baseUrl}/api/v1/files`);
		endpoint.searchParams.set('kind', 'image');
		endpoint.searchParams.set('recursive', '0');
		endpoint.searchParams.set('limit', String(FILES_PAGE_SIZE));
		if (request.query.folder) endpoint.searchParams.set('folder', request.query.folder);
		if (request.query.q) endpoint.searchParams.set('q', request.query.q);
		if (request.query.cursor) endpoint.searchParams.set('cursor', request.query.cursor);

		let response;
		try {
			response = await fetchImpl(endpoint, {
				headers: { Authorization: readKey },
				redirect: 'error',
				signal: AbortSignal.timeout(10_000),
			});
		}
		catch (error) {
			logger.warn('FiveM media service request failed:', error.message);
			throw new AppError('MEDIA_UNAVAILABLE', 'Le service média est momentanément inaccessible.', 502);
		}

		if (!response.ok) {
			logger.warn(`FiveM media service responded with HTTP ${response.status}.`);
			const message = {
				401: 'La clé MEDIA_READ_KEY est refusée par le service média.',
				403: 'La clé média doit avoir le droit files:read et une racine compatible avec le dossier des images.',
				404: 'L’adresse MEDIA_BASE_URL ne pointe pas vers le service média attendu.',
				429: 'Le service média limite les requêtes. Réessaie dans un instant.',
			}[response.status] ?? `Le service média a répondu avec l’erreur HTTP ${response.status}.`;
			throw new AppError('MEDIA_UPSTREAM_ERROR', message, 502);
		}

		let payload;
		try {
			payload = await response.json();
		}
		catch {
			throw new AppError('MEDIA_BAD_RESPONSE', 'Le service média a renvoyé une réponse invalide.', 502);
		}
		const page = payload?.data;
		if (payload?.status === 'error' || !Array.isArray(page?.items)) {
			logger.warn(`FiveM media service returned an invalid file listing${typeof payload?.code === 'string' ? ` (${payload.code})` : ''}.`);
			throw new AppError('MEDIA_BAD_RESPONSE', 'Impossible de charger les images. Vérifie l’adresse du service et les droits files:read de la clé.', 502);
		}

		const expectedOrigin = new URL(baseUrl).origin;
		const items = page.items.flatMap(file => {
			if (file?.kind !== 'image' || typeof file.url !== 'string') return [];
			try {
				const url = new URL(file.url);
				if (url.origin !== expectedOrigin || !['http:', 'https:'].includes(url.protocol)) return [];
			}
			catch {
				return [];
			}
			return [{
				id: file.id,
				name: file.name,
				folder: file.folder,
				mime: file.mime,
				size: file.size,
				url: file.url,
				createdAt: file.createdAt,
				named: Boolean(file.named),
			}];
		});

		return { items, nextCursor: typeof page.nextCursor === 'string' ? page.nextCursor : null };
	});

	app.get('/api/media/folders', {
		config: { permission: 'fivemdata.view' },
		schema: {
			querystring: {
				type: 'object',
				properties: { parent: { type: 'string', maxLength: 400 } },
				additionalProperties: false,
			},
		},
	}, async (request) => {
		if (!baseUrl || !readKey) throw new AppError('MEDIA_NOT_CONFIGURED', 'Le service média n’est pas configuré.', 503);

		const endpoint = new URL(`${baseUrl}/api/v1/folders`);
		if (request.query.parent) endpoint.searchParams.set('parent', request.query.parent);
		let response;
		try {
			response = await fetchImpl(endpoint, {
				headers: { Authorization: readKey },
				redirect: 'error',
				signal: AbortSignal.timeout(10_000),
			});
		}
		catch (error) {
			logger.warn('FiveM media folders request failed:', error.message);
			throw new AppError('MEDIA_UNAVAILABLE', 'Le service média est momentanément inaccessible.', 502);
		}
		if (!response.ok) {
			logger.warn(`FiveM media folders request responded with HTTP ${response.status}.`);
			throw new AppError('MEDIA_UPSTREAM_ERROR', 'Impossible de charger les dossiers. Vérifie la clé files:read et sa racine.', 502);
		}

		let payload;
		try {
			payload = await response.json();
		}
		catch {
			throw new AppError('MEDIA_BAD_RESPONSE', 'Le service média a renvoyé une réponse invalide.', 502);
		}
		if (payload?.status === 'error' || !Array.isArray(payload?.data?.children)) {
			logger.warn('FiveM media service returned an invalid folder listing.');
			throw new AppError('MEDIA_BAD_RESPONSE', 'Le service média a renvoyé une liste de dossiers invalide.', 502);
		}

		const folder = payload.data.folder;
		return {
			folder: folder && typeof folder.path === 'string'
				? { id: folder.id, name: folder.name, path: folder.path, parent: folder.parent, files: folder.files, bytes: folder.bytes }
				: null,
			children: payload.data.children.flatMap(child => (
				typeof child?.id === 'number' && typeof child.name === 'string' && typeof child.path === 'string'
					? [{ id: child.id, name: child.name, path: child.path, parent: child.parent, files: child.files, bytes: child.bytes }]
					: []
			)),
		};
	});
}
