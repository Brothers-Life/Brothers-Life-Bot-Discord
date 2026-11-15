import { AppError } from '../../core/errors.js';

const FILES_PAGE_SIZE = 60;

export function registerMediaRoutes(app, { config, fetchImpl = fetch, logger = console }) {
	const baseUrl = config.MEDIA_BASE_URL;
	const readKey = config.MEDIA_READ_KEY;

	app.get('/api/media/config', { config: { permission: null } }, async () => ({
		enabled: Boolean(baseUrl && readKey),
		baseUrl: baseUrl || null,
		itemsFolder: 'inventaire/items',
		vehiclesFolder: 'inventaire/vehicles',
	}));

	app.get('/api/media/images', {
		config: { permission: 'fivemdata.view' },
		schema: {
			querystring: {
				type: 'object',
				properties: {
					q: { type: 'string', maxLength: 100 },
					cursor: { type: 'string', maxLength: 500 },
				},
				additionalProperties: false,
			},
		},
	}, async (request) => {
		if (!baseUrl || !readKey) throw new AppError('MEDIA_NOT_CONFIGURED', 'Le service média n’est pas configuré.', 503);

		const endpoint = new URL(`${baseUrl}/api/v1/files`);
		endpoint.searchParams.set('kind', 'image');
		endpoint.searchParams.set('recursive', '1');
		endpoint.searchParams.set('limit', String(FILES_PAGE_SIZE));
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

		let payload;
		try {
			payload = await response.json();
		}
		catch {
			throw new AppError('MEDIA_BAD_RESPONSE', 'Le service média a renvoyé une réponse invalide.', 502);
		}
		const page = payload?.data;
		if (!response.ok || payload?.status === 'error' || !Array.isArray(page?.items)) {
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
}
