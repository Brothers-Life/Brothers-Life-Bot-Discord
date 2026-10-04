// Documentation of the public API, built from the routes declared to the guard:
// a JSON catalogue for the panel, an OpenAPI 3 document and a Bruno collection.

// First segment of the URL → folder of the documentation
const GROUPS = {
	me: 'Identité et panel', overview: 'Identité et panel', variables: 'Identité et panel', emojis: 'Identité et panel', users: 'Identité et panel', uploads: 'Identité et panel', commands: 'Identité et panel',
	network: 'Réseau', ranks: 'Rangs', members: 'Rangs', permissions: 'Permissions synchronisées', 'staff-roles': 'Staff', 'staff-activity': 'Activité staff',
	logs: 'Logs', audit: 'Journal', sessions: 'Sessions', system: 'Système', versions: 'Système',
	sanctions: 'Sanctions', 'sanction-templates': 'Sanctions', restrictions: 'Sanctions', 'temp-roles': 'Sanctions', appeals: 'Appels de sanction',
	automod: 'Automod', antiraid: 'Anti-raid', events: 'Événements Discord', people: 'Membres du réseau',
	tickets: 'Tickets', announcements: 'Annonces', embeds: 'Embeds', messages: 'Messages', dms: 'Messages privés',
	onboarding: 'Accueil', verification: 'Vérification', 'channel-features': 'Salons automatiques', 'channel-schedules': 'Horaires de salons', archives: 'Archives',
	polls: 'Sondages', giveaways: 'Giveaways', feedback: 'Suggestions et bugs', recruitment: 'Candidatures', absences: 'Absences',
	'rp-events': 'Événements RP', meetings: 'Réunions staff', 'meeting-actions': 'Réunions staff', voice: 'Salons vocaux perso', stats: 'Statistiques',
	'custom-commands': 'Commandes perso', backups: 'Sauvegardes', templates: 'Modèles de serveur', streams: 'Streams', music: 'Musique', changelog: 'Changelog',
	fivem: 'FiveM', 'fivem-data': 'Données FiveM', tebex: 'Boutique',
};

const VERBS = { GET: 'Consulter', POST: 'Créer / agir', PUT: 'Remplacer', PATCH: 'Modifier', DELETE: 'Supprimer' };

export function groupOf(url) {
	const segment = url.split('/')[2] ?? '';
	return GROUPS[segment] ?? segment.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase());
}

// Routes an API key can call, in a stable order
export function documentedRoutes(routes) {
	return routes
		.filter(r => r.apiKey)
		.sort((a, b) => groupOf(a.url).localeCompare(groupOf(b.url), 'fr') || a.url.localeCompare(b.url) || a.method.localeCompare(b.method));
}

// A plausible value for a JSON schema, to prefill the request bodies
export function exampleOf(schema, name = '') {
	if (!schema || typeof schema !== 'object') return null;
	if (schema.examples?.length) return schema.examples[0];
	if (schema.default !== undefined) return schema.default;
	if (schema.const !== undefined) return schema.const;
	if (schema.enum?.length) return schema.enum[0];
	const alternatives = schema.anyOf ?? schema.oneOf;
	// Optional values (nullable) are left empty: the docs list them
	if (alternatives?.length) return alternatives.some(s => s.type === 'null') ? null : exampleOf(alternatives[0], name);
	if (Array.isArray(schema.type) && schema.type.includes('null')) return null;
	const type = Array.isArray(schema.type) ? schema.type.find(t => t !== 'null') : schema.type;
	switch (type) {
	case 'object': {
		if (!schema.properties) return {};
		const required = new Set(schema.required ?? []);
		const keys = Object.keys(schema.properties);
		// Every field when there are few, otherwise the required ones (the docs list the others)
		const shown = keys.length <= 8 ? keys : keys.filter(k => required.has(k));
		return Object.fromEntries(shown.map(k => [k, exampleOf(schema.properties[k], k)]));
	}
	case 'array': return schema.items ? [exampleOf(schema.items, name)].filter(v => v !== null) : [];
	case 'integer': case 'number': return schema.minimum ?? 1;
	case 'boolean': return name === 'confirm';
	case 'string': {
		if (schema.pattern === '^\\d{17,20}$') return '000000000000000000';
		if (schema.format === 'date-time') return new Date(0).toISOString();
		if (schema.pattern || schema.format) return '';
		return name ? `${name}` : '';
	}
	default: return null;
	}
}

const pathParams = url => [...url.matchAll(/:(\w+)/g)].map(m => m[1]);

function describeFields(schema) {
	if (!schema?.properties) return [];
	const required = new Set(schema.required ?? []);
	return Object.entries(schema.properties).map(([name, s]) => {
		const type = s.enum ? s.enum.map(v => JSON.stringify(v)).join(' | ') : [s.type ?? (s.anyOf ? s.anyOf.map(a => a.type).join(' | ') : 'any')].flat().join(' | ');
		return { name, type, required: required.has(name) };
	});
}

// Short text shown for each route (panel, OpenAPI, Bruno docs)
export function describeRoute(route) {
	const lines = [`${VERBS[route.method] ?? route.method} — \`${route.method} ${route.url}\``, ''];
	lines.push(route.permission ? `Permission requise : \`${route.permission}\`` : 'Permission requise : aucune (clé valide)');
	if (route.confirm) lines.push('', 'Action sensible : le corps doit contenir `"confirm": true`.');
	const query = describeFields(route.schema?.querystring);
	if (query.length) lines.push('', 'Paramètres de requête :', ...query.map(f => `- \`${f.name}\` (${f.type})${f.required ? ' — obligatoire' : ''}`));
	const body = describeFields(route.schema?.body);
	if (body.length) lines.push('', 'Corps JSON :', ...body.map(f => `- \`${f.name}\` (${f.type})${f.required ? ' — obligatoire' : ''}`));
	return lines.join('\n');
}

// Catalogue for the API page of the panel
export function apiCatalogue(routes) {
	return documentedRoutes(routes).map(r => ({
		method: r.method,
		url: r.url,
		group: groupOf(r.url),
		permission: r.permission,
		confirm: r.confirm,
		query: describeFields(r.schema?.querystring),
		body: describeFields(r.schema?.body),
		example: r.method === 'GET' || !r.schema?.body ? null : exampleOf(r.schema.body),
	}));
}

// OpenAPI 3.0 (importable in Bruno, Postman, Insomnia…)
export function toOpenApi(routes, { baseUrl, version }) {
	const paths = {};
	for (const r of documentedRoutes(routes)) {
		const path = r.url.replace(/:(\w+)/g, '{$1}');
		const parameters = [
			...pathParams(r.url).map(name => ({ name, in: 'path', required: true, schema: r.schema?.params?.properties?.[name] ?? { type: 'string' } })),
			...Object.entries(r.schema?.querystring?.properties ?? {}).map(([name, schema]) => ({
				name, in: 'query', required: (r.schema.querystring.required ?? []).includes(name), schema,
			})),
		];
		const operation = {
			tags: [groupOf(r.url)],
			summary: `${r.method} ${r.url.replace(/^\/api/, '')}`,
			description: describeRoute(r),
			operationId: `${r.method.toLowerCase()}${r.url.replace(/^\/api/, '').replace(/[^a-zA-Z0-9]+(\w)?/g, (_, c) => (c ?? '').toUpperCase())}`,
			...(parameters.length ? { parameters } : {}),
			...(r.schema?.body && r.method !== 'GET' ? {
				requestBody: { required: true, content: { 'application/json': { schema: r.schema.body, example: exampleOf(r.schema.body) } } },
			} : {}),
			responses: {
				200: { description: 'Succès' },
				400: { description: 'Requête invalide', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
				401: { description: 'Clé invalide, expirée ou révoquée' },
				403: { description: 'Permission manquante' },
				404: { description: 'Introuvable' },
				429: { description: 'Trop de requêtes' },
			},
		};
		paths[path] = { ...paths[path], [r.method.toLowerCase()]: operation };
	}
	return {
		openapi: '3.0.3',
		info: {
			title: 'Brothers Life — API du bot',
			version,
			description: 'API complète du bot Discord Brothers Life : tout ce que fait le panel, avec une clé d’API (en-tête `Authorization: Bearer brl_…`). Une clé agit au nom de son créateur, limitée aux permissions choisies.',
		},
		servers: [{ url: baseUrl }],
		security: [{ apiKey: [] }],
		components: {
			securitySchemes: { apiKey: { type: 'http', scheme: 'bearer', bearerFormat: 'brl_…' } },
			schemas: {
				Error: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } } } },
			},
		},
		paths,
	};
}

// --- Bruno ------------------------------------------------------------------------------------

const indent = (text, by = '  ') => text.split('\n').map(l => (l ? by + l : l)).join('\n');
const slug = text => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const BRUNO_DOCS = `# Brothers Life — API du bot

Toute l'administration du bot (ce que fait le panel) est accessible ici avec une **clé d'API**.

## Démarrer

1. Sur le panel, page **API** : crée une clé (elle n'est affichée qu'une fois).
2. Dans Bruno, environnement **Production** : renseigne \`baseUrl\` (ex. \`https://IP:PORT\`) et \`apiKey\` (variable secrète).
3. Le panel est en HTTPS auto-signé : dans Bruno, *Preferences → General*, décoche **SSL/TLS Certificate Verification**.

## Règles

- Authentification : \`Authorization: Bearer brl_…\` (déjà réglé au niveau de la collection).
- Une clé agit **au nom de son créateur**, limitée aux permissions choisies à sa création. Si le créateur perd un droit, la clé le perd aussi.
- Les actions sensibles demandent \`"confirm": true\` dans le corps.
- Limite : 240 requêtes par minute et par clé (réponse 429 + \`Retry-After\`).
- Erreurs : \`{ "error": { "code": "…", "message": "…" } }\`, messages en français.
- Toute action passe dans le journal d'audit du panel, avec la source \`api\`.
- Les identifiants Discord (serveurs, salons, membres, rôles) sont des chaînes de 17 à 20 chiffres.
`;

function bruRequest(route, seq) {
	const name = `${route.method} ${route.url.replace(/^\/api/, '')}`;
	const params = pathParams(route.url);
	const query = Object.keys(route.schema?.querystring?.properties ?? {});
	const hasBody = route.method !== 'GET' && route.method !== 'DELETE' ? Boolean(route.schema?.body) || route.confirm : route.confirm;
	const blocks = [
		`meta {\n  name: ${name}\n  type: http\n  seq: ${seq}\n}`,
		`${route.method.toLowerCase()} {\n  url: {{baseUrl}}${route.url}\n  body: ${hasBody ? 'json' : 'none'}\n  auth: inherit\n}`,
	];
	if (query.length) blocks.push(`params:query {\n${query.map(q => `  ~${q}: `).join('\n')}\n}`);
	if (params.length) blocks.push(`params:path {\n${params.map(p => `  ${p}: `).join('\n')}\n}`);
	if (hasBody) {
		const example = route.schema?.body ? exampleOf(route.schema.body) : {};
		if (route.confirm && example && typeof example === 'object') example.confirm = true;
		blocks.push(`body:json {\n${indent(JSON.stringify(example ?? {}, null, 2))}\n}`);
	}
	blocks.push(`docs {\n${indent(describeRoute(route))}\n}`);
	return { file: `${slug(`${route.method} ${route.url.replace(/^\/api/, '')}`)}.bru`, content: blocks.join('\n\n') + '\n' };
}

// Files of a Bruno collection (folder format, opened with « Open Collection »)
export function toBruno(routes, { baseUrl = 'https://127.0.0.1:3000', version = '' } = {}) {
	const files = [
		{ path: 'bruno.json', content: JSON.stringify({ version: '1', name: 'Brothers Life — API', type: 'collection', ignore: ['node_modules', '.git'] }, null, 2) + '\n' },
		{ path: 'collection.bru', content: `auth {\n  mode: bearer\n}\n\nauth:bearer {\n  token: {{apiKey}}\n}\n\ndocs {\n${indent(BRUNO_DOCS + (version ? `\nVersion du bot : ${version}\n` : ''))}\n}\n` },
		{ path: 'environments/Production.bru', content: `vars {\n  baseUrl: ${baseUrl}\n}\nvars:secret [\n  apiKey\n]\n` },
		{ path: 'environments/Local.bru', content: 'vars {\n  baseUrl: http://127.0.0.1:3000\n}\nvars:secret [\n  apiKey\n]\n' },
	];
	const groups = new Map();
	for (const route of documentedRoutes(routes)) {
		const group = groupOf(route.url);
		if (!groups.has(group)) groups.set(group, []);
		groups.get(group).push(route);
	}
	let folderSeq = 0;
	for (const [group, list] of groups) {
		const dir = slug(group);
		files.push({ path: `${dir}/folder.bru`, content: `meta {\n  name: ${group}\n  seq: ${++folderSeq}\n}\n` });
		const used = new Set();
		list.forEach((route, i) => {
			const { file, content } = bruRequest(route, i + 1);
			let name = file;
			for (let n = 2; used.has(name); n++) name = file.replace(/\.bru$/, `-${n}.bru`);
			used.add(name);
			files.push({ path: `${dir}/${name}`, content });
		});
	}
	return files;
}
