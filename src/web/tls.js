import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import selfsigned from 'selfsigned';

// Returns the `https` options for Fastify, or null in http mode
export async function getTlsOptions(config, logger) {
	if (config.WEB_MODE === 'http') return null;

	if (config.WEB_MODE === 'https-custom') {
		return {
			cert: fs.readFileSync(path.resolve(config.ROOT_DIR, config.TLS_CERT)),
			key: fs.readFileSync(path.resolve(config.ROOT_DIR, config.TLS_KEY)),
		};
	}

	const dir = path.join(config.DATA_DIR, 'tls');
	const certFile = path.join(dir, 'cert.pem');
	const keyFile = path.join(dir, 'key.pem');
	const host = new URL(config.WEB_PUBLIC_URL).hostname;

	if (!fs.existsSync(certFile) || !fs.existsSync(keyFile) || !certMatchesHost(fs.readFileSync(certFile), host)) {
		fs.mkdirSync(dir, { recursive: true });
		const now = new Date();
		const pems = await selfsigned.generate([{ name: 'commonName', value: host }], {
			keyType: 'ec',
			curve: 'P-256',
			algorithm: 'sha256',
			notBeforeDate: now,
			notAfterDate: new Date(now.getTime() + 10 * 365 * 24 * 3600_000),
			extensions: [
				{ name: 'basicConstraints', cA: false },
				{ name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
				{ name: 'extKeyUsage', serverAuth: true },
				{ name: 'subjectAltName', altNames: [net.isIP(host) ? { type: 7, ip: host } : { type: 2, value: host }] },
			],
		});
		fs.writeFileSync(certFile, pems.cert);
		fs.writeFileSync(keyFile, pems.private, { mode: 0o600 });
		logger.info(`Generated a self-signed certificate for ${host} in ${dir}`);
	}

	const cert = fs.readFileSync(certFile);
	const fingerprint = new crypto.X509Certificate(cert).fingerprint256;
	logger.info(`Panel TLS certificate SHA-256 fingerprint: ${fingerprint}`);
	logger.info('Your browser will warn about this certificate once: check that it shows this fingerprint before accepting.');
	return { cert, key: fs.readFileSync(keyFile) };
}

function certMatchesHost(pem, host) {
	try {
		const cert = new crypto.X509Certificate(pem);
		return Boolean(cert.checkHost(host) || cert.checkIP(host));
	}
	catch {
		return false;
	}
}
