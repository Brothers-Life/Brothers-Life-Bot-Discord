import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCommands } from '../../src/bot/loadCommands.js';
import { PermissionFlagsBits } from 'discord.js';
import { COMMANDS, commandsFor } from '../../src/core/commandCatalog.js';
import { helpEmbed } from '../../src/bot/commands/utility/aide.js';
import { isKnownPermission } from '../../src/core/permissions.js';
import '../../src/core/context.js';

test('the command catalogue of the panel lists every slash command, with real permissions', async () => {
	const loaded = (await loadCommands()).map(c => c.data.name).sort();
	assert.deepEqual(COMMANDS.map(c => c.name).sort(), loaded);
	for (const command of COMMANDS) {
		for (const permission of command.permissions) assert.ok(isKnownPermission(permission), `${command.name}: ${permission}`);
	}
});

const STAFF_ONLY = ['sondage', 'reunion', 'joueur', 'maintenance', 'giveaway', 'ticket-staff', 'sanction', 'fiche'];
const FOR_EVERYONE = ['fivem', 'ticket', 'info', 'aide', 'ping', 'musique'];

test('staff commands are hidden from members by default, member commands are not', async () => {
	const loaded = new Map((await loadCommands()).map(c => [c.data.name, c.data.toJSON()]));
	for (const name of STAFF_ONLY) assert.equal(loaded.get(name).default_member_permissions, String(PermissionFlagsBits.ModerateMembers), name);
	for (const name of FOR_EVERYONE) assert.ok(loaded.get(name).default_member_permissions == null, name);
	// Commands merged or renamed
	for (const name of ['lever', 'sanctionner', 'userinfo']) assert.equal(loaded.has(name), false, name);
	assert.deepEqual(loaded.get('fivem').options.map(o => o.name), ['statut']);
	assert.deepEqual(loaded.get('ticket').options.map(o => o.name), ['fermer']);
	assert.ok(loaded.get('sanction').options.some(o => o.name === 'modele'));
});

test('/aide shows a member only what they can use, the staff more', () => {
	const member = helpEmbed(() => false).toJSON();
	const text = member.fields.map(f => f.value).join('\n');
	assert.match(text, /\/info/);
	assert.match(text, /\/musique/);
	assert.doesNotMatch(text, /\/ban\b|\/sondage|\/ticket-staff/);
	const staff = commandsFor(p => p === 'sanctions.ban' || p === 'tickets.handle').map(c => c.name);
	assert.ok(staff.includes('ban') && staff.includes('ticket-staff') && !staff.includes('sondage'));
});
