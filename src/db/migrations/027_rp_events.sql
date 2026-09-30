-- RP events: planned in the panel, announced in Discord channels, members sign up with buttons
CREATE TABLE rp_events (
	id           INTEGER PRIMARY KEY AUTOINCREMENT,
	title        TEXT NOT NULL,
	description  TEXT NOT NULL DEFAULT '',
	image        TEXT,
	location     TEXT,
	starts_at    INTEGER NOT NULL,
	ends_at      INTEGER NOT NULL,
	capacity     INTEGER,
	allow_maybe  INTEGER NOT NULL DEFAULT 1,
	targets      TEXT NOT NULL DEFAULT '[]',
	roles        TEXT NOT NULL DEFAULT '{}',
	reminders    TEXT NOT NULL DEFAULT '[60]',
	reminded     TEXT NOT NULL DEFAULT '[]',
	messages     TEXT NOT NULL DEFAULT '[]',
	status       TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'live', 'ended', 'cancelled')),
	created_by   TEXT NOT NULL,
	created_at   INTEGER NOT NULL,
	updated_at   INTEGER NOT NULL
);
CREATE INDEX rp_events_by_start ON rp_events (status, starts_at);

CREATE TABLE rp_event_rsvps (
	event_id INTEGER NOT NULL REFERENCES rp_events (id) ON DELETE CASCADE,
	user_id  TEXT NOT NULL,
	status   TEXT NOT NULL CHECK (status IN ('going', 'maybe', 'waitlist')),
	at       INTEGER NOT NULL,
	PRIMARY KEY (event_id, user_id)
);
