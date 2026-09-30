-- Giveaways posted in one or several channels; entries counted together
CREATE TABLE giveaways (
	id            INTEGER PRIMARY KEY AUTOINCREMENT,
	prize         TEXT NOT NULL,
	description   TEXT NOT NULL DEFAULT '',
	winners_count INTEGER NOT NULL DEFAULT 1,
	settings      TEXT NOT NULL,
	targets       TEXT NOT NULL DEFAULT '[]',
	messages      TEXT NOT NULL DEFAULT '[]',
	status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'open', 'ended', 'cancelled')),
	starts_at     INTEGER,
	ends_at       INTEGER NOT NULL,
	draw          TEXT,
	created_by    TEXT NOT NULL,
	created_at    INTEGER NOT NULL,
	updated_at    INTEGER NOT NULL,
	ended_at      INTEGER
);
CREATE INDEX giveaways_by_status ON giveaways (status, ends_at);

CREATE TABLE giveaway_entries (
	giveaway_id INTEGER NOT NULL REFERENCES giveaways (id) ON DELETE CASCADE,
	user_id     TEXT NOT NULL,
	guild_id    TEXT NOT NULL,
	entries     INTEGER NOT NULL DEFAULT 1,
	at          INTEGER NOT NULL,
	PRIMARY KEY (giveaway_id, user_id)
);

CREATE TABLE giveaway_winners (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	giveaway_id INTEGER NOT NULL REFERENCES giveaways (id) ON DELETE CASCADE,
	user_id     TEXT NOT NULL,
	status      TEXT NOT NULL DEFAULT 'winner' CHECK (status IN ('winner', 'rerolled', 'expired')),
	drawn_at    INTEGER NOT NULL,
	claimed_at  INTEGER
);
CREATE INDEX giveaway_winners_by_user ON giveaway_winners (user_id, drawn_at);
