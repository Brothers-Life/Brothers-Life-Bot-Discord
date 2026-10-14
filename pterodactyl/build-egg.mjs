// Builds the Pterodactyl eggs (import them in Pterodactyl: Admin > Nests > Import Egg). Run: npm run egg
//   egg-brothers-life-bot.json    everything in one server (bot + panel)
//   egg-brothers-life-bot-*.json  split deployment: bot, api, front (one server each), see docs/pterodactyl.md
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const installScript = fs.readFileSync(path.join(dir, 'install.sh'), 'utf8').replace(/\r\n/g, '\n');

// Rules are split on "|" by Pterodactyl: never put "|" inside a regex rule
const variable = (name, env, description, rules, defaultValue = '', { viewable = true, editable = true } = {}) => ({
	name,
	description,
	env_variable: env,
	default_value: defaultValue,
	user_viewable: viewable,
	user_editable: editable,
	rules,
	field_type: 'text',
});

const V = {
	token: variable('Token du bot', 'TOKEN', 'Developer Portal > Bot > Reset Token.', 'required|string|max:200'),
	appId: variable('ID de l’application', 'APP_ID', 'Developer Portal > General Information > Application ID.', 'required|regex:/^\\d{17,20}$/'),
	clientSecret: variable('Client Secret', 'CLIENT_SECRET', 'Developer Portal > OAuth2 > Client Secret (connexion au panel).', 'required|string|max:200'),
	owner: variable('Chef du réseau (OWNER_ID)', 'OWNER_ID', 'ID Discord du seul compte qui a toutes les permissions.', 'required|regex:/^\\d{17,20}$/', '267235400467218432'),
	webMode: variable('Mode du panel', 'WEB_MODE', 'https-selfsigned (conseillé sans domaine), https-custom (avec TLS_CERT/TLS_KEY) ou http.', 'required|in:https-selfsigned,https-custom,http', 'https-selfsigned'),
	publicUrl: variable('Adresse publique du panel', 'WEB_PUBLIC_URL', 'https://<IP publique du serveur du panel>:<port de son allocation>, ex. https://51.77.1.2:25565. Sert au certificat HTTPS et à la connexion Discord : à ajouter aussi dans Discord > OAuth2 > Redirects avec /api/auth/callback.', 'required|regex:/^https?:\\/\\/[^\\/]+$/'),
	repo: variable('Dépôt GitHub', 'GITHUB_REPO', 'owner/repo où la CI publie les versions.', 'required|regex:/^[\\w.-]+\\/[\\w.-]+$/', 'Brothers-Life/Brothers-Life-Bot-Discord'),
	githubToken: variable('Token GitHub', 'GITHUB_TOKEN', 'Seulement si le dépôt est privé : fine-grained token, Contents: Read-only sur le dépôt. Vide si le dépôt est public.', 'nullable|string|max:255'),
	version: variable('Version à installer', 'BOT_VERSION', 'latest ou un tag (ex. v2.0.0). Utilisée à l’installation et à la réinstallation ; ensuite, les mises à jour se font depuis le panel.', 'required|string|max:20', 'latest'),
	tlsCert: variable('Certificat TLS (https-custom)', 'TLS_CERT', 'Chemin du certificat, relatif au dossier du serveur.', 'nullable|string|max:255'),
	tlsKey: variable('Clé TLS (https-custom)', 'TLS_KEY', 'Chemin de la clé privée, relatif au dossier du serveur.', 'nullable|string|max:255'),
	dbHost: variable('Base de données : hôte', 'DB_HOST', 'Adresse du serveur PostgreSQL (l’onglet Databases de Pterodactyl ne crée que des bases MySQL : il faut un PostgreSQL à part, ex. un conteneur postgres:17).', 'required|string|max:255'),
	dbPort: variable('Base de données : port', 'DB_PORT', 'Port PostgreSQL (5432 en général).', 'required|integer|between:1,65535', '5432'),
	dbName: variable('Base de données : nom', 'DB_NAME', 'Nom de la base PostgreSQL.', 'required|string|max:64'),
	dbUser: variable('Base de données : utilisateur', 'DB_USER', 'Utilisateur PostgreSQL propriétaire de la base.', 'required|string|max:64'),
	dbPassword: variable('Base de données : mot de passe', 'DB_PASSWORD', 'Mot de passe de cet utilisateur.', 'required|string|max:255'),
	internalToken: variable('Clé de liaison interne', 'INTERNAL_TOKEN', 'Secret partagé par le bot, l’API et le front (32 caractères ou plus, le même sur les trois). Ex. : openssl rand -hex 32.', 'required|string|min:32|max:255'),
	apiUrl: variable('Adresse de l’API', 'API_URL', 'http://<IP>:<port de l’allocation du serveur API>, utilisée par le front et par le bot (qui s’y connecte). Même machine : l’IP interne de Pterodactyl (souvent 172.18.0.1).', 'required|regex:/^https?:\\/\\/[^\\/]+$/'),
	trustProxy: variable('Adresses du front', 'TRUST_PROXY', 'Adresse(s) IP du serveur front, séparées par des virgules : l’API croit leur en-tête X-Forwarded-For (adresse réelle des visiteurs). Même machine : 172.18.0.1.', 'nullable|string|max:255', '172.18.0.1'),
	servePanel: variable('L’API sert aussi le panel', 'SERVE_PANEL', 'false : seul le front sert le panel (conseillé).', 'required|in:true,false', 'false'),
};

const DATABASE = [V.dbHost, V.dbPort, V.dbName, V.dbUser, V.dbPassword];
const GITHUB = [V.repo, V.githubToken, V.version];

const EGGS = [
	{
		file: 'egg-brothers-life-bot.json',
		name: 'Brothers Life Bot',
		description: 'Bot Discord multi-serveurs Brothers Life avec son panel web, en un seul serveur. Base PostgreSQL (serveur à part). Installe une Release du dépôt GitHub ; les mises à jour se font ensuite depuis le panel (page Versions).',
		startup: 'node launcher.js prod',
		variables: [V.token, V.appId, V.clientSecret, V.owner, V.webMode, V.publicUrl, ...DATABASE, ...GITHUB, V.tlsCert, V.tlsKey],
	},
	{
		file: 'egg-brothers-life-bot-bot.json',
		name: 'Brothers Life — Bot',
		description: 'Déploiement séparé : la partie bot Discord (connexion à Discord, tâches planifiées). Il se connecte à l’API (API_URL) et n’ouvre aucun port.',
		startup: 'node launcher.js prod bot',
		variables: [V.token, V.appId, V.owner, V.publicUrl, V.internalToken, V.apiUrl, ...DATABASE, ...GITHUB],
	},
	{
		file: 'egg-brothers-life-bot-api.json',
		name: 'Brothers Life — API',
		description: 'Déploiement séparé : l’API du panel et l’API publique. Ne garde jamais le token du bot. Le front lui transmet les requêtes du navigateur.',
		startup: 'node launcher.js prod api',
		variables: [V.appId, V.clientSecret, V.owner, V.publicUrl, V.internalToken, V.trustProxy, V.servePanel, ...DATABASE, ...GITHUB],
	},
	{
		file: 'egg-brothers-life-bot-front.json',
		name: 'Brothers Life — Front',
		description: 'Déploiement séparé : le panel (application React) et le HTTPS. C’est la seule adresse ouverte aux navigateurs ; il transmet /api à l’API.',
		startup: 'node launcher.js prod front',
		variables: [V.webMode, V.publicUrl, V.apiUrl, V.internalToken, ...GITHUB, V.tlsCert, V.tlsKey],
	},
];

for (const egg of EGGS) {
	const json = {
		_comment: 'Egg Pterodactyl du bot Brothers Life. Généré par pterodactyl/build-egg.mjs, ne pas modifier à la main.',
		meta: { version: 'PTDL_v2', update_url: null },
		exported_at: new Date().toISOString(),
		name: egg.name,
		author: 'bot@brothers-life.invalid',
		description: egg.description,
		features: null,
		docker_images: {
			'Node.js 22': 'ghcr.io/parkervcp/yolks:nodejs_22',
			'Node.js 24': 'ghcr.io/parkervcp/yolks:nodejs_24',
		},
		file_denylist: [],
		startup: egg.startup,
		config: {
			files: '{}',
			// Pterodactyl shows the server as running once the app said it is ready
			startup: JSON.stringify({ done: '[LAUNCHER] App ready' }, null, 4),
			logs: '{}',
			stop: '^C',
		},
		scripts: {
			installation: {
				script: installScript,
				container: 'node:22-bookworm-slim',
				entrypoint: 'bash',
			},
		},
		variables: egg.variables,
	};
	const out = path.join(dir, egg.file);
	fs.writeFileSync(out, `${JSON.stringify(json, null, 4)}\n`);
	console.log(`Egg écrit dans ${path.relative(process.cwd(), out)}`);
}
