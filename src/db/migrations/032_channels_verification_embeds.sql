-- Channels with an automatic behaviour: counting game, one-word story, sticky message, auto-publish, media only
CREATE TABLE channel_features (
	channel_id TEXT NOT NULL,
	guild_id   TEXT NOT NULL,
	kind       TEXT NOT NULL CHECK (kind IN ('counting', 'oneword', 'sticky', 'autopublish', 'mediaonly')),
	config     TEXT NOT NULL DEFAULT '{}',
	state      TEXT NOT NULL DEFAULT '{}',
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	PRIMARY KEY (channel_id, kind)
);
CREATE INDEX channel_features_by_guild ON channel_features (guild_id);

-- Newcomers who have not passed the verification yet (kicked after a while if the server wants it)
CREATE TABLE verification_pending (
	guild_id  TEXT NOT NULL,
	user_id   TEXT NOT NULL,
	joined_at INTEGER NOT NULL,
	attempts  INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (guild_id, user_id)
);

-- Messages made with the embed builder: kept to be edited in place later
CREATE TABLE built_messages (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	name       TEXT NOT NULL,
	guild_id   TEXT,
	channel_id TEXT,
	message_id TEXT,
	payload    TEXT NOT NULL,
	created_by TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);
