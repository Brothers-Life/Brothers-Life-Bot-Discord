-- Mirror of the FiveM (Qbox) database, sent by the bl_telemetry resource (POST /v1/mirror): the panel reads
-- the game's tables here instead of connecting to MariaDB. The tables of the schema "fivem" keep the names and
-- columns of the game (created by src/core/fivem/mirror.js from what the resource sends); never written by hand.

CREATE SCHEMA IF NOT EXISTS fivem;

-- JSON columns of the game are kept as text: invalid JSON gives NULL instead of failing the whole query
CREATE OR REPLACE FUNCTION fivem.j(value TEXT) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
	RETURN value::jsonb;
EXCEPTION WHEN others THEN
	RETURN NULL;
END;
$$;

-- One row per mirrored table: its columns as received, where the resource is (cursor), its last sync
CREATE TABLE IF NOT EXISTS fivem_mirror_tables (
	name TEXT PRIMARY KEY,
	columns JSONB NOT NULL,
	pk TEXT[] NOT NULL DEFAULT '{}',
	schema_hash TEXT NOT NULL,
	mode TEXT NOT NULL,
	cursor TEXT,
	checksum TEXT,
	row_count BIGINT NOT NULL DEFAULT 0,
	synced_at BIGINT NOT NULL,
	full_at BIGINT
);
