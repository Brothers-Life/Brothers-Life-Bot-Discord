#!/bin/bash
# Pterodactyl installation script (runs in node:22-bookworm-slim, server files mounted on /mnt/server).
# Downloads a release of the bot from the private GitHub repo and installs its production dependencies.
# Kept on reinstall: .env.prod, data/ (database, backups, certificate), logs/.
set -euo pipefail
cd /mnt/server

if [ -z "${GITHUB_REPO:-}" ] || [ -z "${GITHUB_TOKEN:-}" ]; then
	echo "GITHUB_REPO et GITHUB_TOKEN sont obligatoires (onglet Startup du serveur)."
	exit 1
fi

node --input-type=module <<'NODE'
import fs from 'node:fs';

const { GITHUB_REPO: repo, GITHUB_TOKEN: token } = process.env;
const wanted = (process.env.BOT_VERSION || 'latest').trim();
const headers = {
	Authorization: `Bearer ${token}`,
	Accept: 'application/vnd.github+json',
	'User-Agent': 'brl-pterodactyl-installer',
	'X-GitHub-Api-Version': '2022-11-28',
};

const url = wanted === 'latest'
	? `https://api.github.com/repos/${repo}/releases/latest`
	: `https://api.github.com/repos/${repo}/releases/tags/${wanted}`;
const res = await fetch(url, { headers });
if (!res.ok) {
	console.error(`GitHub a répondu ${res.status} pour ${url}.`);
	console.error('Vérifie GITHUB_REPO, GITHUB_TOKEN (lecture du contenu du dépôt) et BOT_VERSION.');
	process.exit(1);
}
const release = await res.json();
const asset = release.assets.find(a => /^bot-v\d+\.\d+\.\d+\.tar\.gz$/.test(a.name));
if (!asset) {
	console.error(`La version ${release.tag_name} n'a pas d'archive bot-vX.Y.Z.tar.gz (la CI de publication a-t-elle réussi ?).`);
	process.exit(1);
}

console.log(`Téléchargement de ${release.tag_name} (${asset.name}, ${Math.round(asset.size / 1024)} Ko)`);
const file = await fetch(`https://api.github.com/repos/${repo}/releases/assets/${asset.id}`, {
	headers: { ...headers, Accept: 'application/octet-stream' },
});
if (!file.ok) {
	console.error(`Téléchargement impossible (${file.status}).`);
	process.exit(1);
}
fs.writeFileSync('/tmp/bot.tar.gz', Buffer.from(await file.arrayBuffer()));
NODE

# Replace the code, keep the data. current.json is removed: (re)installing runs this release.
rm -rf src launcher web/dist node_modules current.json
tar -xzf /tmp/bot.tar.gz -C /mnt/server
rm -f /tmp/bot.tar.gz

npm ci --omit=dev --ignore-scripts --no-audit --no-fund
mkdir -p data logs

echo "Installation terminée : $(node -p "require('./package.json').version")"
