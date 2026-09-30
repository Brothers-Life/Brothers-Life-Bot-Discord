-- Polls posted in one or several channels of the network; votes counted together
CREATE TABLE polls (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	question    TEXT NOT NULL,
	description TEXT NOT NULL DEFAULT '',
	options     TEXT NOT NULL,
	settings    TEXT NOT NULL,
	targets     TEXT NOT NULL DEFAULT '[]',
	messages    TEXT NOT NULL DEFAULT '[]',
	status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'open', 'closed')),
	starts_at   INTEGER,
	ends_at     INTEGER,
	created_by  TEXT NOT NULL,
	created_at  INTEGER NOT NULL,
	updated_at  INTEGER NOT NULL,
	opened_at   INTEGER,
	closed_at   INTEGER
);
CREATE INDEX polls_by_status ON polls (status, ends_at);

CREATE TABLE poll_votes (
	poll_id  INTEGER NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
	user_id  TEXT NOT NULL,
	choice   TEXT NOT NULL,
	guild_id TEXT,
	at       INTEGER NOT NULL,
	PRIMARY KEY (poll_id, user_id, choice)
);
