-- Suggestion boxes, bug reports and internal staff bugs (same engine, several boxes per server)
CREATE TABLE feedback_boxes (
	id               INTEGER PRIMARY KEY AUTOINCREMENT,
	guild_id         TEXT NOT NULL,
	name             TEXT NOT NULL,
	kind             TEXT NOT NULL CHECK (kind IN ('public', 'staff')),
	config           TEXT NOT NULL,
	panel_channel_id TEXT,
	panel_message_id TEXT,
	created_at       INTEGER NOT NULL
);
CREATE INDEX feedback_boxes_by_guild ON feedback_boxes (guild_id);

CREATE TABLE feedback_items (
	id             INTEGER PRIMARY KEY AUTOINCREMENT,
	box_id         INTEGER NOT NULL REFERENCES feedback_boxes (id) ON DELETE CASCADE,
	guild_id       TEXT NOT NULL,
	number         INTEGER NOT NULL,
	author_id      TEXT NOT NULL,
	author_name    TEXT,
	anonymous      INTEGER NOT NULL DEFAULT 0,
	title          TEXT NOT NULL,
	answers        TEXT NOT NULL DEFAULT '[]',
	status         TEXT NOT NULL,
	status_reason  TEXT,
	status_history TEXT NOT NULL DEFAULT '[]',
	urgency        TEXT,
	assignee_id    TEXT,
	duplicate_of   INTEGER,
	approved       INTEGER NOT NULL DEFAULT 1,
	channel_id     TEXT,
	message_id     TEXT,
	thread_id      TEXT,
	reminded_at    INTEGER,
	created_at     INTEGER NOT NULL,
	updated_at     INTEGER NOT NULL,
	UNIQUE (box_id, number)
);
CREATE INDEX feedback_items_by_box ON feedback_items (box_id, status);

CREATE TABLE feedback_votes (
	item_id INTEGER NOT NULL REFERENCES feedback_items (id) ON DELETE CASCADE,
	user_id TEXT NOT NULL,
	value   INTEGER NOT NULL CHECK (value IN (-1, 1)),
	at      INTEGER NOT NULL,
	PRIMARY KEY (item_id, user_id)
);
