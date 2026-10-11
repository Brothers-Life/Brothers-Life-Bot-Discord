-- Files shared by the bot and the API (images sent from the panel, ticket transcripts, channel archives):
-- in the database rather than on one machine's disk, so that each process can run on its own server.
CREATE TABLE `files` (
	`id` VARCHAR(190) PRIMARY KEY,
	`kind` VARCHAR(32) NOT NULL,
	`mime` VARCHAR(100) NOT NULL,
	`size` BIGINT NOT NULL,
	-- 1: stored gzipped (text documents)
	`gzip` TINYINT NOT NULL DEFAULT 0,
	`data` LONGBLOB NOT NULL,
	`created_at` BIGINT NOT NULL,
	INDEX `files_by_kind` (`kind`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
