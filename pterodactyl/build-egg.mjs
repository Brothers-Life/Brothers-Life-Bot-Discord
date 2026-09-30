// Builds pterodactyl/egg-brothers-life-bot.json (import it in Pterodactyl: Admin > Nests > Import Egg).
// Run: npm run egg
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

const egg = {
	_comment: 'Egg Pterodactyl du bot Brothers Life. Généré par pterodactyl/build-egg.mjs, ne pas modifier à la main.',
	meta: { version: 'PTDL_v2', update_url: null },
	exported_at: new Date().toISOString(),
	name: 'Brothers Life Bot',
	author: 'bot@brothers-life.invalid',
	description: 'Bot Discord multi-serveurs Brothers Life avec son panel web. Installe une Release du dépôt GitHub privé ; les mises à jour se font ensuite depuis le panel (page Versions).',
	features: null,
	docker_images: {
		'Node.js 22': 'ghcr.io/parkervcp/yolks:nodejs_22',
		'Node.js 24': 'ghcr.io/parkervcp/yolks:nodejs_24',
	},
	file_denylist: [],
	startup: 'node launcher.js prod',
	config: {
		files: '{}',
		// Pterodactyl shows the server as running once the bot is connected and the panel is listening
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
	variables: [
		variable('Token du bot', 'TOKEN', 'Developer Portal > Bot > Reset Token.', 'required|string|max:200'),
		variable('ID de l’application', 'APP_ID', 'Developer Portal > General Information > Application ID.', 'required|regex:/^\\d{17,20}$/'),
		variable('Client Secret', 'CLIENT_SECRET', 'Developer Portal > OAuth2 > Client Secret (connexion au panel).', 'required|string|max:200'),
		variable('Chef du réseau (OWNER_ID)', 'OWNER_ID', 'ID Discord du seul compte qui a toutes les permissions.', 'required|regex:/^\\d{17,20}$/', '267235400467218432'),
		variable('Mode du panel', 'WEB_MODE', 'https-selfsigned (conseillé sans domaine), https-custom (avec TLS_CERT/TLS_KEY) ou http.', 'required|in:https-selfsigned,https-custom,http', 'https-selfsigned'),
		variable('Adresse publique du panel', 'WEB_PUBLIC_URL', 'Ex. https://51.77.1.2:25565. Vide = IP et port de l’allocation. À ajouter aussi dans Discord > OAuth2 > Redirects avec /api/auth/callback.', 'nullable|regex:/^https?:\\/\\/[^\\/]+$/'),
		variable('Dépôt GitHub', 'GITHUB_REPO', 'owner/repo où la CI publie les versions.', 'required|regex:/^[\\w.-]+\\/[\\w.-]+$/', 'Brothers-Life/Brothers-Life-Bot-Discord'),
		variable('Token GitHub', 'GITHUB_TOKEN', 'Seulement si le dépôt est privé : fine-grained token, Contents: Read-only sur le dépôt. Vide si le dépôt est public.', 'nullable|string|max:255'),
		variable('Version à installer', 'BOT_VERSION', 'latest ou un tag (ex. v1.0.0). Utilisée à l’installation et à la réinstallation ; ensuite, les mises à jour se font depuis le panel.', 'required|string|max:20', 'latest'),
		variable('Certificat TLS (https-custom)', 'TLS_CERT', 'Chemin du certificat, relatif au dossier du serveur.', 'nullable|string|max:255'),
		variable('Clé TLS (https-custom)', 'TLS_KEY', 'Chemin de la clé privée, relatif au dossier du serveur.', 'nullable|string|max:255'),
	],
};

const out = path.join(dir, 'egg-brothers-life-bot.json');
fs.writeFileSync(out, `${JSON.stringify(egg, null, 4)}\n`);
console.log(`Egg écrit dans ${path.relative(process.cwd(), out)}`);
