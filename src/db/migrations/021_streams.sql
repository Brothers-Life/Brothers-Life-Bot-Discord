-- Stream and video notifications (Twitch, YouTube, Kick)
CREATE TABLE stream_subscriptions (
	id           INTEGER PRIMARY KEY AUTOINCREMENT,
	platform     TEXT NOT NULL CHECK (platform IN ('twitch', 'youtube', 'kick')),
	channel      TEXT NOT NULL,
	display_name TEXT NOT NULL,
	targets      TEXT NOT NULL,
	payloads     TEXT NOT NULL,
	config       TEXT NOT NULL,
	enabled      INTEGER NOT NULL DEFAULT 1,
	created_by   TEXT NOT NULL,
	created_at   INTEGER NOT NULL,
	updated_at   INTEGER NOT NULL
);

-- What is known of each channel, kept across restarts so a live is only announced once
CREATE TABLE stream_state (
	subscription_id INTEGER PRIMARY KEY REFERENCES stream_subscriptions (id) ON DELETE CASCADE,
	live_id         TEXT,
	live_started_at INTEGER,
	live_title      TEXT,
	live_game       TEXT,
	peak_viewers    INTEGER NOT NULL DEFAULT 0,
	live_messages   TEXT NOT NULL DEFAULT '[]',
	role_holders    TEXT NOT NULL DEFAULT '[]',
	last_video_id   TEXT,
	last_video_at   INTEGER,
	checked_at      INTEGER,
	videos_checked_at INTEGER,
	error           TEXT
);

CREATE TABLE stream_history (
	id              INTEGER PRIMARY KEY AUTOINCREMENT,
	subscription_id INTEGER NOT NULL REFERENCES stream_subscriptions (id) ON DELETE CASCADE,
	kind            TEXT NOT NULL CHECK (kind IN ('live', 'video', 'short', 'end', 'test')),
	title           TEXT,
	url             TEXT,
	channels        INTEGER NOT NULL DEFAULT 0,
	at              INTEGER NOT NULL
);
CREATE INDEX stream_history_by_date ON stream_history (at DESC);
