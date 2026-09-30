// Keeps the last lines written to stdout/stderr for the live console of the panel
const MAX_LINES = 5000;
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;

const buffer = [];
const subscribers = new Set();
let installed = false;
let seq = 0;

function levelOf(text) {
	const match = /^\[(INFO|WARN|ERROR|SUCCESS|DEBUG)\]/.exec(text);
	return match ? match[1].toLowerCase() : 'raw';
}

function push(text, stream) {
	const line = { id: ++seq, at: Date.now(), stream, level: stream === 'stderr' && levelOf(text) === 'raw' ? 'error' : levelOf(text), text };
	buffer.push(line);
	if (buffer.length > MAX_LINES) buffer.splice(0, buffer.length - MAX_LINES);
	for (const subscriber of subscribers) {
		try {
			subscriber(line);
		}
		catch {
			subscribers.delete(subscriber);
		}
	}
}

function hook(stream, name) {
	const original = stream.write.bind(stream);
	let partial = '';
	stream.write = (chunk, encoding, callback) => {
		const text = partial + (typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString(typeof encoding === 'string' ? encoding : 'utf8'));
		const parts = text.split(/\r?\n/);
		partial = parts.pop();
		for (const part of parts) push(part.replace(ANSI, ''), name);
		return original(chunk, encoding, callback);
	};
}

export function install() {
	if (installed) return;
	installed = true;
	hook(process.stdout, 'stdout');
	hook(process.stderr, 'stderr');
}

// Lines captured by the launcher before this process started (previous run, crash...)
export function seed(history) {
	history = history.slice(-MAX_LINES).map(l => ({ ...l, id: ++seq }));
	buffer.unshift(...history);
	if (buffer.length > MAX_LINES) buffer.splice(0, buffer.length - MAX_LINES);
}

export function lines() {
	return buffer.slice();
}

export function subscribe(listener) {
	subscribers.add(listener);
	return () => subscribers.delete(listener);
}
