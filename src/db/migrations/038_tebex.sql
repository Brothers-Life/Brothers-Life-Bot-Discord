-- Tebex store: payments read by polling the Plugin API, with the Discord member they were linked to
CREATE TABLE tebex_payments (
	-- Payment id given by Tebex
	id              INTEGER PRIMARY KEY,
	status          TEXT NOT NULL,
	amount          TEXT,
	currency        TEXT,
	player_uuid     TEXT,
	player_name     TEXT,
	-- JSON [{ id, name }]
	packages        TEXT NOT NULL DEFAULT '[]',
	paid_at         INTEGER,
	seen_at         INTEGER NOT NULL,
	-- 1: already there when the store was connected, nothing is done for it
	baseline        INTEGER NOT NULL DEFAULT 0,
	discord_id      TEXT,
	-- fivem, license, name (read from the FiveM database), known (earlier manual link), manual
	link_method     TEXT,
	link_checked_at INTEGER,
	logged_at       INTEGER,
	applied_at      INTEGER,
	revoked_at      INTEGER,
	error           TEXT
);
CREATE INDEX tebex_payments_by_discord ON tebex_payments (discord_id);

-- Roles given for a payment, removed on refund or chargeback
CREATE TABLE tebex_grants (
	id           INTEGER PRIMARY KEY AUTOINCREMENT,
	payment_id   INTEGER NOT NULL REFERENCES tebex_payments (id) ON DELETE CASCADE,
	guild_id     TEXT NOT NULL,
	user_id      TEXT NOT NULL,
	role_id      TEXT NOT NULL,
	temp_role_id INTEGER,
	granted_at   INTEGER NOT NULL,
	removed_at   INTEGER
);
CREATE INDEX tebex_grants_by_payment ON tebex_grants (payment_id);

-- Tebex buyer -> Discord member, remembered from a manual link so the next purchases link alone
CREATE TABLE tebex_links (
	player_uuid TEXT PRIMARY KEY,
	discord_id  TEXT NOT NULL,
	created_by  TEXT NOT NULL,
	created_at  INTEGER NOT NULL
);
