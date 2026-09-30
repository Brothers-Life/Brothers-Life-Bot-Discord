-- Servers known by the bot. Only 'active' ones are part of the network.
CREATE TABLE guilds (
	id                TEXT PRIMARY KEY,
	name              TEXT NOT NULL,
	icon              TEXT,
	status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'removed')),
	is_main           INTEGER NOT NULL DEFAULT 0 CHECK (is_main IN (0, 1)),
	bot_present       INTEGER NOT NULL DEFAULT 1 CHECK (bot_present IN (0, 1)),
	joined_network_at INTEGER,
	first_seen_at     INTEGER NOT NULL,
	updated_at        INTEGER NOT NULL
);
-- At most one main server
CREATE UNIQUE INDEX guilds_single_main ON guilds (is_main) WHERE is_main = 1;

CREATE TABLE ranks (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	name       TEXT NOT NULL UNIQUE,
	level      INTEGER NOT NULL CHECK (level BETWEEN 0 AND 100),
	color      TEXT,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE TABLE rank_permissions (
	rank_id    INTEGER NOT NULL REFERENCES ranks (id) ON DELETE CASCADE,
	permission TEXT NOT NULL,
	PRIMARY KEY (rank_id, permission)
);

-- Discord roles that grant a rank
CREATE TABLE rank_roles (
	rank_id  INTEGER NOT NULL REFERENCES ranks (id) ON DELETE CASCADE,
	guild_id TEXT NOT NULL,
	role_id  TEXT NOT NULL,
	PRIMARY KEY (rank_id, guild_id, role_id)
);
CREATE INDEX rank_roles_by_role ON rank_roles (guild_id, role_id);

-- Ranks granted directly to a user, without any Discord role
CREATE TABLE user_ranks (
	discord_id TEXT NOT NULL,
	rank_id    INTEGER NOT NULL REFERENCES ranks (id) ON DELETE CASCADE,
	added_by   TEXT NOT NULL,
	added_at   INTEGER NOT NULL,
	PRIMARY KEY (discord_id, rank_id)
);

CREATE TABLE sessions (
	id           TEXT PRIMARY KEY,
	discord_id   TEXT NOT NULL,
	username     TEXT,
	avatar       TEXT,
	created_at   INTEGER NOT NULL,
	last_seen_at INTEGER NOT NULL,
	expires_at   INTEGER NOT NULL,
	ip           TEXT,
	user_agent   TEXT
);
CREATE INDEX sessions_by_user ON sessions (discord_id);

CREATE TABLE audit_log (
	id       INTEGER PRIMARY KEY AUTOINCREMENT,
	at       INTEGER NOT NULL,
	actor_id TEXT NOT NULL,
	source   TEXT NOT NULL CHECK (source IN ('bot', 'panel', 'native', 'system')),
	action   TEXT NOT NULL,
	guild_id TEXT,
	target   TEXT,
	details  TEXT,
	results  TEXT
);
CREATE INDEX audit_by_at ON audit_log (at);
CREATE INDEX audit_by_actor ON audit_log (actor_id, at);
CREATE INDEX audit_by_action ON audit_log (action, at);
CREATE INDEX audit_by_guild ON audit_log (guild_id, at);

-- guild_id '*' = network mirror (channel on the main server)
CREATE TABLE log_routes (
	guild_id   TEXT NOT NULL,
	category   TEXT NOT NULL,
	channel_id TEXT NOT NULL,
	enabled    INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
	PRIMARY KEY (guild_id, category)
);

CREATE TABLE settings (
	key   TEXT PRIMARY KEY,
	value TEXT NOT NULL
);
