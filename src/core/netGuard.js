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

// What a client really connects to: WHATWG URL parsing turns the exotic IPv4 forms ("0x7f.1", "2130706433"…)
// into dotted quads, a trailing dot is dropped and an IPv4-mapped IPv6 ("::ffff:a9fe:a9fe") is the IPv4 it points to
function canonicalHost(hostname) {
	let host = String(hostname ?? '').trim().toLowerCase();
	if (!host) return '';
	if (!isIP(host.replace(/^\[|\]$/g, ''))) {
		try {
			host = new URL(`http://${host}/`).hostname;
		}
		catch {
			// Not a valid host: checked as typed
		}
	}
	host = host.replace(/^\[|\]$/g, '').replace(/\.+$/, '');
	const mapped = /^::ffff:(?:([0-9a-f]{1,4}):([0-9a-f]{1,4})|(\d+\.\d+\.\d+\.\d+))$/.exec(host);
	if (mapped) {
		if (mapped[3]) return mapped[3];
		const hi = parseInt(mapped[1], 16);
		const lo = parseInt(mapped[2], 16);
		return [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.');
	}
	return host;
}

// `allowPrivate`: the local network is accepted (a FiveM server on the same machine), never link-local / metadata
export function blockedHost(hostname, { allowPrivate = false } = {}) {
	const host = canonicalHost(hostname);
	if (!host) return 'adresse vide';
	if (host === 'metadata.google.internal' || host.endsWith('.internal')) return 'adresse interne';
	const kind = isIP(host);
	if (kind === 4) {
		if (linkLocalV4(host)) return 'adresse réservée';
		if (!allowPrivate && privateV4(host)) return 'adresse du réseau local';
	}
	if (kind === 6) {
		if (/^fe[89ab]/.test(host)) return 'adresse réservée';
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
