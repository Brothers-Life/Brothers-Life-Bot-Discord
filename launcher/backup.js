import fs from 'node:fs';
import path from 'node:path';

const KEEP_BACKUPS = 10;
const SIDE_FILES = ['-wal', '-shm'];

function dbFile(root) {
	return path.join(root, 'data', 'bot.db');
}

// Called while the app is stopped (database closed cleanly), so a file copy is consistent
export function backupDatabase(root, { label, schemaVersion, fromVersion }) {
	const source = dbFile(root);
	if (!fs.existsSync(source)) return null;
	const dir = path.join(root, 'data', 'backups');
	fs.mkdirSync(dir, { recursive: true });

	const at = Date.now();
	const stamp = new Date(at).toISOString().replace(/[:.]/g, '-');
	const file = `${label}-${stamp}.db`;
	fs.copyFileSync(source, path.join(dir, file));
	for (const suffix of SIDE_FILES) {
		if (fs.existsSync(source + suffix)) fs.copyFileSync(source + suffix, path.join(dir, file + suffix));
	}
	fs.writeFileSync(path.join(dir, file.replace(/\.db$/, '.json')), JSON.stringify({ at, schemaVersion, fromVersion }, null, 2));
	pruneBackups(dir);
	return file;
}

export function restoreDatabase(root, file) {
	const dir = path.join(root, 'data', 'backups');
	const source = path.join(dir, path.basename(file));
	if (!fs.existsSync(source)) throw new Error(`Backup ${file} not found`);
	const target = dbFile(root);
	for (const suffix of SIDE_FILES) fs.rmSync(target + suffix, { force: true });
	fs.copyFileSync(source, target);
	for (const suffix of SIDE_FILES) {
		if (fs.existsSync(source + suffix)) fs.copyFileSync(source + suffix, target + suffix);
	}
}

function pruneBackups(dir) {
	const backups = fs.readdirSync(dir)
		.filter(f => f.endsWith('.db'))
		.map(f => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
		.sort((a, b) => b.mtime - a.mtime);
	for (const { f } of backups.slice(KEEP_BACKUPS)) {
		for (const name of [f, `${f}-wal`, `${f}-shm`, f.replace(/\.db$/, '.json')]) {
			fs.rmSync(path.join(dir, name), { force: true });
		}
	}
}
