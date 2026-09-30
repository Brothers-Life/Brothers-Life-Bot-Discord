import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// Minimal .zip extraction (stored or deflated entries, no zip64), enough for the yt-dlp builds.
// Every file is made executable: the archive holds a program and its libraries.
export function unzip(buffer, destination) {
	// End of central directory: last 22+ bytes, signature 0x06054b50
	let end = -1;
	for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65_557); i--) {
		if (buffer.readUInt32LE(i) === 0x06054b50) {
			end = i;
			break;
		}
	}
	if (end < 0) throw new Error('archive zip illisible');
	const count = buffer.readUInt16LE(end + 10);
	let offset = buffer.readUInt32LE(end + 16);
	const root = path.resolve(destination);

	for (let n = 0; n < count; n++) {
		if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('archive zip abîmée');
		const method = buffer.readUInt16LE(offset + 10);
		const compressedSize = buffer.readUInt32LE(offset + 20);
		const nameLength = buffer.readUInt16LE(offset + 28);
		const extraLength = buffer.readUInt16LE(offset + 30);
		const commentLength = buffer.readUInt16LE(offset + 32);
		const local = buffer.readUInt32LE(offset + 42);
		const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
		offset += 46 + nameLength + extraLength + commentLength;

		const target = path.resolve(root, name);
		if (!target.startsWith(root + path.sep) && target !== root) throw new Error(`chemin interdit dans l’archive : ${name}`);
		if (name.endsWith('/')) {
			fs.mkdirSync(target, { recursive: true });
			continue;
		}
		const dataStart = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
		const raw = buffer.subarray(dataStart, dataStart + compressedSize);
		const content = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw) : null;
		if (!content) throw new Error(`compression non prise en charge (${method})`);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(target, content, { mode: 0o755 });
	}
}
