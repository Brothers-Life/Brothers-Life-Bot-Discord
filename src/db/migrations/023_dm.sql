-- Direct messages through the bot: one conversation per person, answered from the panel
CREATE TABLE dm_threads (
	id              INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id         TEXT NOT NULL UNIQUE,
	user_name       TEXT,
	status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
	assigned_to     TEXT,
	unread          INTEGER NOT NULL DEFAULT 0,
	dms_closed      INTEGER NOT NULL DEFAULT 0,
	started_by      TEXT NOT NULL,
	last_message_at INTEGER NOT NULL,
	created_at      INTEGER NOT NULL
);
CREATE INDEX dm_threads_by_activity ON dm_threads (status, last_message_at DESC);

-- direction: in (from the person), out (from the staff), note (panel only)
CREATE TABLE dm_messages (
	id                 INTEGER PRIMARY KEY AUTOINCREMENT,
	thread_id          INTEGER NOT NULL REFERENCES dm_threads (id) ON DELETE CASCADE,
	direction          TEXT NOT NULL CHECK (direction IN ('in', 'out', 'note', 'system')),
	author_id          TEXT NOT NULL,
	content            TEXT NOT NULL DEFAULT '',
	attachments        TEXT NOT NULL DEFAULT '[]',
	discord_message_id TEXT,
	at                 INTEGER NOT NULL
);
CREATE INDEX dm_messages_by_thread ON dm_messages (thread_id, id);

CREATE TABLE dm_blocklist (
	user_id    TEXT PRIMARY KEY,
	reason     TEXT,
	blocked_by TEXT NOT NULL,
	at         INTEGER NOT NULL
);

-- Quick replies
CREATE TABLE dm_snippets (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	name       TEXT NOT NULL,
	content    TEXT NOT NULL,
	created_by TEXT NOT NULL,
	created_at INTEGER NOT NULL
);
