import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHA = /^[0-9a-f]{40}$/;

const read = (...parts) => {
	try {
		return fs.readFileSync(path.join(...parts), 'utf8').trim();
	}
	catch {
		return null;
	}
};

// The commit a git folder points to: HEAD is the hash itself (detached checkout) or the name of a branch
// whose hash is in refs/ or in packed-refs
export function commitOf(gitDir) {
	const head = read(gitDir, 'HEAD');
	if (!head) return null;
	if (SHA.test(head)) return head;
	const ref = /^ref: (.+)$/.exec(head)?.[1];
	if (!ref) return null;
	const direct = read(gitDir, ...ref.split('/'));
	if (direct && SHA.test(direct)) return direct;
	const packed = read(gitDir, 'packed-refs')?.split('\n').find(line => line.endsWith(` ${ref}`));
	const hash = packed?.split(' ')[0];
	return hash && SHA.test(hash) ? hash : null;
}

let cached;
// Commit this process was built from: given by the host, copied into the image (buildinfo/, see the Dockerfile),
// or read from the repository when running from the sources. null when nothing tells.
export function buildCommit(env = process.env, root = ROOT) {
	if (cached !== undefined && env === process.env && root === ROOT) return cached;
	const given = [env.GIT_COMMIT, env.SOURCE_COMMIT, env.COMMIT_SHA, env.GITHUB_SHA].find(value => SHA.test(String(value ?? '').trim()));
	const commit = given?.trim() ?? commitOf(path.join(root, 'buildinfo')) ?? commitOf(path.join(root, '.git'));
	if (env === process.env && root === ROOT) cached = commit;
	return commit;
}
