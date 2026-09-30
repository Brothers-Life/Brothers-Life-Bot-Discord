-- Anti-raid settings of each server (the raid state itself lives in memory)
CREATE TABLE antiraid_config (
	guild_id   TEXT PRIMARY KEY,
	config     TEXT NOT NULL,
	updated_at INTEGER NOT NULL,
	updated_by TEXT NOT NULL
);
