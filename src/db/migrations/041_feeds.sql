-- Content feeds announced on Discord: any RSS / Atom feed, TikTok through an RSS bridge (RSSHub…)
CREATE TABLE feed_subscriptions (
	id           INTEGER PRIMARY KEY AUTOINCREMENT,
	kind         TEXT NOT NULL CHECK (kind IN ('rss', 'tiktok')),
	url          TEXT NOT NULL,
	display_name TEXT NOT NULL,
	targets      TEXT NOT NULL,
	payload      TEXT NOT NULL,
	config       TEXT NOT NULL,
	enabled      INTEGER NOT NULL DEFAULT 1,
	created_by   TEXT NOT NULL,
	created_at   INTEGER NOT NULL,
	updated_at   INTEGER NOT NULL
);

-- Polling state: next check, errors in a row (backoff), HTTP cache headers
CREATE TABLE feed_state (
	subscription_id INTEGER PRIMARY KEY REFERENCES feed_subscriptions (id) ON DELETE CASCADE,
	feed_title      TEXT,
	initialized_at  INTEGER,
	checked_at      INTEGER,
	next_check_at   INTEGER,
	failures        INTEGER NOT NULL DEFAULT 0,
	error           TEXT,
	etag            TEXT,
	last_modified   TEXT,
	last_item_at    INTEGER
);

-- Items already seen (guid, id or link): an item is only announced once
CREATE TABLE feed_seen (
	subscription_id INTEGER NOT NULL REFERENCES feed_subscriptions (id) ON DELETE CASCADE,
	item_key        TEXT NOT NULL,
	seen_at         INTEGER NOT NULL,
	PRIMARY KEY (subscription_id, item_key)
);

CREATE TABLE feed_history (
	id              INTEGER PRIMARY KEY AUTOINCREMENT,
	subscription_id INTEGER NOT NULL REFERENCES feed_subscriptions (id) ON DELETE CASCADE,
	kind            TEXT NOT NULL CHECK (kind IN ('item', 'test')),
	title           TEXT,
	url             TEXT,
	channels        INTEGER NOT NULL DEFAULT 0,
	at              INTEGER NOT NULL
);
CREATE INDEX feed_history_by_date ON feed_history (at DESC);
