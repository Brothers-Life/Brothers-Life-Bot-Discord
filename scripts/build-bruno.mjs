// Regenerates the Bruno collection of the API (bruno/) from the routes of the web server.
// Usage: npm run bruno
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The modules read the bot configuration at import time unless they run in a test context
process.env.NODE_TEST_CONTEXT ??= '1';
const { createTestCore } = await import('../test/helpers.js');
const { createWebServer } = await import('../src/web/server.js');
const { toBruno } = await import('../src/web/apiDocs.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'bruno');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const noop = () => undefined;
const { core } = createTestCore();
let routes;
const web = await createWebServer({
	config: { ...core.config, WEB_PUBLIC_URL: 'https://IP:PORT' },
	core,
	runtime: { info: () => ({ version: `v${pkg.version}` }) },
	consoleLog: { lines: () => [], subscribe: () => noop },
	versions: {},
	logger: { info: noop, warn: noop, error: noop },
	staticDir: '/nonexistent',
	tls: null,
	onRoutes: r => { routes = r; },
});
await web.app.ready();

fs.rmSync(out, { recursive: true, force: true });
const files = toBruno(routes, { baseUrl: 'https://IP:PORT', version: `v${pkg.version}` });
for (const file of files) {
	const target = path.join(out, file.path);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, file.content);
}
await web.close();
console.log(`${files.length} fichiers écrits dans bruno/`);
process.exit(0);
