-- Announcements: one message (text + embed) sent to one or more channels of the network
CREATE TABLE announcements (
	id           INTEGER PRIMARY KEY AUTOINCREMENT,
	name         TEXT NOT NULL,
	payload      TEXT NOT NULL,
	targets      TEXT NOT NULL,
	status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'partial', 'failed', 'deleted')),
	scheduled_at INTEGER,
	sent_at      INTEGER,
	results      TEXT,
	created_by   TEXT NOT NULL,
	created_at   INTEGER NOT NULL,
	updated_at   INTEGER NOT NULL
);
CREATE INDEX announcements_by_status ON announcements (status, scheduled_at);
