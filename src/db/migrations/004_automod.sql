-- Automod settings: guild_id '*' holds the network defaults, a server row overrides them
CREATE TABLE automod_config (
	guild_id   TEXT PRIMARY KEY,
	config     TEXT NOT NULL,
	updated_at INTEGER NOT NULL,
	updated_by TEXT NOT NULL
);
