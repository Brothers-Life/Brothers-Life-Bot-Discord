import fs from 'node:fs';
import path from 'node:path';

// The database is a MariaDB server: the app itself saves it before migrating (src/db/dump.js writes
// data/backups/last-migration.json) and restores a backup at start when data/backups/restore-request.json exists.
// The launcher only asks for those restores. Names shared with src/db/dump.js.
const LAST_MIGRATION = 'last-migration.json';
const RESTORE_REQUEST = 'restore-request.json';

function backupsDir(root) {
	return path.join(root, 'data', 'backups');
}

// The backup the app made before migrating, if made after `since`
export function migrationBackupSince(root, since) {
	try {
		const marker = JSON.parse(fs.readFileSync(path.join(backupsDir(root), LAST_MIGRATION), 'utf8'));
		return marker.at >= since ? marker.file : null;
	}
	catch {
		return null;
	}
}

// The next start of the app restores this backup first
export function requestRestore(root, file) {
	fs.mkdirSync(backupsDir(root), { recursive: true });
	fs.writeFileSync(path.join(backupsDir(root), RESTORE_REQUEST), JSON.stringify({ file: path.basename(file), at: Date.now() }));
}
