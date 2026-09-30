-- Activity per day, member and channel (bots excluded); voice time only counts with someone else
CREATE TABLE stats_activity (
	guild_id      TEXT NOT NULL,
	day           TEXT NOT NULL,
	user_id       TEXT NOT NULL,
	channel_id    TEXT NOT NULL,
	messages      INTEGER NOT NULL DEFAULT 0,
	voice_seconds INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (guild_id, day, user_id, channel_id)
);
CREATE INDEX stats_activity_by_user ON stats_activity (user_id, day);
CREATE INDEX stats_activity_by_day ON stats_activity (day);

-- Totals per hour (heat map by weekday and hour)
CREATE TABLE stats_hourly (
	guild_id      TEXT NOT NULL,
	hour          INTEGER NOT NULL,
	messages      INTEGER NOT NULL DEFAULT 0,
	voice_seconds INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (guild_id, hour)
);

-- Arrivals, departures and size of each server per day
CREATE TABLE stats_members (
	guild_id     TEXT NOT NULL,
	day          TEXT NOT NULL,
	joins        INTEGER NOT NULL DEFAULT 0,
	leaves       INTEGER NOT NULL DEFAULT 0,
	member_count INTEGER,
	voice_peak   INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (guild_id, day)
);

-- Voice channels renamed with live numbers ("Membres : 1 234")
CREATE TABLE stat_counters (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	guild_id    TEXT NOT NULL,
	channel_id  TEXT NOT NULL UNIQUE,
	template    TEXT NOT NULL,
	last_name   TEXT,
	updated_at  INTEGER,
	created_at  INTEGER NOT NULL
);
