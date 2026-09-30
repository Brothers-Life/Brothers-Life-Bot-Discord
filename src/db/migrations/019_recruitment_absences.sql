-- Staff recruitment: positions with their own application form, applications, staff votes
CREATE TABLE recruit_positions (
	id               INTEGER PRIMARY KEY AUTOINCREMENT,
	guild_id         TEXT NOT NULL,
	name             TEXT NOT NULL,
	description      TEXT NOT NULL DEFAULT '',
	config           TEXT NOT NULL,
	panel_channel_id TEXT,
	panel_message_id TEXT,
	created_at       INTEGER NOT NULL
);

CREATE TABLE recruit_applications (
	id                   INTEGER PRIMARY KEY AUTOINCREMENT,
	position_id          INTEGER NOT NULL REFERENCES recruit_positions (id) ON DELETE CASCADE,
	guild_id             TEXT NOT NULL,
	user_id              TEXT NOT NULL,
	user_name            TEXT,
	answers              TEXT NOT NULL,
	status               TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'review', 'interview', 'accepted', 'rejected', 'withdrawn')),
	history              TEXT NOT NULL DEFAULT '[]',
	notes                TEXT NOT NULL DEFAULT '[]',
	review_channel_id    TEXT,
	review_message_id    TEXT,
	thread_id            TEXT,
	interview_channel_id TEXT,
	decided_by           TEXT,
	decided_at           INTEGER,
	created_at           INTEGER NOT NULL,
	updated_at           INTEGER NOT NULL
);
CREATE INDEX recruit_applications_by_user ON recruit_applications (user_id, position_id, created_at);

CREATE TABLE recruit_votes (
	application_id INTEGER NOT NULL REFERENCES recruit_applications (id) ON DELETE CASCADE,
	user_id        TEXT NOT NULL,
	vote           INTEGER NOT NULL CHECK (vote IN (-1, 0, 1)),
	comment        TEXT,
	at             INTEGER NOT NULL,
	PRIMARY KEY (application_id, user_id)
);

-- Staff absences: declared, possibly approved, applied (role, nickname) while they last
CREATE TABLE absences (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id     TEXT NOT NULL,
	start_at    INTEGER NOT NULL,
	end_at      INTEGER NOT NULL,
	reason      TEXT,
	status      TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'active', 'ended', 'rejected', 'cancelled')),
	declared_by TEXT NOT NULL,
	reviewed_by TEXT,
	reviewed_at INTEGER,
	reminded_at INTEGER,
	applied     TEXT NOT NULL DEFAULT '{}',
	created_at  INTEGER NOT NULL,
	ended_at    INTEGER
);
CREATE INDEX absences_by_status ON absences (status, start_at, end_at);
CREATE INDEX absences_by_user ON absences (user_id, start_at);
