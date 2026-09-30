-- Custom commands built in the panel: trigger (slash, right click, keyword), options, access rules and a flow of blocks
CREATE TABLE custom_commands (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	name        TEXT NOT NULL,
	definition  TEXT NOT NULL,
	enabled     INTEGER NOT NULL DEFAULT 1,
	uses        INTEGER NOT NULL DEFAULT 0,
	created_by  TEXT NOT NULL,
	created_at  INTEGER NOT NULL,
	updated_by  TEXT NOT NULL,
	updated_at  INTEGER NOT NULL
);

-- Counters used by the flows ({counter.key}); user_id '' = shared by everyone
CREATE TABLE custom_command_counters (
	key     TEXT NOT NULL,
	user_id TEXT NOT NULL DEFAULT '',
	value   INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (key, user_id)
);

-- Who ran what, and how it went
CREATE TABLE custom_command_runs (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	command_id INTEGER NOT NULL REFERENCES custom_commands (id) ON DELETE CASCADE,
	guild_id   TEXT,
	user_id    TEXT NOT NULL,
	trigger    TEXT NOT NULL,
	ok         INTEGER NOT NULL,
	detail     TEXT,
	at         INTEGER NOT NULL
);
CREATE INDEX custom_command_runs_by_command ON custom_command_runs (command_id, at DESC);
