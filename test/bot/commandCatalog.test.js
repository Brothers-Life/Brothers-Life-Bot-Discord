import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCommands } from '../../src/bot/loadCommands.js';
import { COMMANDS } from '../../src/core/commandCatalog.js';
import { isKnownPermission } from '../../src/core/permissions.js';
import '../../src/core/context.js';

test('the command catalogue of the panel lists every slash command, with real permissions', async () => {
	const loaded = (await loadCommands()).map(c => c.data.name).sort();
	assert.deepEqual(COMMANDS.map(c => c.name).sort(), loaded);
	for (const command of COMMANDS) {
		for (const permission of command.permissions) assert.ok(isKnownPermission(permission), `${command.name}: ${permission}`);
	}
});
