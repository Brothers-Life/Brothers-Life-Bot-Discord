-- "Join to create" channels of each server, with their settings
CREATE TABLE voice_hubs (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	guild_id   TEXT NOT NULL,
	channel_id TEXT NOT NULL UNIQUE,
	config     TEXT NOT NULL,
	created_at INTEGER NOT NULL
);

-- Personal voice channels currently open
CREATE TABLE voice_rooms (
	channel_id TEXT PRIMARY KEY,
	guild_id   TEXT NOT NULL,
	hub_id     INTEGER,
	owner_id   TEXT NOT NULL,
	state      TEXT NOT NULL DEFAULT '{}',
	created_at INTEGER NOT NULL
);
CREATE INDEX voice_rooms_by_owner ON voice_rooms (guild_id, owner_id);

-- What each creator set last time (name, limit, locked, allowed and blocked members)
CREATE TABLE voice_prefs (
	user_id  TEXT NOT NULL,
	guild_id TEXT NOT NULL,
	prefs    TEXT NOT NULL,
	PRIMARY KEY (user_id, guild_id)
);
