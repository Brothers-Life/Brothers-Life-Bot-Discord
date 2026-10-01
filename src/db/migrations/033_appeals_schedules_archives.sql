-- Appeals of a sanction, sent from the DM the bot sends with the sanction
CREATE TABLE sanction_appeals (
	id                INTEGER PRIMARY KEY AUTOINCREMENT,
	sanction_id       INTEGER NOT NULL REFERENCES sanctions (id) ON DELETE CASCADE,
	user_id           TEXT NOT NULL,
	answers           TEXT NOT NULL,
	status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
	decided_by        TEXT,
	decision_reason   TEXT,
	review_channel_id TEXT,
	review_message_id TEXT,
	created_at        INTEGER NOT NULL,
	decided_at        INTEGER
);
CREATE INDEX sanction_appeals_by_sanction ON sanction_appeals (sanction_id, created_at);
CREATE INDEX sanction_appeals_by_status ON sanction_appeals (status, created_at);

-- Opening hours of channels: weekly slots and dated periods
CREATE TABLE channel_schedules (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	guild_id    TEXT NOT NULL,
	name        TEXT NOT NULL,
	channel_ids TEXT NOT NULL,
	mode        TEXT NOT NULL CHECK (mode IN ('open_during', 'closed_during')),
	lock_type   TEXT NOT NULL CHECK (lock_type IN ('write', 'hide')),
	weekly      TEXT NOT NULL DEFAULT '[]',
	dates       TEXT NOT NULL DEFAULT '[]',
	announce    INTEGER NOT NULL DEFAULT 1,
	enabled     INTEGER NOT NULL DEFAULT 1,
	applied     TEXT,
	created_at  INTEGER NOT NULL,
	updated_at  INTEGER NOT NULL
);

-- Channel exports (an HTML file in data/archives)
CREATE TABLE channel_archives (
	id            INTEGER PRIMARY KEY AUTOINCREMENT,
	guild_id      TEXT NOT NULL,
	channel_id    TEXT NOT NULL,
	channel_name  TEXT NOT NULL,
	created_by    TEXT NOT NULL,
	message_count INTEGER NOT NULL,
	first_at      INTEGER,
	last_at       INTEGER,
	file          TEXT NOT NULL,
	size          INTEGER NOT NULL DEFAULT 0,
	created_at    INTEGER NOT NULL
);
