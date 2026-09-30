-- Tickets v2: forms, statuses, several panels, archive, inactivity, ratings
ALTER TABLE ticket_categories ADD COLUMN config TEXT NOT NULL DEFAULT '{}';
ALTER TABLE ticket_settings ADD COLUMN config TEXT NOT NULL DEFAULT '{}';
UPDATE ticket_settings SET config = json_object('maxOpen', max_open);

CREATE TABLE ticket_panels (
	id           INTEGER PRIMARY KEY AUTOINCREMENT,
	guild_id     TEXT NOT NULL,
	name         TEXT NOT NULL,
	channel_id   TEXT,
	message_id   TEXT,
	payload      TEXT NOT NULL,
	style        TEXT NOT NULL DEFAULT 'buttons' CHECK (style IN ('buttons', 'select')),
	placeholder  TEXT,
	-- [] = every ticket type of the server
	category_ids TEXT NOT NULL DEFAULT '[]',
	created_at   INTEGER NOT NULL
);
CREATE INDEX ticket_panels_by_guild ON ticket_panels (guild_id);

-- The single panel of v1 becomes the first panel
INSERT INTO ticket_panels (guild_id, name, channel_id, message_id, payload, style, category_ids, created_at)
SELECT guild_id, 'Panneau principal', panel_channel_id, panel_message_id,
	json_object('content', '', 'embed', json_object(
		'enabled', json('true'),
		'title', COALESCE(panel_title, 'Besoin d’aide ?'),
		'description', COALESCE(panel_text, 'Choisis le type de demande : un salon privé s’ouvre avec l’équipe.'),
		'color', '#d6a249')),
	'buttons', '[]', CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM ticket_settings WHERE panel_channel_id IS NOT NULL;

-- Built-in statuses (open, claimed, closed) + custom ones, each may move the channel to a Discord category
CREATE TABLE ticket_statuses (
	guild_id          TEXT NOT NULL,
	key               TEXT NOT NULL,
	label             TEXT NOT NULL,
	emoji             TEXT,
	color             TEXT,
	parent_channel_id TEXT,
	position          INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (guild_id, key)
);

ALTER TABLE tickets ADD COLUMN answers TEXT;
ALTER TABLE tickets ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE tickets ADD COLUMN status_key TEXT NOT NULL DEFAULT 'open';
ALTER TABLE tickets ADD COLUMN status_history TEXT NOT NULL DEFAULT '[]';
ALTER TABLE tickets ADD COLUMN last_activity_at INTEGER;
ALTER TABLE tickets ADD COLUMN reminded_at INTEGER;
ALTER TABLE tickets ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tickets ADD COLUMN rating INTEGER;
ALTER TABLE tickets ADD COLUMN rating_comment TEXT;
UPDATE tickets SET
	status_key = CASE WHEN status = 'closed' THEN 'closed' WHEN claimed_by IS NOT NULL THEN 'claimed' ELSE 'open' END,
	last_activity_at = created_at;
CREATE INDEX tickets_by_activity ON tickets (status, last_activity_at);

-- Conversation of each ticket, recorded live: the panel shows it and can answer
CREATE TABLE ticket_messages (
	id           TEXT PRIMARY KEY,
	ticket_id    INTEGER NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
	author_id    TEXT,
	author_name  TEXT,
	author_avatar TEXT,
	is_bot       INTEGER NOT NULL DEFAULT 0,
	-- Discord id of the panel user who wrote it from the panel
	panel_user   TEXT,
	content      TEXT,
	attachments  TEXT NOT NULL DEFAULT '[]',
	embeds       TEXT NOT NULL DEFAULT '[]',
	-- Internal note: only in the panel, never sent to Discord
	internal     INTEGER NOT NULL DEFAULT 0,
	created_at   INTEGER NOT NULL,
	edited_at    INTEGER,
	deleted_at   INTEGER
);
CREATE INDEX ticket_messages_by_ticket ON ticket_messages (ticket_id, created_at);
