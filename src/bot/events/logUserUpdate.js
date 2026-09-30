import { Events } from 'discord.js';
import { userUpdated } from '../eventLog.js';

export const name = Events.UserUpdate;
export function execute(oldUser, user) {
	userUpdated(oldUser, user);
}
