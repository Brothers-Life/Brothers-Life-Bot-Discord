-- Messages edited from the panel and kept up to date in several channels of the network
CREATE TABLE live_messages (
	id              INTEGER PRIMARY KEY AUTOINCREMENT,
	name            TEXT NOT NULL,
	payload         TEXT NOT NULL,
	-- 0: static (edited only when changed in the panel); otherwise variables refreshed every N minutes
	refresh_minutes INTEGER NOT NULL DEFAULT 0,
	variables       TEXT NOT NULL DEFAULT '{}',
	repost          INTEGER NOT NULL DEFAULT 1,
	created_by      TEXT NOT NULL,
	created_at      INTEGER NOT NULL,
	updated_at      INTEGER NOT NULL,
	refreshed_at    INTEGER
);

CREATE TABLE live_message_targets (
	id           INTEGER PRIMARY KEY AUTOINCREMENT,
	message_id   INTEGER NOT NULL REFERENCES live_messages (id) ON DELETE CASCADE,
	guild_id     TEXT NOT NULL,
	channel_id   TEXT NOT NULL,
	discord_id   TEXT,
	last_hash    TEXT,
	last_error   TEXT,
	updated_at   INTEGER,
	UNIQUE (message_id, channel_id)
);

-- Changelog of the servers: entries published (and kept in sync) in chosen channels
CREATE TABLE changelog_entries (
	id           INTEGER PRIMARY KEY AUTOINCREMENT,
	version      TEXT,
	title        TEXT NOT NULL,
	intro        TEXT NOT NULL DEFAULT '',
	items        TEXT NOT NULL DEFAULT '[]',
	image        TEXT,
	color        TEXT NOT NULL DEFAULT '#d6a249',
	status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
	targets      TEXT NOT NULL DEFAULT '[]',
	messages     TEXT NOT NULL DEFAULT '[]',
	created_by   TEXT NOT NULL,
	created_at   INTEGER NOT NULL,
	updated_at   INTEGER NOT NULL,
	published_at INTEGER
);
