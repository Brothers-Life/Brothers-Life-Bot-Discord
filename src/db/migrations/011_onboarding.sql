-- Welcome / leave / boost messages, image cards, automatic roles and rules of each server
CREATE TABLE onboarding_config (
	guild_id   TEXT PRIMARY KEY,
	config     TEXT NOT NULL,
	updated_at INTEGER NOT NULL,
	updated_by TEXT NOT NULL
);
