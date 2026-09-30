// Photo of a model server: its Discord structure (from the executor) and its panel configuration (from the database)

// Panel tables copied from the model, with their primary keys
export const PANEL_TABLES = {
	ticket_settings: { key: ['guild_id'] },
	ticket_categories: { key: ['name'], autoId: true },
	ticket_statuses: { key: ['key'] },
	ticket_panels: { key: ['name'], autoId: true },
	automod_config: { key: ['guild_id'] },
	log_routes: { key: ['category'] },
	rank_roles: { key: ['rank_id', 'role_id'] },
};

export function panelSnapshot(db, guildId) {
	return Object.fromEntries(Object.keys(PANEL_TABLES).map(table => [table, db.prepare(`SELECT * FROM ${table} WHERE guild_id = ?`).all(guildId)]));
}

// Keeps what a template needs: roles the bot can recreate (not managed, below its own), role overwrites only
export function cleanGuildSnapshot(guild) {
	return {
		id: guild.id,
		name: guild.name,
		community: Boolean(guild.community),
		roles: guild.roles.filter(r => r.everyone || (!r.managed && r.position < guild.botRolePosition)),
		channels: guild.channels.map(c => ({ ...c, overwrites: (c.overwrites ?? []).filter(o => o.type === 'role') })),
		settings: guild.settings,
	};
}

export function summary(snapshot) {
	const channels = snapshot.guild.channels;
	return {
		roles: snapshot.guild.roles.filter(r => !r.everyone).length,
		categories: channels.filter(c => c.type === 'category').length,
		channels: channels.filter(c => c.type !== 'category').length,
		ticketTypes: snapshot.panel.ticket_categories.length,
		logRoutes: snapshot.panel.log_routes.length,
		automod: snapshot.panel.automod_config.length > 0,
	};
}
