-- Saved music playlists: personal, or shared with everyone on the network
CREATE TABLE music_playlists (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	name       TEXT NOT NULL,
	owner_id   TEXT NOT NULL,
	shared     INTEGER NOT NULL DEFAULT 1,
	tracks     TEXT NOT NULL DEFAULT '[]',
	plays      INTEGER NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);
CREATE INDEX music_playlists_by_owner ON music_playlists (owner_id);
