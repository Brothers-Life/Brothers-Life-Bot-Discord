-- Restrictions ("punishment roles") become a sanction type: rebuild the table to widen the CHECK
CREATE TABLE sanctions_new (
	id              INTEGER PRIMARY KEY AUTOINCREMENT,
	type            TEXT NOT NULL CHECK (type IN ('ban', 'kick', 'timeout', 'warn', 'restrict')),
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
	results         TEXT,
	-- restrict: key of the restriction profile
	profile         TEXT
);
INSERT INTO sanctions_new (id, type, user_id, user_name, moderator_id, source, origin_guild_id, scope, reason, created_at, expires_at, revoked_at, revoked_by, revoke_reason, results)
SELECT id, type, user_id, user_name, moderator_id, source, origin_guild_id, scope, reason, created_at, expires_at, revoked_at, revoked_by, revoke_reason, results FROM sanctions;
DROP TABLE sanctions;
ALTER TABLE sanctions_new RENAME TO sanctions;
CREATE INDEX sanctions_by_user ON sanctions (user_id, created_at);
CREATE INDEX sanctions_by_type ON sanctions (type, created_at);
CREATE INDEX sanctions_active_bans ON sanctions (type, revoked_at, expires_at);

-- What a restriction forbids (names of Discord permissions denied on every channel)
CREATE TABLE restriction_profiles (
	key        TEXT PRIMARY KEY,
	label      TEXT NOT NULL,
	deny       TEXT NOT NULL,
	position   INTEGER NOT NULL DEFAULT 0
);
INSERT INTO restriction_profiles (key, label, deny, position) VALUES
	('mute_text', 'Muet écrit', '["SendMessages","SendMessagesInThreads","CreatePublicThreads","CreatePrivateThreads","AddReactions"]', 0),
	('mute_voice', 'Muet vocal', '["Speak","Stream","UseSoundboard"]', 1),
	('no_voice', 'Pas de vocal', '["Connect"]', 2),
	('no_media', 'Pas d’images', '["AttachFiles","EmbedLinks"]', 3);

-- Role the bot created for each profile on each server
CREATE TABLE restriction_roles (
	guild_id    TEXT NOT NULL,
	profile_key TEXT NOT NULL,
	role_id     TEXT NOT NULL,
	PRIMARY KEY (guild_id, profile_key)
);

-- Roles given for a limited time
CREATE TABLE temp_roles (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	guild_id   TEXT NOT NULL,
	user_id    TEXT NOT NULL,
	role_id    TEXT NOT NULL,
	role_name  TEXT,
	expires_at INTEGER NOT NULL,
	reason     TEXT,
	created_by TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	removed_at INTEGER,
	removed_by TEXT
);
CREATE INDEX temp_roles_due ON temp_roles (removed_at, expires_at);
CREATE INDEX temp_roles_by_user ON temp_roles (user_id, removed_at);
