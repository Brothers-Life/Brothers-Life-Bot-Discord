import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import selfsigned from 'selfsigned';

const DAY = 86_400_000;
// Browsers refuse longer lifetimes (Apple: 825 days, even for certificates accepted by hand)
const VALIDITY_DAYS = 397;
const RENEW_BEFORE_DAYS = 30;

// Returns the `https` options for Fastify, or null in http mode
export async function getTlsOptions(config, logger) {
	if (config.WEB_MODE === 'http') return null;

	if (config.WEB_MODE === 'https-custom') {
		return {
			cert: fs.readFileSync(path.resolve(config.ROOT_DIR, config.TLS_CERT)),
			key: fs.readFileSync(path.resolve(config.ROOT_DIR, config.TLS_KEY)),
		};
	}

	const { cert, key } = await ensureSelfSigned(config, logger);
	const fingerprint = new crypto.X509Certificate(cert).fingerprint256;
	logger.info(`Panel TLS certificate SHA-256 fingerprint: ${fingerprint}`);
	logger.info('Your browser will warn about this certificate once: check that it shows this fingerprint before accepting.');
	return { cert, key };
}

// Creates or renews the self-signed certificate (wrong host, missing, or expiring within 30 days).
// Returns { cert, key, renewed }.
export async function ensureSelfSigned(config, logger, now = new Date()) {
	const dir = path.join(config.DATA_DIR, 'tls');
	const certFile = path.join(dir, 'cert.pem');
	const keyFile = path.join(dir, 'key.pem');
	const host = new URL(config.WEB_PUBLIC_URL).hostname;

	if (host === 'localhost' || host === '127.0.0.1') {
		logger.warn('WEB_PUBLIC_URL is not set: the panel certificate and the Discord login only work on this machine (localhost).');
		logger.warn('Set WEB_PUBLIC_URL to https://<public IP>:<port> (Pterodactyl: "Adresse publique du panel").');
	}

	const existing = fs.existsSync(certFile) && fs.existsSync(keyFile) ? fs.readFileSync(certFile) : null;
	if (existing && isUsable(existing, host, now)) {
		return { cert: existing, key: fs.readFileSync(keyFile), renewed: false };
	}

	fs.mkdirSync(dir, { recursive: true });
	const altNames = [
		net.isIP(host) ? { type: 7, ip: host } : { type: 2, value: host },
		...(host !== 'localhost' ? [{ type: 2, value: 'localhost' }] : []),
		...(host !== '127.0.0.1' ? [{ type: 7, ip: '127.0.0.1' }] : []),
	];
	const pems = await selfsigned.generate([{ name: 'commonName', value: host }], {
		keyType: 'ec',
		curve: 'P-256',
		algorithm: 'sha256',
		notBeforeDate: new Date(now.getTime() - DAY),
		notAfterDate: new Date(now.getTime() + VALIDITY_DAYS * DAY),
		extensions: [
			{ name: 'basicConstraints', cA: false },
			{ name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
			{ name: 'extKeyUsage', serverAuth: true },
			{ name: 'subjectAltName', altNames },
		],
	});
	fs.writeFileSync(certFile, pems.cert);
	fs.writeFileSync(keyFile, pems.private, { mode: 0o600 });
	logger.info(`Generated a self-signed certificate for ${host} (valid ${VALIDITY_DAYS} days) in ${dir}`);
	return { cert: Buffer.from(pems.cert), key: Buffer.from(pems.private), renewed: true };
}

function isUsable(pem, host, now) {
	try {
		const cert = new crypto.X509Certificate(pem);
		const matches = Boolean(net.isIP(host) ? cert.checkIP(host) : cert.checkHost(host));
		const validFor = new Date(cert.validTo).getTime() - now.getTime();
		const lifetime = new Date(cert.validTo).getTime() - new Date(cert.validFrom).getTime();
		return matches && validFor > RENEW_BEFORE_DAYS * DAY && lifetime <= 398 * DAY;
	}
	catch {
		return false;
	}
}
