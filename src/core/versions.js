import fs from 'node:fs';
import path from 'node:path';
import { ValidationError, AppError } from './errors.js';
import { listBackups } from '../db/dump.js';

const CACHE_MS = 10 * 60_000;
const SCHEMA_MARKER = /<!--\s*schema:(\d+)\s*-->/;
const FIRST_MARIADB_VERSION = 'v2.0.0';

export function compareVersions(a, b) {
	const pa = String(a).replace(/^v/, '').split('.').map(Number);
	const pb = String(b).replace(/^v/, '').split('.').map(Number);
	for (let i = 0; i < 3; i++) {
		if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
	}
	return 0;
}

// Versions are GitHub Releases tagged vX.Y.Z, built by the CI. The release body carries
// <!-- schema:N --> so we know, before installing, which database schema it expects.
export function createVersionService({ config, settings, audit, appVersion, dbSchemaVersion, fetchImpl = fetch, now = Date.now }) {
	let cache = null;

	function readJson(file) {
		try {
			return JSON.parse(fs.readFileSync(file, 'utf8'));
		}
		catch {
			return null;
		}
	}

	function current() {
		const state = readJson(path.join(config.ROOT_DIR, 'current.json'));
		return {
			version: state?.version ?? `v${appVersion}`,
			previous: state?.previous ?? null,
			managed: Boolean(state),
		};
	}

	// Database backups made before each migration (src/db/dump.js)
	function backups() {
		return listBackups(path.join(config.DATA_DIR, 'backups')).map(b => ({ ...b, fromVersion: b.appVersion }));
	}

	async function listReleases(force = false) {
		if (!config.GITHUB_REPO) throw new AppError('NOT_CONFIGURED', 'GITHUB_REPO n’est pas défini dans le fichier .env.', 503);
		if (!force && cache && now() - cache.at < CACHE_MS) return cache.releases;

		const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'brl-bot' };
		if (config.GITHUB_TOKEN) headers.Authorization = `Bearer ${config.GITHUB_TOKEN}`;
		const res = await fetchImpl(`https://api.github.com/repos/${config.GITHUB_REPO}/releases?per_page=50`, { headers });
		if (res.status === 404 || res.status === 401) {
			throw new AppError('GITHUB', 'Dépôt introuvable : vérifie GITHUB_REPO et GITHUB_TOKEN (le dépôt est privé).', 502);
		}
		if (!res.ok) throw new AppError('GITHUB', `GitHub a répondu ${res.status}.`, 502);

		const releases = (await res.json())
			.filter(r => !r.draft && /^v\d+\.\d+\.\d+$/.test(r.tag_name))
			.map(r => ({
				version: r.tag_name,
				name: r.name || r.tag_name,
				publishedAt: r.published_at,
				prerelease: r.prerelease,
				changelog: (r.body ?? '').replace(SCHEMA_MARKER, '').trim(),
				schemaVersion: Number(SCHEMA_MARKER.exec(r.body ?? '')?.[1] ?? NaN) || null,
				asset: r.assets.find(a => /^bot-v\d+\.\d+\.\d+\.tar\.gz$/.test(a.name))?.id ?? null,
			}))
			.filter(r => r.asset)
			.sort((a, b) => compareVersions(b.version, a.version));

		cache = { at: now(), releases };
		return releases;
	}

	// What installing `version` implies for the database
	async function plan(release) {
		// Versions before 2.0.0 ran on SQLite: they cannot use this database at all
		if (compareVersions(release.version, FIRST_MARIADB_VERSION) < 0) return { compatible: false, restoreBackup: null, legacy: true };
		const dbVersion = await dbSchemaVersion();
		if (release.schemaVersion === null || release.schemaVersion >= dbVersion) {
			return { compatible: true, restoreBackup: null };
		}
		const backup = backups().find(b => b.schemaVersion !== null && b.schemaVersion <= release.schemaVersion);
		return { compatible: false, restoreBackup: backup ?? null };
	}

	return {
		current,
		backups,
		listReleases,

		async describe(force = false) {
			const releases = await listReleases(force).catch(error => ({ error }));
			const cur = current();
			return {
				current: cur,
				schemaVersion: await dbSchemaVersion(),
				ignored: await settings.get('versions.ignored', null),
				releases: releases.error ? [] : await Promise.all(releases.map(async r => ({ ...r, ...await plan(r), isCurrent: r.version === cur.version }))),
				error: releases.error ? { code: releases.error.code ?? 'GITHUB', message: releases.error.message } : null,
				backups: backups(),
			};
		},

		async prepareInstall(version) {
			const release = (await listReleases(true)).find(r => r.version === version);
			if (!release) throw new ValidationError(`Version inconnue : ${version}.`);
			const target = await plan(release);
			if (target.legacy) throw new ValidationError(`${version} fonctionne avec l’ancienne base SQLite : elle ne peut pas être installée sur la base MariaDB.`);
			if (!target.compatible && !target.restoreBackup) {
				throw new ValidationError(`${version} attend une base plus ancienne (schéma ${release.schemaVersion}) et aucune sauvegarde compatible n’existe.`);
			}
			return { release, ...target };
		},

		async ignore(version) {
			await settings.set('versions.ignored', version);
		},

		// Periodic check: announces a new version once in the system log channel
		async checkForUpdate() {
			const releases = await listReleases(true);
			const latest = releases.find(r => !r.prerelease);
			const cur = current();
			if (!latest || compareVersions(latest.version, cur.version) <= 0) return null;
			if ([await settings.get('versions.ignored'), await settings.get('versions.notified')].includes(latest.version)) return latest;
			await settings.set('versions.notified', latest.version);
			await audit.record({
				actorId: 'system',
				source: 'system',
				action: 'system.version_available',
				target: latest.version,
				details: { current: cur.version, latest: latest.version },
			});
			return latest;
		},
	};
}
