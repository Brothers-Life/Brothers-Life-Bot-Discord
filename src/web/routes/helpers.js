const SNOWFLAKE = /^\d{17,20}$/;

// Discord display names for a list of IDs (discord.js caches users, so this stays cheap)
export async function resolveNames(executor, ids) {
	const unique = [...new Set(ids.filter(id => SNOWFLAKE.test(String(id))))];
	const users = await Promise.all(unique.map(async id => [id, await executor.getUser(id).catch(() => null)]));
	return new Map(users.map(([id, user]) => [id, user ? { name: user.globalName ?? user.username, avatar: user.avatar } : null]));
}

export const snowflake = { type: 'string', pattern: '^\\d{17,20}$' };
