-- FiveM servers: live status, status messages in Discord channels
CREATE TABLE fivem_servers (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	name       TEXT NOT NULL,
	address    TEXT NOT NULL,
	join_code  TEXT,
	config     TEXT NOT NULL DEFAULT '{}',
	created_by TEXT NOT NULL,
	created_at INTEGER NOT NULL
);

CREATE TABLE fivem_status_messages (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	server_id  INTEGER NOT NULL REFERENCES fivem_servers (id) ON DELETE CASCADE,
	guild_id   TEXT NOT NULL,
	channel_id TEXT NOT NULL,
	message_id TEXT,
	UNIQUE (server_id, channel_id)
);
