-- Server templates: photos of model servers, recreated on other servers of the network
CREATE TABLE server_templates (
	id              INTEGER PRIMARY KEY AUTOINCREMENT,
	name            TEXT NOT NULL,
	description     TEXT,
	source_guild_id TEXT NOT NULL,
	snapshot        TEXT NOT NULL,
	captured_at     INTEGER NOT NULL,
	created_by      TEXT NOT NULL,
	created_at      INTEGER NOT NULL
);

-- Last template applied on each target, with the id correspondence (model -> target) used to repair later
CREATE TABLE template_applications (
	guild_id    TEXT PRIMARY KEY,
	template_id INTEGER REFERENCES server_templates (id) ON DELETE SET NULL,
	mapping     TEXT NOT NULL,
	mode        TEXT NOT NULL CHECK (mode IN ('reset', 'repair')),
	status      TEXT NOT NULL CHECK (status IN ('done', 'failed')),
	report      TEXT NOT NULL,
	applied_at  INTEGER NOT NULL,
	applied_by  TEXT NOT NULL
);
