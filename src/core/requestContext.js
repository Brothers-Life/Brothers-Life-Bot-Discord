import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

// Data of the web request being handled, reachable from the services it calls
// (e.g. the API key, so the audit log can tell an API call from a panel click)
export const requestContext = {
	run: (store, fn) => storage.run(store, fn),
	get: () => storage.getStore() ?? null,
};
