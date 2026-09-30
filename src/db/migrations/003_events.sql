-- Everything that happens on the network's servers, searchable from the panel
CREATE TABLE events (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	at         INTEGER NOT NULL,
	guild_id   TEXT NOT NULL,
	category   TEXT NOT NULL,
	type       TEXT NOT NULL,
	user_id    TEXT,
	actor_id   TEXT,
	channel_id TEXT,
	summary    TEXT NOT NULL,
	details    TEXT
);
CREATE INDEX events_by_at ON events (at);
CREATE INDEX events_by_guild ON events (guild_id, at);
CREATE INDEX events_by_category ON events (category, at);
CREATE INDEX events_by_user ON events (user_id, at);
