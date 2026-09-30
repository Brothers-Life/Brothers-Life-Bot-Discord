import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { NotFoundError, ValidationError } from './errors.js';

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const ID = /^[a-f0-9]{32}\.(png|jpg|webp|gif)$/;

// Recognised from the first bytes, never from the name the browser sent
function detect(buffer) {
	if (buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', mime: 'image/png' };
	if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
	if (buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
	if (buffer.length > 6 && ['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6))) return { ext: 'gif', mime: 'image/gif' };
	return null;
}

export const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

// Images sent from the panel (backgrounds, logos, announcement pictures), stored by content hash
export function createUploads({ dir }) {
	fs.mkdirSync(dir, { recursive: true });

	return {
		save(buffer) {
			if (!Buffer.isBuffer(buffer) || !buffer.length) throw new ValidationError('Fichier vide.');
			if (buffer.length > MAX_UPLOAD_BYTES) throw new ValidationError(`Image trop lourde : ${Math.ceil(buffer.length / 1024 / 1024)} Mo, 8 Mo maximum.`);
			const type = detect(buffer);
			if (!type) throw new ValidationError('Format non accepté : PNG, JPEG, WebP ou GIF seulement.');
			const id = `${createHash('sha256').update(buffer).digest('hex').slice(0, 32)}.${type.ext}`;
			const file = path.join(dir, id);
			if (!fs.existsSync(file)) fs.writeFileSync(file, buffer);
			return { id, mime: type.mime, size: buffer.length };
		},

		// Absolute path of an upload (the id is checked: no path traversal)
		file(id) {
			if (!ID.test(id)) throw new NotFoundError('Image introuvable.');
			const file = path.join(dir, id);
			if (!fs.existsSync(file)) throw new NotFoundError('Image introuvable.');
			return file;
		},

		read(id) {
			return fs.readFileSync(this.file(id));
		},

		exists(id) {
			return ID.test(id) && fs.existsSync(path.join(dir, id));
		},
	};
}
