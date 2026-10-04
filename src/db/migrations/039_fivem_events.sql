-- Events received from the txAdmin bridge (FiveM resource fivem/brl-bridge): what came in and what the bot did with it.
-- Settings (announcements per event, maintenance) live in the settings table (fivemEvents.*).
CREATE TABLE fivem_events (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	type        TEXT NOT NULL,
	server      TEXT,
	-- JSON of the cleaned event data (no player identifiers besides a Discord ID)
	data        TEXT NOT NULL,
	-- posted | logged | disabled | ignored | duplicate | muted | failed
	status      TEXT NOT NULL,
	detail      TEXT,
	test        INTEGER NOT NULL DEFAULT 0,
	received_at INTEGER NOT NULL
);
CREATE INDEX fivem_events_by_time ON fivem_events (received_at);
