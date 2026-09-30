-- Rank hierarchy: a rank may inherit the permissions of every lower rank; its staff roles may stay on the main server only
ALTER TABLE ranks ADD COLUMN inherit INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ranks ADD COLUMN sync_roles INTEGER NOT NULL DEFAULT 1;
