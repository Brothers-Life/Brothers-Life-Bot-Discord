-- When each periodic reading of the game last arrived. A reading with nothing in it (no money moved in the window)
-- stores no row of its own: without this, it would look like the game never sends it.
CREATE TABLE IF NOT EXISTS tel_reading_receipts (
	type TEXT PRIMARY KEY,
	last_at TIMESTAMPTZ NOT NULL,
	count BIGINT NOT NULL DEFAULT 1
);
