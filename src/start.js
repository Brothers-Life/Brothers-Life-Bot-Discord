// Entry point of the Docker image: APP_ROLE picks the part to run (hosts like webgune only set variables).
//   all (default)  bot + API + panel in one process   bot | api | front  one part of the split deployment
const ROLES = { all: './index.js', bot: './bot.js', api: './api.js', front: './front.js' };
const role = (process.env.APP_ROLE || 'all').trim().toLowerCase();
if (!ROLES[role]) {
	console.error(`APP_ROLE must be one of ${Object.keys(ROLES).join(', ')} (got "${role}")`);
	process.exit(1);
}
// src/utils/config.js reads the role from the script name, here always start.js
if (role !== 'all') process.env.BRL_ROLE = role;
await import(ROLES[role]);
