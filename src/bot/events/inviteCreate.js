import { Events } from 'discord.js';
import { inviteCreated } from '../eventLog.js';
import { rememberInvite } from '../invites.js';

export const name = Events.InviteCreate;
export function execute(invite) {
	rememberInvite(invite);
	inviteCreated(invite);
}
