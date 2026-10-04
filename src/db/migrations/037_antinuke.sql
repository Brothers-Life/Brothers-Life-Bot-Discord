-- Anti-nuke incidents: a staff account went over a limit of destructive actions and was quarantined
-- (the settings live in the settings table, the action counters in memory)
CREATE TABLE antinuke_incidents (
	id            INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id       TEXT NOT NULL,
	guild_id      TEXT NOT NULL,
	trigger_type  TEXT NOT NULL,
	-- JSON [{ type, guildId, targetId, targetName, at }] of the counted actions
	actions       TEXT NOT NULL,
	-- JSON { guildId: [roleId] } of the roles taken away, given back by "Rendre les rôles"
	removed_roles TEXT NOT NULL,
	-- JSON [{ guildId, roleId, name, reason }] of what could not be done
	failures      TEXT NOT NULL,
	timed_out     INTEGER NOT NULL DEFAULT 0,
	status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'restored', 'dismissed')),
	created_at    INTEGER NOT NULL,
	resolved_at   INTEGER,
	resolved_by   TEXT
);
CREATE INDEX antinuke_incidents_by_user ON antinuke_incidents (user_id, status);
