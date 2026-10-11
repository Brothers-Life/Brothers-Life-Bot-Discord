import { Events } from 'discord.js';
import { userUpdated } from '../eventLog.js';

export const name = Events.UserUpdate;
export async function execute(oldUser, user) {
	await userUpdated(oldUser, user);
}
