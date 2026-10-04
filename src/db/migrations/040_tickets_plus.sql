-- Tickets v3: close requests, first staff response and SLA, saved replies
ALTER TABLE tickets ADD COLUMN first_response_at INTEGER;
ALTER TABLE tickets ADD COLUMN first_responder_id TEXT;
-- When the first response delay (SLA) of the type was found exceeded; 0 = ticket older than the SLA tracking
ALTER TABLE tickets ADD COLUMN sla_breached_at INTEGER;
-- A pending "can we close?" question of the staff to the opener
ALTER TABLE tickets ADD COLUMN close_request_at INTEGER;
ALTER TABLE tickets ADD COLUMN close_request_by TEXT;
ALTER TABLE tickets ADD COLUMN close_request_reason TEXT;

CREATE INDEX tickets_by_guild_created ON tickets (guild_id, created_at);

-- First response of the existing tickets, from their recorded conversation (internal notes do not count)
UPDATE tickets SET
	first_response_at = (
		SELECT MIN(m.created_at) FROM ticket_messages m
		WHERE m.ticket_id = tickets.id AND m.internal = 0 AND (m.is_bot = 0 OR m.panel_user IS NOT NULL)
			AND m.author_id IS NOT NULL AND m.author_id != tickets.opener_id
	),
	first_responder_id = (
		SELECT m.author_id FROM ticket_messages m
		WHERE m.ticket_id = tickets.id AND m.internal = 0 AND (m.is_bot = 0 OR m.panel_user IS NOT NULL)
			AND m.author_id IS NOT NULL AND m.author_id != tickets.opener_id
		ORDER BY m.created_at, m.rowid LIMIT 1
	);
-- Open tickets without an answer yet were opened before the SLA existed: no alert for them
UPDATE tickets SET sla_breached_at = 0 WHERE status = 'open' AND first_response_at IS NULL;

CREATE TABLE ticket_replies (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	guild_id    TEXT NOT NULL,
	category_id INTEGER REFERENCES ticket_categories (id) ON DELETE CASCADE,
	name        TEXT NOT NULL,
	content     TEXT NOT NULL,
	uses        INTEGER NOT NULL DEFAULT 0,
	created_by  TEXT,
	created_at  INTEGER NOT NULL,
	updated_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX ticket_replies_by_name ON ticket_replies (guild_id, name COLLATE NOCASE);
