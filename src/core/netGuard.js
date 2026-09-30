import { isIP } from 'node:net';

// Outgoing requests to addresses typed in the panel (card images, FiveM servers): refuse the machine itself,
// the local network and the cloud metadata endpoints. Host names are not resolved here (DNS stays out of it);
// what is checked is what the panel user can type directly.

function ipv4Parts(ip) {
	return ip.split('.').map(Number);
}

function privateV4(ip) {
	const [a, b] = ipv4Parts(ip);
	return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

function linkLocalV4(ip) {
	const [a, b] = ipv4Parts(ip);
	return a === 169 && b === 254;
}

function privateV6(ip) {
	const v = ip.toLowerCase();
	return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:');
}

// `allowPrivate`: the local network is accepted (a FiveM server on the same machine), never link-local / metadata
export function blockedHost(hostname, { allowPrivate = false } = {}) {
	const host = String(hostname ?? '').replace(/^\[|\]$/g, '').toLowerCase();
	if (!host) return 'adresse vide';
	if (host === 'metadata.google.internal' || host.endsWith('.internal')) return 'adresse interne';
	const kind = isIP(host);
	if (kind === 4) {
		if (linkLocalV4(host)) return 'adresse réservée';
		if (!allowPrivate && privateV4(host)) return 'adresse du réseau local';
	}
	if (kind === 6) {
		if (host.startsWith('fe80')) return 'adresse réservée';
		if (!allowPrivate && privateV6(host)) return 'adresse du réseau local';
	}
	if (!kind && !allowPrivate && (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local'))) return 'adresse du réseau local';
	return null;
}

export function blockedUrl(url, options) {
	try {
		return blockedHost(new URL(url).hostname, options);
	}
	catch {
		return 'adresse invalide';
	}
}
