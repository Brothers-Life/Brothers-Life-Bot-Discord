const SNOWFLAKE = /^\d{17,20}$/;

// Discord display names for a list of IDs (discord.js caches users, so this stays cheap)
export async function resolveNames(executor, ids) {
	const unique = [...new Set(ids.filter(id => SNOWFLAKE.test(String(id))))];
	const users = await Promise.all(unique.map(async id => [id, await executor.getUser(id).catch(() => null)]));
	return new Map(users.map(([id, user]) => [id, user ? { name: user.globalName ?? user.username, avatar: user.avatar } : null]));
}

// One cell of a CSV export (";" separated). Text typed by members starting with = + - @ would run
// as a formula in Excel / LibreOffice: it is prefixed with a quote and kept as plain text.
export function csvCell(value) {
	let text = value === null || value === undefined ? '' : String(value);
	if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
	return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const snowflake = { type: 'string', pattern: '^\\d{17,20}$' };

// Servers of the network with their text channels (and roles), to choose where to post
export async function networkTargets(core) {
	const guilds = core.network.list().filter(g => g.status === 'active' && g.botPresent);
	return Promise.all(guilds.map(async g => ({
		id: g.id,
		name: g.name,
		isMain: g.isMain,
		channels: await core.executor.listTextChannels(g.id),
		roles: (await core.executor.listRoles(g.id)).map(({ id, name, color }) => ({ id, name, color })),
	})));
}
