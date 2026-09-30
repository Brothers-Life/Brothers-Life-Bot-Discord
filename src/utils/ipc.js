// Link with launcher.js. When the app runs alone (npm run dev), every call is a no-op.
export const supervised = typeof process.send === 'function';

const pending = new Map();
let nextId = 1;

export function send(message) {
	if (supervised && process.connected) process.send(message);
}

export function on(type, listener) {
	if (!supervised) return () => undefined;
	const handler = (message) => {
		if (message?.type === type) listener(message);
	};
	process.on('message', handler);
	return () => process.off('message', handler);
}

// Request/response with the launcher (e.g. install a version)
export function request(type, payload = {}, timeoutMs = 15 * 60_000) {
	if (!supervised) return Promise.reject(new Error('The bot is not running under launcher.js'));
	const id = nextId++;
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			pending.delete(id);
			reject(new Error(`Launcher did not answer "${type}" in time`));
		}, timeoutMs);
		pending.set(id, { resolve, reject, timer });
		send({ type, id, ...payload });
	});
}

if (supervised) {
	process.on('message', (message) => {
		if (message?.type !== 'response' || !pending.has(message.id)) return;
		const { resolve, reject, timer } = pending.get(message.id);
		pending.delete(message.id);
		clearTimeout(timer);
		if (message.error) reject(Object.assign(new Error(message.error), { code: message.code }));
		else resolve(message.result);
	});
}
