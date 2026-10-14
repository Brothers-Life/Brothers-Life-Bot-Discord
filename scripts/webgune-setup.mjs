// Installs the bot on webgune next to the old FiveM panel, taking its settings over (docs/webgune.md).
// Reads the old services of the project (panel-api, panel, panel-db), then creates or updates:
//   brl-db     PostgreSQL
//   brl-panel  web service (API + panel + FiveM telemetry), with the old panel's variables copied as they were
//   brl-bot    Discord bot service (only with --with-bot: never two bots on the same token)
//
//   WEBGUNE_API_KEY=wgk_… [OWNER_ID=…] [BOT_TOKEN=…] [APP_ID=… CLIENT_SECRET=…] node scripts/webgune-setup.mjs [options]
//     --project "Brothers Life Panel"   project name or id
//     --branch main                     branch built by webgune
//     --repo Brothers-Life/Brothers-Life-Bot-Discord
//     --with-bot                        also create the bot service (stop the old bot first)
//     --dry-run                         show what would be done, change nothing
// The key needs services:write and projects:write (services:read is enough for --dry-run).
// Secrets only travel to webgune: nothing is written on disk, values are masked in the output.
import crypto from 'node:crypto';

const API = (process.env.WEBGUNE_API_URL || 'https://api.webgune.cloud/api/v1').replace(/\/+$/, '');
const KEY = process.env.WEBGUNE_API_KEY;
const args = process.argv.slice(2);
const option = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const flag = name => args.includes(`--${name}`);
const DRY = flag('dry-run');
const PROJECT = option('project', 'Brothers Life Panel');
const BRANCH = option('branch', 'main');
const [OWNER, REPO] = option('repo', 'Brothers-Life/Brothers-Life-Bot-Discord').split('/');
const NAMES = { db: 'brl-db', panel: 'brl-panel', bot: 'brl-bot' };
const PORT = '3000';

// Variable names of the old panel taken over by the bot (src/utils/config.js LEGACY_PANEL_VARS)
const LEGACY = ['INGEST_TOKEN', 'FIVEM_BASE', 'PANEL_TZ', 'ALERT_ERRORS_5MIN', 'ALERT_MONEY_JUMP', 'ALERT_ANTICHEAT_CHANNEL',
	'RETENTION_DAYS', 'RETENTION_LOGS_DAYS', 'RETENTION_PERF_DAYS', 'RETENTION_SNAPSHOTS_DAYS', 'WEBMASTER_DISCORD_IDS', 'DISCORD_ALLOWED_ROLE_IDS',
	'DISCORD_GUILD_ID', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET'];
const SECRET = /TOKEN|SECRET|PASSWORD|KEY|DATABASE_URL|IMPORT_FROM/;

function fail(message) {
	console.error(`✖ ${message}`);
	process.exit(1);
}
const mask = (key, value) => (SECRET.test(key) ? `${String(value).slice(0, 4)}…(${String(value).length})` : value);
const show = vars => Object.entries(vars).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `    ${k}=${mask(k, v)}`).join('\n');

async function api(method, path, body) {
	const res = await fetch(`${API}${path}`, {
		method,
		headers: { Authorization: `Bearer ${KEY}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
		body: body ? JSON.stringify(body) : undefined,
		signal: AbortSignal.timeout(60_000),
	});
	const text = await res.text();
	let data;
	try {
		data = text ? JSON.parse(text) : null;
	}
	catch {
		data = text;
	}
	if (!res.ok) fail(`${method} ${path} → HTTP ${res.status} ${typeof data === 'object' ? data?.error ?? data?.message ?? '' : data}`);
	return data?.data ?? data;
}

const internalHost = (service, namespace) => `${service.k8sDeploymentName}.${namespace}.svc.cluster.local`;

async function waitFor(id, check, label) {
	for (let i = 0; i < 60; i++) {
		const service = await api('GET', `/services/${id}`);
		if (check(service)) return service;
		await new Promise(resolve => setTimeout(resolve, 5000));
	}
	fail(`${label} : toujours pas prêt après 5 minutes.`);
}

if (!KEY) fail('WEBGUNE_API_KEY manquant.');

const projects = await api('GET', '/projects');
const project = projects.find(p => p.id === PROJECT || p.name === PROJECT);
if (!project) fail(`Projet « ${PROJECT} » introuvable (projets : ${projects.map(p => p.name).join(', ')}).`);
const namespace = project.k8sNamespace;
const services = await Promise.all(project.services.map(s => api('GET', `/services/${s.id}`)));
const byName = name => services.find(s => s.name === name);

// The old panel: its API (INGEST_TOKEN), its front (DISCORD_CLIENT_ID), its database
const oldApi = services.find(s => s.envVars?.INGEST_TOKEN && !Object.values(NAMES).includes(s.name));
const oldFront = services.find(s => s.envVars?.DISCORD_CLIENT_ID && !Object.values(NAMES).includes(s.name));
const legacy = {};
for (const source of [oldApi, oldFront]) {
	// Values pasted from a .env sometimes kept their comment ("123   # ⟵ à remplir"): dropped
	for (const key of LEGACY) {
		const value = String(source?.envVars?.[key] ?? '').replace(/\s+#.*$/, '').trim();
		if (value) legacy[key] ??= value;
	}
}
console.log(`Projet : ${project.name} (${namespace})`);
console.log(`Ancien panel : API ${oldApi?.name ?? 'introuvable'}, front ${oldFront?.name ?? 'introuvable'} → ${Object.keys(legacy).length} réglage(s) repris`);

// The chief of the network: given, or the first webmaster of the old panel
const OWNER_ID = process.env.OWNER_ID || legacy.WEBMASTER_DISCORD_IDS?.split(/[\s,;]+/)[0];
if (!/^\d{17,20}$/.test(OWNER_ID ?? '')) fail('OWNER_ID manquant ou invalide (ton ID Discord).');
console.log(`Chef du réseau (OWNER_ID) : ${OWNER_ID}${process.env.OWNER_ID ? '' : ' (premier webmaster de l’ancien panel)'}`);
const APP_ID = process.env.APP_ID || legacy.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET || legacy.DISCORD_CLIENT_SECRET;
if (!process.env.APP_ID && APP_ID) console.log('APP_ID / CLIENT_SECRET : ceux de l’application Discord de l’ancien panel (connexion au panel).');

/* --- database --- */
let db = byName(NAMES.db);
if (!db) {
	const password = crypto.randomBytes(24).toString('hex');
	console.log(`\n+ ${NAMES.db} : base PostgreSQL`);
	if (!DRY) {
		const created = await api('POST', '/services', { name: NAMES.db, project_id: project.id, deploy_mode: 'database', database_type: 'postgres', database_user: 'brl', database_password: password });
		db = await waitFor(created.id, s => s.k8sStatus?.ready && s.envVars?.POSTGRES_PASSWORD, NAMES.db);
	}
}
else {
	console.log(`\n= ${NAMES.db} existe déjà`);
}
const databaseUrl = db
	? `postgresql://${encodeURIComponent(db.envVars.POSTGRES_USER)}:${encodeURIComponent(db.envVars.POSTGRES_PASSWORD)}@${internalHost(db, namespace)}:5432/${encodeURIComponent(db.envVars.POSTGRES_DB)}`
	: 'postgresql://brl:<créé>@brl-db/…';

/* --- panel (API + panel + telemetry) --- */
let panel = byName(NAMES.panel);
const internalToken = panel?.envVars?.INTERNAL_TOKEN || crypto.randomBytes(32).toString('hex');
const common = { DATABASE_URL: databaseUrl, INTERNAL_TOKEN: internalToken, OWNER_ID, GITHUB_REPO: `${OWNER}/${REPO}`, ...(APP_ID ? { APP_ID } : {}) };
const panelVars = {
	...legacy,
	...common,
	APP_ROLE: 'api', SERVE_PANEL: 'true', WEB_MODE: 'http', TRUST_PROXY: 'true', PORT,
	...(CLIENT_SECRET ? { CLIENT_SECRET } : {}),
	// History of the old panel, copied once at the first start
	...(oldApi?.envVars?.DATABASE_URL ? { TELEMETRY_IMPORT_FROM: oldApi.envVars.DATABASE_URL } : {}),
};
const build = { deploy_mode: 'github', github_owner: OWNER, github_repo: REPO, branch: BRANCH, build_type: 'dockerfile', deploy_trigger: 'push', tech_stack: 'nodejs' };
if (!panel) {
	console.log(`\n+ ${NAMES.panel} : service web (APP_ROLE=api), branche ${BRANCH}`);
	if (!DRY) {
		const created = await api('POST', '/services', { name: NAMES.panel, project_id: project.id, service_kind: 'web', port: Number(PORT), env_vars: panelVars, ...build });
		panel = await waitFor(created.id, s => s.domain && s.k8sDeploymentName, NAMES.panel);
	}
}
else {
	console.log(`\n= ${NAMES.panel} existe déjà : variables mises à jour`);
}
const publicUrl = panel?.domain ? `https://${panel.domain}` : 'https://<domaine du panel>';
panelVars.WEB_PUBLIC_URL = publicUrl;
console.log(show(panelVars));
if (!DRY && panel) await api('PUT', `/services/${panel.id}/env`, { vars: { ...panel.envVars, ...panelVars } });

/* --- bot --- */
const apiUrl = panel ? `http://${internalHost(panel, namespace)}:${PORT}` : 'http://brl-panel.<namespace>.svc.cluster.local:3000';
const botVars = { ...common, APP_ROLE: 'bot', API_URL: apiUrl, WEB_PUBLIC_URL: publicUrl, ...(process.env.BOT_TOKEN ? { TOKEN: process.env.BOT_TOKEN } : {}) };
const bot = byName(NAMES.bot);
if (flag('with-bot')) {
	if (!process.env.BOT_TOKEN && !bot?.envVars?.TOKEN) fail('BOT_TOKEN manquant pour créer le bot.');
	if (!APP_ID) fail('APP_ID manquant pour le bot (Application ID du bot).');
	console.log(`\n${bot ? '=' : '+'} ${NAMES.bot} : service Bot Discord (APP_ROLE=bot)`);
	console.log(show(botVars));
	if (!DRY) {
		if (bot) await api('PUT', `/services/${bot.id}/env`, { vars: { ...bot.envVars, ...botVars } });
		else await api('POST', '/services', { name: NAMES.bot, project_id: project.id, service_kind: 'bot', bot_runtime: 'js', env_vars: botVars, ...build });
	}
}
else {
	console.log(`\n· ${NAMES.bot} non créé (ajoute --with-bot une fois l’ancien bot arrêté et ses données reprises).`);
}

console.log(`
${DRY ? 'Simulation terminée : rien n’a été changé.' : 'Terminé.'}
Ensuite :
  1. Discord > OAuth2 > Redirects : ${publicUrl}/api/auth/callback
  2. Serveur FiveM : set telemetry_url "${publicUrl}" (le jeton ne change pas), puis restart bl_telemetry
  3. Voir docs/webgune.md pour reprendre les données du bot v1 et démarrer ${NAMES.bot}.`);
