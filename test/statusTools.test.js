import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetTasks, taskDeclared, taskEnded, taskReport, taskStarted } from '../src/app/taskLog.js';
import { buildCommit, commitOf } from '../src/app/buildInfo.js';
import { tasksState } from '../src/web/routes/status.js';

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

test('task log: declared, run, failed then repaired', () => {
	resetTasks();
	taskDeclared('Polls failed', 30_000);
	assert.deepEqual(taskReport().map(t => [t.label, t.runs, t.lastStartAt]), [['Polls failed', 0, null]]);

	taskStarted('Polls failed', 30_000, 1000);
	taskEnded('Polls failed', new Error('Discord est tombé'), 1400);
	let [task] = taskReport();
	assert.deepEqual([task.runs, task.lastMs, task.lastError, task.lastOkAt], [1, 400, 'Discord est tombé', null]);

	taskStarted('Polls failed', 30_000, 31_000);
	taskEnded('Polls failed', null, 31_050);
	[task] = taskReport();
	assert.deepEqual([task.runs, task.lastError, task.lastOkAt], [2, null, 31_050]);
	// Ending a task nobody started changes nothing
	taskEnded('Inconnue', null, 5);
	assert.equal(taskReport().length, 1);
	resetTasks();
});

test('tasks on the status page: failing first, late ones flagged, names in French', () => {
	const now = 10_000_000;
	const tasks = [
		{ label: 'Polls failed', everyMs: 30_000, lastStartAt: now - 20_000, lastError: null },
		{ label: 'Tebex poll failed', everyMs: 120_000, lastStartAt: now - 60_000, lastError: 'Clé refusée' },
		{ label: 'Streams failed', everyMs: 60_000, lastStartAt: now - 600_000, lastError: null },
		// Never ran, in a process started a moment ago: not late yet
		{ label: 'Stats purge failed', everyMs: 86_400_000, lastStartAt: null, lastError: null },
		{ label: 'Something new failed', everyMs: 60_000, lastStartAt: null, lastError: null },
	];
	const result = tasksState(tasks, now - 3600_000, now);
	assert.deepEqual([result.failing, result.late], [1, 2]);
	assert.deepEqual(result.items.map(i => [i.label, i.state]), [
		['Achats Tebex', 'down'],
		['Something new', 'warn'],
		['Streams et vidéos', 'warn'],
		['Ménage des statistiques', 'ok'],
		['Sondages', 'ok'],
	]);
	assert.equal(result.items[0].value, 'Clé refusée');
});

test('build commit: from the host, a detached checkout, a branch or packed refs', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brl-build-'));
	const git = path.join(root, '.git');
	fs.mkdirSync(path.join(git, 'refs', 'heads'), { recursive: true });
	assert.equal(buildCommit({}, root), null, 'nothing tells');

	fs.writeFileSync(path.join(git, 'HEAD'), `${SHA}\n`);
	assert.equal(commitOf(git), SHA);
	fs.writeFileSync(path.join(git, 'HEAD'), 'ref: refs/heads/main\n');
	assert.equal(commitOf(git), null, 'a branch nobody describes');
	fs.writeFileSync(path.join(git, 'packed-refs'), `# pack-refs\n${OTHER} refs/heads/main\n`);
	assert.equal(commitOf(git), OTHER);
	fs.writeFileSync(path.join(git, 'refs', 'heads', 'main'), `${SHA}\n`);
	assert.equal(commitOf(git), SHA, 'the loose ref wins over the packed one');

	// The image carries buildinfo/ instead of .git; what the host says comes first, if it is a real hash
	fs.mkdirSync(path.join(root, 'buildinfo'));
	fs.writeFileSync(path.join(root, 'buildinfo', 'HEAD'), `${OTHER}\n`);
	assert.equal(buildCommit({}, root), OTHER);
	assert.equal(buildCommit({ GIT_COMMIT: 'main', SOURCE_COMMIT: SHA }, root), SHA);
	fs.rmSync(root, { recursive: true, force: true });
});
