-- Keys of the public API: only a SHA-256 of the secret is stored, the key itself is shown once
CREATE TABLE api_keys (
	id           INTEGER PRIMARY KEY AUTOINCREMENT,
	name         TEXT NOT NULL,
	owner_id     TEXT NOT NULL,
	prefix       TEXT NOT NULL,
	hash         TEXT NOT NULL UNIQUE,
	-- JSON array of permissions, NULL: every permission of the owner (follows their rank)
	permissions  TEXT,
	created_at   INTEGER NOT NULL,
	expires_at   INTEGER,
	last_used_at INTEGER,
	last_ip      TEXT,
	uses         INTEGER NOT NULL DEFAULT 0,
	revoked_at   INTEGER
);
CREATE INDEX api_keys_by_owner ON api_keys (owner_id);
