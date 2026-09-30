-- Announcements v2: send options (pin, thread, reactions, link buttons, gallery, attachments, auto-delete), recurrence, templates
ALTER TABLE announcements ADD COLUMN options TEXT NOT NULL DEFAULT '{}';
ALTER TABLE announcements ADD COLUMN recurrence TEXT;
ALTER TABLE announcements ADD COLUMN run_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE announcements ADD COLUMN history TEXT NOT NULL DEFAULT '[]';

CREATE TABLE announcement_templates (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	name       TEXT NOT NULL,
	payload    TEXT NOT NULL,
	options    TEXT NOT NULL DEFAULT '{}',
	targets    TEXT NOT NULL DEFAULT '[]',
	created_by TEXT NOT NULL,
	created_at INTEGER NOT NULL
);

-- Messages the bot deletes by itself later (announcements with auto-delete)
CREATE TABLE scheduled_deletions (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	channel_id TEXT NOT NULL,
	message_id TEXT NOT NULL,
	delete_at  INTEGER NOT NULL,
	source     TEXT NOT NULL
);
CREATE INDEX scheduled_deletions_by_date ON scheduled_deletions (delete_at);
