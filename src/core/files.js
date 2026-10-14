import zlib from 'node:zlib';
import { promisify } from 'node:util';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// Files kept in the database (shared by the bot and the API): images sent from the panel, HTML transcripts
// of tickets, channel archives. Text documents are stored gzipped.
export function createFiles({ db, now = Date.now }) {
	const q = {
		put: db.prepare('INSERT INTO files (id, kind, mime, size, gzip, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET kind = EXCLUDED.kind, mime = EXCLUDED.mime, size = EXCLUDED.size, gzip = EXCLUDED.gzip, data = EXCLUDED.data, created_at = EXCLUDED.created_at'),
		get: db.prepare('SELECT mime, gzip, data FROM files WHERE id = ?'),
		exists: db.prepare('SELECT 1 AS found FROM files WHERE id = ?'),
		remove: db.prepare('DELETE FROM files WHERE id = ?'),
	};

	return {
		async put(id, { kind, mime, data, compress = false }) {
			const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
			const stored = compress ? await gzip(buffer) : buffer;
			await q.put.run(id, kind, mime, buffer.length, compress ? 1 : 0, stored, now());
		},
		// { mime, data } or null
		async get(id) {
			const row = await q.get.get(id);
			if (!row) return null;
			return { mime: row.mime, data: row.gzip ? await gunzip(row.data) : row.data };
		},
		async exists(id) {
			return Boolean(await q.exists.get(id));
		},
		async remove(id) {
			return (await q.remove.run(id)).changes > 0;
		},
	};
}
