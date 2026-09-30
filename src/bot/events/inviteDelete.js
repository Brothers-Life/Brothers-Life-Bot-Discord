import { Events } from 'discord.js';
import { inviteDeleted } from '../eventLog.js';
import { forgetInvite } from '../invites.js';

export const name = Events.InviteDelete;
export function execute(invite) {
	forgetInvite(invite);
	inviteDeleted(invite);
}
