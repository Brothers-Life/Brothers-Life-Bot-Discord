CREATE TABLE sanctions (
	id              INTEGER PRIMARY KEY AUTOINCREMENT,
	type            TEXT NOT NULL CHECK (type IN ('ban', 'kick', 'timeout', 'warn')),
	user_id         TEXT NOT NULL,
	user_name       TEXT,
	moderator_id    TEXT NOT NULL,
	source          TEXT NOT NULL CHECK (source IN ('bot', 'panel', 'native', 'automod', 'system')),
	origin_guild_id TEXT,
	scope           TEXT NOT NULL CHECK (scope IN ('network', 'local')),
	reason          TEXT,
	created_at      INTEGER NOT NULL,
	expires_at      INTEGER,
	revoked_at      INTEGER,
	revoked_by      TEXT,
	revoke_reason   TEXT,
	results         TEXT
);
CREATE INDEX sanctions_by_user ON sanctions (user_id, created_at);
CREATE INDEX sanctions_by_type ON sanctions (type, created_at);
CREATE INDEX sanctions_active_bans ON sanctions (type, revoked_at, expires_at);
