-- Staff meetings: convocation, answers, attendance in the voice channel, minutes and follow-up tasks
CREATE TABLE meetings (
	id                  INTEGER PRIMARY KEY AUTOINCREMENT,
	guild_id            TEXT NOT NULL,
	title               TEXT NOT NULL,
	description         TEXT NOT NULL DEFAULT '',
	agenda              TEXT NOT NULL DEFAULT '[]',
	starts_at           INTEGER NOT NULL,
	duration_minutes    INTEGER NOT NULL DEFAULT 60,
	voice_channel_id    TEXT NOT NULL,
	announce_channel_id TEXT,
	invites             TEXT NOT NULL DEFAULT '{}',
	reminders           TEXT NOT NULL DEFAULT '[1440, 60, 10]',
	reminded            TEXT NOT NULL DEFAULT '[]',
	recurrence          TEXT,
	status              TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'live', 'ended', 'cancelled')),
	started_at          INTEGER,
	ended_at            INTEGER,
	notes               TEXT NOT NULL DEFAULT '',
	message_id          TEXT,
	created_by          TEXT NOT NULL,
	created_at          INTEGER NOT NULL,
	updated_at          INTEGER NOT NULL
);
CREATE INDEX meetings_by_status ON meetings (status, starts_at);

CREATE TABLE meeting_invites (
	meeting_id   INTEGER NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
	user_id      TEXT NOT NULL,
	rsvp         TEXT NOT NULL DEFAULT 'pending' CHECK (rsvp IN ('pending', 'yes', 'maybe', 'no')),
	reason       TEXT,
	responded_at INTEGER,
	PRIMARY KEY (meeting_id, user_id)
);

-- Time spent in the voice channel of the meeting (one row per stay)
CREATE TABLE meeting_attendance (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	meeting_id INTEGER NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
	user_id    TEXT NOT NULL,
	joined_at  INTEGER NOT NULL,
	left_at    INTEGER
);
CREATE INDEX meeting_attendance_by_meeting ON meeting_attendance (meeting_id, user_id);

-- Follow-up tasks decided in a meeting
CREATE TABLE meeting_actions (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	meeting_id  INTEGER NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
	text        TEXT NOT NULL,
	assignee_id TEXT,
	due_at      INTEGER,
	done_at     INTEGER,
	created_at  INTEGER NOT NULL
);
