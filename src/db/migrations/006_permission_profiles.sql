-- Discord permissions that every role linked to a rank must have, on every server
CREATE TABLE permission_profiles (
	rank_id     INTEGER PRIMARY KEY REFERENCES ranks (id) ON DELETE CASCADE,
	permissions TEXT NOT NULL,
	updated_at  INTEGER NOT NULL,
	updated_by  TEXT NOT NULL
);
