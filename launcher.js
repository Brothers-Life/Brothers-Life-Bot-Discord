// Pterodactyl entry point: `node launcher.js prod`
// Supervises the bot (src/index.js or an installed version) and installs versions requested from the panel.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { createLauncher } from './launcher/launcher.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const envName = process.argv[2] || 'prod';

// Only the GitHub settings are needed here; the app reads the whole .env itself
const envFile = path.join(root, `.env.${envName}`);
const fileVars = fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, 'utf8')) : {};
const setting = (key) => process.env[key] || fileVars[key] || '';

const launcher = createLauncher({
	root,
	envName,
	repo: setting('GITHUB_REPO'),
	token: setting('GITHUB_TOKEN'),
});

process.on('SIGINT', () => launcher.shutdown(0));
process.on('SIGTERM', () => launcher.shutdown(0));

launcher.start();
