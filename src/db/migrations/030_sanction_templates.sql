-- Sanction templates: a ready-made base (type, reason, duration, scope) the staff picks, then adjusts if needed
CREATE TABLE sanction_templates (
	id                     INTEGER PRIMARY KEY AUTOINCREMENT,
	name                   TEXT NOT NULL UNIQUE COLLATE NOCASE,
	type                   TEXT NOT NULL CHECK (type IN ('ban', 'kick', 'timeout', 'warn', 'restrict')),
	reason                 TEXT NOT NULL DEFAULT '',
	duration_ms            INTEGER,
	scope                  TEXT NOT NULL DEFAULT 'network' CHECK (scope IN ('network', 'local')),
	profile                TEXT,
	delete_message_seconds INTEGER NOT NULL DEFAULT 0,
	position               INTEGER NOT NULL DEFAULT 0,
	created_at             INTEGER NOT NULL,
	updated_at             INTEGER NOT NULL
);
