-- Server backups: structure, panel configuration and members' roles, compressed (gzip)
CREATE TABLE server_backups (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	guild_id   TEXT NOT NULL,
	name       TEXT NOT NULL,
	kind       TEXT NOT NULL CHECK (kind IN ('auto', 'manual')),
	data       BLOB NOT NULL,
	roles      INTEGER NOT NULL,
	channels   INTEGER NOT NULL,
	members    INTEGER NOT NULL,
	size       INTEGER NOT NULL,
	created_by TEXT NOT NULL,
	created_at INTEGER NOT NULL
);
CREATE INDEX server_backups_by_guild ON server_backups (guild_id, created_at DESC);
