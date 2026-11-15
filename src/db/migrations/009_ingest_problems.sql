-- What the game sent and the panel could not store: a mirror table refused, an insert that failed.
-- One row per thing (a table, a kind of query), with its last error: read by the "Réception des données" page.
CREATE TABLE IF NOT EXISTS ingest_problems (
	source TEXT NOT NULL,
	name TEXT NOT NULL,
	error TEXT NOT NULL,
	first_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	last_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	count BIGINT NOT NULL DEFAULT 1,
	PRIMARY KEY (source, name)
);

-- bl_telemetry 1.6: family of the end of a session (quit, crash, timeout, kick, ban, restart, other)
ALTER TABLE tel_sessions ADD COLUMN IF NOT EXISTS drop_kind TEXT;
