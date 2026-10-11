import { Events } from 'discord.js';
import { inviteDeleted } from '../eventLog.js';
import { forgetInvite } from '../invites.js';

export const name = Events.InviteDelete;
export async function execute(invite) {
	forgetInvite(invite);
	await inviteDeleted(invite);
}
