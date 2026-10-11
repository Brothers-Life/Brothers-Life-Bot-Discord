// Pterodactyl entry point: `node launcher.js prod [all|bot|api|front]`
// Supervises the app (src/index.js, or src/bot.js / api.js / front.js for a split deployment, of the installed
// version) and installs versions requested from the panel.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { createLauncher } from './launcher/launcher.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const envName = process.argv[2] || 'prod';
const role = process.argv[3] || process.env.BRL_ROLE || 'all';

// Only the GitHub settings are needed here; the app reads the whole .env itself
const envFile = path.join(root, `.env.${envName}`);
const fileVars = fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, 'utf8')) : {};
const setting = (key) => process.env[key] || fileVars[key] || '';

const launcher = createLauncher({
	root,
	envName,
	role,
	env: { ...process.env, BRL_ROLE: role },
	repo: setting('GITHUB_REPO'),
	token: setting('GITHUB_TOKEN'),
});

process.on('SIGINT', () => launcher.shutdown(0));
process.on('SIGTERM', () => launcher.shutdown(0));

launcher.start();
