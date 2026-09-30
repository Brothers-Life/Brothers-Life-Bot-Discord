import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureSelfSigned } from '../../src/web/tls.js';

const noop = () => undefined;
const DAY = 86_400_000;

function setup(url) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brl-tls-'));
	const warnings = [];
	return { config: { WEB_PUBLIC_URL: url, DATA_DIR: dir }, logger: { info: noop, warn: (m) => warnings.push(m) }, warnings, dir };
}

test('the certificate matches the public IP, lives at most 397 days and also covers localhost', async () => {
	const { config, logger } = setup('https://51.77.1.2:25565');
	const { cert, renewed } = await ensureSelfSigned(config, logger);
	const x509 = new crypto.X509Certificate(cert);
	assert.equal(renewed, true);
	assert.equal(x509.checkIP('51.77.1.2'), '51.77.1.2');
	assert.equal(x509.checkHost('localhost'), 'localhost');
	assert.ok(new Date(x509.validTo) - new Date(x509.validFrom) <= 398 * DAY);
	assert.deepEqual(x509.keyUsage, ['1.3.6.1.5.5.7.3.1']);
});

test('reused while valid, renewed when the host changes or when it expires soon', async () => {
	const { config, logger } = setup('https://51.77.1.2:25565');
	await ensureSelfSigned(config, logger);
	assert.equal((await ensureSelfSigned(config, logger)).renewed, false);
	assert.equal((await ensureSelfSigned(config, logger, new Date(Date.now() + 380 * DAY))).renewed, true, 'expires in less than 30 days');
	assert.equal((await ensureSelfSigned({ ...config, WEB_PUBLIC_URL: 'https://51.77.9.9:25565' }, logger)).renewed, true, 'new IP');
});

test('an old 10-year certificate is replaced', async () => {
	const { config, logger, dir } = setup('https://51.77.1.2:25565');
	const selfsigned = (await import('selfsigned')).default;
	const pems = await selfsigned.generate([{ name: 'commonName', value: '51.77.1.2' }], {
		keyType: 'ec', notAfterDate: new Date(Date.now() + 3650 * DAY),
		extensions: [{ name: 'subjectAltName', altNames: [{ type: 7, ip: '51.77.1.2' }] }],
	});
	fs.mkdirSync(path.join(dir, 'tls'));
	fs.writeFileSync(path.join(dir, 'tls', 'cert.pem'), pems.cert);
	fs.writeFileSync(path.join(dir, 'tls', 'key.pem'), pems.private);
	assert.equal((await ensureSelfSigned(config, logger)).renewed, true);
});

test('warns when the public address is missing', async () => {
	const { config, logger, warnings } = setup('https://localhost:25565');
	await ensureSelfSigned(config, logger);
	assert.match(warnings[0], /WEB_PUBLIC_URL/);
});
