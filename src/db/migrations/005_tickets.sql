-- Ticket settings of a server: where the opening panel is posted, how many tickets a member may have open
CREATE TABLE ticket_settings (
	guild_id         TEXT PRIMARY KEY,
	panel_channel_id TEXT,
	panel_message_id TEXT,
	panel_title      TEXT,
	panel_text       TEXT,
	max_open         INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE ticket_categories (
	id                INTEGER PRIMARY KEY AUTOINCREMENT,
	guild_id          TEXT NOT NULL,
	name              TEXT NOT NULL,
	emoji             TEXT,
	description       TEXT,
	parent_channel_id TEXT,
	rank_ids          TEXT NOT NULL DEFAULT '[]',
	role_ids          TEXT NOT NULL DEFAULT '[]',
	position          INTEGER NOT NULL DEFAULT 0,
	created_at        INTEGER NOT NULL
);
CREATE INDEX ticket_categories_by_guild ON ticket_categories (guild_id, position);

CREATE TABLE tickets (
	id           INTEGER PRIMARY KEY AUTOINCREMENT,
	guild_id     TEXT NOT NULL,
	number       INTEGER NOT NULL,
	category_id  INTEGER,
	channel_id   TEXT,
	opener_id    TEXT NOT NULL,
	opener_name  TEXT,
	subject      TEXT,
	status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
	claimed_by   TEXT,
	created_at   INTEGER NOT NULL,
	closed_at    INTEGER,
	closed_by    TEXT,
	close_reason TEXT,
	transcript   TEXT,
	UNIQUE (guild_id, number)
);
CREATE INDEX tickets_by_status ON tickets (status, created_at);
CREATE INDEX tickets_by_opener ON tickets (opener_id, status);
CREATE INDEX tickets_by_channel ON tickets (channel_id);
