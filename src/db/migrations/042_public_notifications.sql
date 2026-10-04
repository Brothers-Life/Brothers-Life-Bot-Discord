-- Panel notifications: one row per event, shown to every panel user holding `permission`
-- (or only to `user_id` when set). The public page keeps its settings in the settings table.
CREATE TABLE panel_notifications (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	type       TEXT NOT NULL,
	title      TEXT NOT NULL,
	body       TEXT,
	url        TEXT,
	guild_id   TEXT,
	permission TEXT,
	user_id    TEXT,
	-- Whoever caused it never gets notified of their own action
	actor_id   TEXT,
	created_at INTEGER NOT NULL
);
CREATE INDEX panel_notifications_by_date ON panel_notifications (created_at);

CREATE TABLE panel_notification_reads (
	notification_id INTEGER NOT NULL REFERENCES panel_notifications (id) ON DELETE CASCADE,
	user_id         TEXT NOT NULL,
	PRIMARY KEY (notification_id, user_id)
) WITHOUT ROWID;

-- Per user: muted types (JSON array) and "everything up to this id is read"
CREATE TABLE panel_notification_prefs (
	user_id    TEXT PRIMARY KEY,
	disabled   TEXT NOT NULL DEFAULT '[]',
	read_up_to INTEGER NOT NULL DEFAULT 0
);
