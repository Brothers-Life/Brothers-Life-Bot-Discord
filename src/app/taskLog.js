// What the periodic tasks of this process did last (see `every` in process.js), for the status page of the panel.
// No side effect at import: the runtime and the tests can read it freely.
const tasks = new Map();

export function taskStarted(label, everyMs, now = Date.now()) {
	const entry = tasks.get(label) ?? { label, everyMs, runs: 0, lastStartAt: null, lastEndAt: null, lastOkAt: null, lastError: null, lastMs: null };
	entry.everyMs = everyMs;
	entry.lastStartAt = now;
	entry.runs += 1;
	tasks.set(label, entry);
}

export function taskEnded(label, error = null, now = Date.now()) {
	const entry = tasks.get(label);
	if (!entry) return;
	entry.lastEndAt = now;
	entry.lastMs = now - entry.lastStartAt;
	if (error) {
		entry.lastError = String(error?.message ?? error).slice(0, 200);
	}
	else {
		entry.lastOkAt = now;
		entry.lastError = null;
	}
}

// Declared before its first run, so a task that never starts shows up too
export function taskDeclared(label, everyMs) {
	if (!tasks.has(label)) tasks.set(label, { label, everyMs, runs: 0, lastStartAt: null, lastEndAt: null, lastOkAt: null, lastError: null, lastMs: null });
}

export function taskReport() {
	return [...tasks.values()].map(entry => ({ ...entry }));
}

export function resetTasks() {
	tasks.clear();
}
