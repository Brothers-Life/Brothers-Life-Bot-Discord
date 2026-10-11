-- MariaDB schema of the bot (bot, API and panel share it).
-- Consolidates the 43 SQLite migrations of v1.11.0; later changes come as 002_*.sql, 003_*.sql…
-- Tables use utf8mb4_bin (exact comparisons, like SQLite); columns that were COLLATE NOCASE use utf8mb4_unicode_ci.

CREATE TABLE `guilds` (
	`id` VARCHAR(190) PRIMARY KEY,
	`name` LONGTEXT NOT NULL,
	`icon` LONGTEXT,
	`status` LONGTEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'removed')),
	`is_main` BIGINT NOT NULL DEFAULT 0 CHECK (is_main IN (0, 1)),
	`bot_present` BIGINT NOT NULL DEFAULT 1 CHECK (bot_present IN (0, 1)),
	`joined_network_at` BIGINT,
	`first_seen_at` BIGINT NOT NULL,
	`updated_at` BIGINT NOT NULL,
	-- Only one main server: NULL for the others (MariaDB has no partial unique index)
	`main_flag` TINYINT AS (IF(`is_main` = 1, 1, NULL)) PERSISTENT INVISIBLE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `ranks` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`name` VARCHAR(190) NOT NULL UNIQUE,
	`level` BIGINT NOT NULL CHECK (level BETWEEN 0 AND 100),
	`color` LONGTEXT,
	`created_at` BIGINT NOT NULL,
	`updated_at` BIGINT NOT NULL,
	`inherit` BIGINT NOT NULL DEFAULT 0,
	`sync_roles` BIGINT NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `rank_permissions` (
	`rank_id` BIGINT NOT NULL,
	`permission` VARCHAR(190) NOT NULL,
	FOREIGN KEY (`rank_id`) REFERENCES `ranks` (`id`) ON DELETE CASCADE,
	PRIMARY KEY (`rank_id`, `permission`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `rank_roles` (
	`rank_id` BIGINT NOT NULL,
	`guild_id` VARCHAR(190) NOT NULL,
	`role_id` VARCHAR(190) NOT NULL,
	FOREIGN KEY (`rank_id`) REFERENCES `ranks` (`id`) ON DELETE CASCADE,
	PRIMARY KEY (`rank_id`, `guild_id`, `role_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `user_ranks` (
	`discord_id` VARCHAR(190) NOT NULL,
	`rank_id` BIGINT NOT NULL,
	`added_by` LONGTEXT NOT NULL,
	`added_at` BIGINT NOT NULL,
	FOREIGN KEY (`rank_id`) REFERENCES `ranks` (`id`) ON DELETE CASCADE,
	PRIMARY KEY (`discord_id`, `rank_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `sessions` (
	`id` VARCHAR(190) PRIMARY KEY,
	`discord_id` VARCHAR(190) NOT NULL,
	`username` LONGTEXT,
	`avatar` LONGTEXT,
	`created_at` BIGINT NOT NULL,
	`last_seen_at` BIGINT NOT NULL,
	`expires_at` BIGINT NOT NULL,
	`ip` LONGTEXT,
	`user_agent` LONGTEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `audit_log` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`at` BIGINT NOT NULL,
	`actor_id` VARCHAR(190) NOT NULL,
	`source` LONGTEXT NOT NULL CHECK (source IN ('bot', 'panel', 'native', 'system')),
	`action` VARCHAR(190) NOT NULL,
	`guild_id` VARCHAR(190),
	`target` LONGTEXT,
	`details` LONGTEXT,
	`results` LONGTEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `log_routes` (
	`guild_id` VARCHAR(190) NOT NULL,
	`category` VARCHAR(190) NOT NULL,
	`channel_id` LONGTEXT NOT NULL,
	`enabled` BIGINT NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
	PRIMARY KEY (`guild_id`, `category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `settings` (
	`key` VARCHAR(190) PRIMARY KEY,
	`value` LONGTEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `events` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`at` BIGINT NOT NULL,
	`guild_id` VARCHAR(190) NOT NULL,
	`category` VARCHAR(190) NOT NULL,
	`type` LONGTEXT NOT NULL,
	`user_id` VARCHAR(190),
	`actor_id` LONGTEXT,
	`channel_id` LONGTEXT,
	`summary` LONGTEXT NOT NULL,
	`details` LONGTEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `automod_config` (
	`guild_id` VARCHAR(190) PRIMARY KEY,
	`config` LONGTEXT NOT NULL,
	`updated_at` BIGINT NOT NULL,
	`updated_by` LONGTEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `ticket_settings` (
	`guild_id` VARCHAR(190) PRIMARY KEY,
	`panel_channel_id` LONGTEXT,
	`panel_message_id` LONGTEXT,
	`panel_title` LONGTEXT,
	`panel_text` LONGTEXT,
	`max_open` BIGINT NOT NULL DEFAULT 1,
	`config` LONGTEXT NOT NULL DEFAULT '{}'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `ticket_categories` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`guild_id` VARCHAR(190) NOT NULL,
	`name` LONGTEXT NOT NULL,
	`emoji` LONGTEXT,
	`description` LONGTEXT,
	`parent_channel_id` LONGTEXT,
	`rank_ids` LONGTEXT NOT NULL DEFAULT '[]',
	`role_ids` LONGTEXT NOT NULL DEFAULT '[]',
	`position` BIGINT NOT NULL DEFAULT 0,
	`created_at` BIGINT NOT NULL,
	`transcript_channel_id` LONGTEXT,
	`config` LONGTEXT NOT NULL DEFAULT '{}'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `tickets` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`guild_id` VARCHAR(190) NOT NULL,
	`number` BIGINT NOT NULL,
	`category_id` BIGINT,
	`channel_id` VARCHAR(190),
	`opener_id` VARCHAR(190) NOT NULL,
	`opener_name` LONGTEXT,
	`subject` LONGTEXT,
	`status` VARCHAR(190) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
	`claimed_by` LONGTEXT,
	`created_at` BIGINT NOT NULL,
	`closed_at` BIGINT,
	`closed_by` LONGTEXT,
	`close_reason` LONGTEXT,
	`transcript` LONGTEXT,
	`answers` LONGTEXT,
	`priority` LONGTEXT NOT NULL DEFAULT 'normal',
	`status_key` LONGTEXT NOT NULL DEFAULT 'open',
	`status_history` LONGTEXT NOT NULL DEFAULT '[]',
	`last_activity_at` BIGINT,
	`reminded_at` BIGINT,
	`archived` BIGINT NOT NULL DEFAULT 0,
	`rating` BIGINT,
	`rating_comment` LONGTEXT,
	`vars` LONGTEXT,
	`first_response_at` BIGINT,
	`first_responder_id` LONGTEXT,
	`sla_breached_at` BIGINT,
	`close_request_at` BIGINT,
	`close_request_by` LONGTEXT,
	`close_request_reason` LONGTEXT,
	UNIQUE (`guild_id`, `number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `permission_profiles` (
	`rank_id` BIGINT PRIMARY KEY,
	`permissions` LONGTEXT NOT NULL,
	`updated_at` BIGINT NOT NULL,
	`updated_by` LONGTEXT NOT NULL,
	FOREIGN KEY (`rank_id`) REFERENCES `ranks` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `announcements` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`name` LONGTEXT NOT NULL,
	`payload` LONGTEXT NOT NULL,
	`targets` LONGTEXT NOT NULL,
	`status` VARCHAR(190) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'partial', 'failed', 'deleted')),
	`scheduled_at` BIGINT,
	`sent_at` BIGINT,
	`results` LONGTEXT,
	`created_by` LONGTEXT NOT NULL,
	`created_at` BIGINT NOT NULL,
	`updated_at` BIGINT NOT NULL,
	`options` LONGTEXT NOT NULL DEFAULT '{}',
	`recurrence` LONGTEXT,
	`run_count` BIGINT NOT NULL DEFAULT 0,
	`history` LONGTEXT NOT NULL DEFAULT '[]'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `ticket_panels` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`guild_id` VARCHAR(190) NOT NULL,
	`name` LONGTEXT NOT NULL,
	`channel_id` LONGTEXT,
	`message_id` LONGTEXT,
	`payload` LONGTEXT NOT NULL,
	`style` LONGTEXT NOT NULL DEFAULT 'buttons' CHECK (style IN ('buttons', 'select')),
	`placeholder` LONGTEXT,
	-- [] = every ticket type of the server
	`category_ids` LONGTEXT NOT NULL DEFAULT '[]',
	`created_at` BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `ticket_statuses` (
	`guild_id` VARCHAR(190) NOT NULL,
	`key` VARCHAR(190) NOT NULL,
	`label` LONGTEXT NOT NULL,
	`emoji` LONGTEXT,
	`color` LONGTEXT,
	`parent_channel_id` LONGTEXT,
	`position` BIGINT NOT NULL DEFAULT 0,
	PRIMARY KEY (`guild_id`, `key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `ticket_messages` (
	`id` VARCHAR(190) PRIMARY KEY,
	`ticket_id` BIGINT NOT NULL,
	`author_id` LONGTEXT,
	`author_name` LONGTEXT,
	`author_avatar` LONGTEXT,
	`is_bot` BIGINT NOT NULL DEFAULT 0,
	-- Discord id of the panel user who wrote it from the panel
	`panel_user` LONGTEXT,
	`content` LONGTEXT,
	`attachments` LONGTEXT NOT NULL DEFAULT '[]',
	`embeds` LONGTEXT NOT NULL DEFAULT '[]',
	-- Internal note: only in the panel, never sent to Discord
	`internal` BIGINT NOT NULL DEFAULT 0,
	`created_at` BIGINT NOT NULL,
	`edited_at` BIGINT,
	`deleted_at` BIGINT,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `sanctions` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`type` VARCHAR(190) NOT NULL CHECK (type IN ('ban', 'kick', 'timeout', 'warn', 'restrict')),
	`user_id` VARCHAR(190) NOT NULL,
	`user_name` LONGTEXT,
	`moderator_id` LONGTEXT NOT NULL,
	`source` LONGTEXT NOT NULL CHECK (source IN ('bot', 'panel', 'native', 'automod', 'system')),
	`origin_guild_id` LONGTEXT,
	`scope` LONGTEXT NOT NULL CHECK (scope IN ('network', 'local')),
	`reason` LONGTEXT,
	`created_at` BIGINT NOT NULL,
	`expires_at` BIGINT,
	`revoked_at` BIGINT,
	`revoked_by` LONGTEXT,
	`revoke_reason` LONGTEXT,
	`results` LONGTEXT,
	-- restrict: key of the restriction profile
	`profile` LONGTEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `restriction_profiles` (
	`key` VARCHAR(190) PRIMARY KEY,
	`label` LONGTEXT NOT NULL,
	`deny` LONGTEXT NOT NULL,
	`position` BIGINT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `restriction_roles` (
	`guild_id` VARCHAR(190) NOT NULL,
	`profile_key` VARCHAR(190) NOT NULL,
	`role_id` LONGTEXT NOT NULL,
	PRIMARY KEY (`guild_id`, `profile_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `temp_roles` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`guild_id` LONGTEXT NOT NULL,
	`user_id` VARCHAR(190) NOT NULL,
	`role_id` LONGTEXT NOT NULL,
	`role_name` LONGTEXT,
	`expires_at` BIGINT NOT NULL,
	`reason` LONGTEXT,
	`created_by` LONGTEXT NOT NULL,
	`created_at` BIGINT NOT NULL,
	`removed_at` BIGINT,
	`removed_by` LONGTEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `onboarding_config` (
	`guild_id` VARCHAR(190) PRIMARY KEY,
	`config` LONGTEXT NOT NULL,
	`updated_at` BIGINT NOT NULL,
	`updated_by` LONGTEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `antiraid_config` (
	`guild_id` VARCHAR(190) PRIMARY KEY,
	`config` LONGTEXT NOT NULL,
	`updated_at` BIGINT NOT NULL,
	`updated_by` LONGTEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `stats_activity` (
	`guild_id` VARCHAR(190) NOT NULL,
	`day` VARCHAR(190) NOT NULL,
	`user_id` VARCHAR(190) NOT NULL,
	`channel_id` VARCHAR(190) NOT NULL,
	`messages` BIGINT NOT NULL DEFAULT 0,
	`voice_seconds` BIGINT NOT NULL DEFAULT 0,
	PRIMARY KEY (`guild_id`, `day`, `user_id`, `channel_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `stats_hourly` (
	`guild_id` VARCHAR(190) NOT NULL,
	`hour` BIGINT NOT NULL,
	`messages` BIGINT NOT NULL DEFAULT 0,
	`voice_seconds` BIGINT NOT NULL DEFAULT 0,
	PRIMARY KEY (`guild_id`, `hour`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `stats_members` (
	`guild_id` VARCHAR(190) NOT NULL,
	`day` VARCHAR(190) NOT NULL,
	`joins` BIGINT NOT NULL DEFAULT 0,
	`leaves` BIGINT NOT NULL DEFAULT 0,
	`member_count` BIGINT,
	`voice_peak` BIGINT NOT NULL DEFAULT 0,
	PRIMARY KEY (`guild_id`, `day`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `stat_counters` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`guild_id` LONGTEXT NOT NULL,
	`channel_id` VARCHAR(190) NOT NULL UNIQUE,
	`template` LONGTEXT NOT NULL,
	`last_name` LONGTEXT,
	`updated_at` BIGINT,
	`created_at` BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `voice_hubs` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`guild_id` LONGTEXT NOT NULL,
	`channel_id` VARCHAR(190) NOT NULL UNIQUE,
	`config` LONGTEXT NOT NULL,
	`created_at` BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `voice_rooms` (
	`channel_id` VARCHAR(190) PRIMARY KEY,
	`guild_id` VARCHAR(190) NOT NULL,
	`hub_id` BIGINT,
	`owner_id` VARCHAR(190) NOT NULL,
	`state` LONGTEXT NOT NULL DEFAULT '{}',
	`created_at` BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `voice_prefs` (
	`user_id` VARCHAR(190) NOT NULL,
	`guild_id` VARCHAR(190) NOT NULL,
	`prefs` LONGTEXT NOT NULL,
	PRIMARY KEY (`user_id`, `guild_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `live_messages` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`name` LONGTEXT NOT NULL,
	`payload` LONGTEXT NOT NULL,
	-- 0: static (edited only when changed in the panel); otherwise variables refreshed every N minutes
	`refresh_minutes` BIGINT NOT NULL DEFAULT 0,
	`variables` LONGTEXT NOT NULL DEFAULT '{}',
	`repost` BIGINT NOT NULL DEFAULT 1,
	`created_by` LONGTEXT NOT NULL,
	`created_at` BIGINT NOT NULL,
	`updated_at` BIGINT NOT NULL,
	`refreshed_at` BIGINT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `live_message_targets` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`message_id` BIGINT NOT NULL,
	`guild_id` LONGTEXT NOT NULL,
	`channel_id` VARCHAR(190) NOT NULL,
	`discord_id` LONGTEXT,
	`last_hash` LONGTEXT,
	`last_error` LONGTEXT,
	`updated_at` BIGINT,
	FOREIGN KEY (`message_id`) REFERENCES `live_messages` (`id`) ON DELETE CASCADE,
	UNIQUE (`message_id`, `channel_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `changelog_entries` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`version` LONGTEXT,
	`title` LONGTEXT NOT NULL,
	`intro` LONGTEXT NOT NULL DEFAULT '',
	`items` LONGTEXT NOT NULL DEFAULT '[]',
	`image` LONGTEXT,
	`color` LONGTEXT NOT NULL DEFAULT '#d6a249',
	`status` LONGTEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
	`targets` LONGTEXT NOT NULL DEFAULT '[]',
	`messages` LONGTEXT NOT NULL DEFAULT '[]',
	`created_by` LONGTEXT NOT NULL,
	`created_at` BIGINT NOT NULL,
	`updated_at` BIGINT NOT NULL,
	`published_at` BIGINT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `polls` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`question` LONGTEXT NOT NULL,
	`description` LONGTEXT NOT NULL DEFAULT '',
	`options` LONGTEXT NOT NULL,
	`settings` LONGTEXT NOT NULL,
	`targets` LONGTEXT NOT NULL DEFAULT '[]',
	`messages` LONGTEXT NOT NULL DEFAULT '[]',
	`status` VARCHAR(190) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'open', 'closed')),
	`starts_at` BIGINT,
	`ends_at` BIGINT,
	`created_by` LONGTEXT NOT NULL,
	`created_at` BIGINT NOT NULL,
	`updated_at` BIGINT NOT NULL,
	`opened_at` BIGINT,
	`closed_at` BIGINT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `poll_votes` (
	`poll_id` BIGINT NOT NULL,
	`user_id` VARCHAR(190) NOT NULL,
	`choice` VARCHAR(190) NOT NULL,
	`guild_id` LONGTEXT,
	`at` BIGINT NOT NULL,
	FOREIGN KEY (`poll_id`) REFERENCES `polls` (`id`) ON DELETE CASCADE,
	PRIMARY KEY (`poll_id`, `user_id`, `choice`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `giveaways` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`prize` LONGTEXT NOT NULL,
	`description` LONGTEXT NOT NULL DEFAULT '',
	`winners_count` BIGINT NOT NULL DEFAULT 1,
	`settings` LONGTEXT NOT NULL,
	`targets` LONGTEXT NOT NULL DEFAULT '[]',
	`messages` LONGTEXT NOT NULL DEFAULT '[]',
	`status` VARCHAR(190) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'open', 'ended', 'cancelled')),
	`starts_at` BIGINT,
	`ends_at` BIGINT NOT NULL,
	`draw` LONGTEXT,
	`created_by` LONGTEXT NOT NULL,
	`created_at` BIGINT NOT NULL,
	`updated_at` BIGINT NOT NULL,
	`ended_at` BIGINT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `giveaway_entries` (
	`giveaway_id` BIGINT NOT NULL,
	`user_id` VARCHAR(190) NOT NULL,
	`guild_id` LONGTEXT NOT NULL,
	`entries` BIGINT NOT NULL DEFAULT 1,
	`at` BIGINT NOT NULL,
	FOREIGN KEY (`giveaway_id`) REFERENCES `giveaways` (`id`) ON DELETE CASCADE,
	PRIMARY KEY (`giveaway_id`, `user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `giveaway_winners` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`giveaway_id` BIGINT NOT NULL,
	`user_id` VARCHAR(190) NOT NULL,
	`status` LONGTEXT NOT NULL DEFAULT 'winner' CHECK (status IN ('winner', 'rerolled', 'expired')),
	`drawn_at` BIGINT NOT NULL,
	`claimed_at` BIGINT,
	FOREIGN KEY (`giveaway_id`) REFERENCES `giveaways` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `feedback_boxes` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`guild_id` VARCHAR(190) NOT NULL,
	`name` LONGTEXT NOT NULL,
	`kind` LONGTEXT NOT NULL CHECK (kind IN ('public', 'staff')),
	`config` LONGTEXT NOT NULL,
	`panel_channel_id` LONGTEXT,
	`panel_message_id` LONGTEXT,
	`created_at` BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `feedback_items` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`box_id` BIGINT NOT NULL,
	`guild_id` LONGTEXT NOT NULL,
	`number` BIGINT NOT NULL,
	`author_id` LONGTEXT NOT NULL,
	`author_name` LONGTEXT,
	`anonymous` BIGINT NOT NULL DEFAULT 0,
	`title` LONGTEXT NOT NULL,
	`answers` LONGTEXT NOT NULL DEFAULT '[]',
	`status` VARCHAR(190) NOT NULL,
	`status_reason` LONGTEXT,
	`status_history` LONGTEXT NOT NULL DEFAULT '[]',
	`urgency` LONGTEXT,
	`assignee_id` LONGTEXT,
	`duplicate_of` BIGINT,
	`approved` BIGINT NOT NULL DEFAULT 1,
	`channel_id` LONGTEXT,
	`message_id` LONGTEXT,
	`thread_id` LONGTEXT,
	`reminded_at` BIGINT,
	`created_at` BIGINT NOT NULL,
	`updated_at` BIGINT NOT NULL,
	`approved_by` LONGTEXT,
	`approved_at` BIGINT,
	FOREIGN KEY (`box_id`) REFERENCES `feedback_boxes` (`id`) ON DELETE CASCADE,
	UNIQUE (`box_id`, `number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `feedback_votes` (
	`item_id` BIGINT NOT NULL,
	`user_id` VARCHAR(190) NOT NULL,
	`value` BIGINT NOT NULL CHECK (value IN (-1, 1)),
	`at` BIGINT NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `feedback_items` (`id`) ON DELETE CASCADE,
	PRIMARY KEY (`item_id`, `user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `recruit_positions` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`guild_id` LONGTEXT NOT NULL,
	`name` LONGTEXT NOT NULL,
	`description` LONGTEXT NOT NULL DEFAULT '',
	`config` LONGTEXT NOT NULL,
	`panel_channel_id` LONGTEXT,
	`panel_message_id` LONGTEXT,
	`created_at` BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `recruit_applications` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`position_id` BIGINT NOT NULL,
	`guild_id` LONGTEXT NOT NULL,
	`user_id` VARCHAR(190) NOT NULL,
	`user_name` LONGTEXT,
	`answers` LONGTEXT NOT NULL,
	`status` LONGTEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'review', 'interview', 'accepted', 'rejected', 'withdrawn')),
	`history` LONGTEXT NOT NULL DEFAULT '[]',
	`notes` LONGTEXT NOT NULL DEFAULT '[]',
	`review_channel_id` LONGTEXT,
	`review_message_id` LONGTEXT,
	`thread_id` LONGTEXT,
	`interview_channel_id` LONGTEXT,
	`decided_by` LONGTEXT,
	`decided_at` BIGINT,
	`created_at` BIGINT NOT NULL,
	`updated_at` BIGINT NOT NULL,
	FOREIGN KEY (`position_id`) REFERENCES `recruit_positions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `recruit_votes` (
	`application_id` BIGINT NOT NULL,
	`user_id` VARCHAR(190) NOT NULL,
	`vote` BIGINT NOT NULL CHECK (vote IN (-1, 0, 1)),
	`comment` LONGTEXT,
	`at` BIGINT NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `recruit_applications` (`id`) ON DELETE CASCADE,
	PRIMARY KEY (`application_id`, `user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `absences` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`user_id` VARCHAR(190) NOT NULL,
	`start_at` BIGINT NOT NULL,
	`end_at` BIGINT NOT NULL,
	`reason` LONGTEXT,
	`status` VARCHAR(190) NOT NULL CHECK (status IN ('pending', 'approved', 'active', 'ended', 'rejected', 'cancelled')),
	`declared_by` LONGTEXT NOT NULL,
	`reviewed_by` LONGTEXT,
	`reviewed_at` BIGINT,
	`reminded_at` BIGINT,
	`applied` LONGTEXT NOT NULL DEFAULT '{}',
	`created_at` BIGINT NOT NULL,
	`ended_at` BIGINT,
	`review_channel_id` LONGTEXT,
	`review_message_id` LONGTEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `announcement_templates` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`name` LONGTEXT NOT NULL,
	`payload` LONGTEXT NOT NULL,
	`options` LONGTEXT NOT NULL DEFAULT '{}',
	`targets` LONGTEXT NOT NULL DEFAULT '[]',
	`created_by` LONGTEXT NOT NULL,
	`created_at` BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `scheduled_deletions` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`channel_id` LONGTEXT NOT NULL,
	`message_id` LONGTEXT NOT NULL,
	`delete_at` BIGINT NOT NULL,
	`source` LONGTEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `stream_subscriptions` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`platform` LONGTEXT NOT NULL CHECK (platform IN ('twitch', 'youtube', 'kick')),
	`channel` LONGTEXT NOT NULL,
	`display_name` LONGTEXT NOT NULL,
	`targets` LONGTEXT NOT NULL,
	`payloads` LONGTEXT NOT NULL,
	`config` LONGTEXT NOT NULL,
	`enabled` BIGINT NOT NULL DEFAULT 1,
	`created_by` LONGTEXT NOT NULL,
	`created_at` BIGINT NOT NULL,
	`updated_at` BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `stream_state` (
	`subscription_id` BIGINT PRIMARY KEY,
	`live_id` LONGTEXT,
	`live_started_at` BIGINT,
	`live_title` LONGTEXT,
	`live_game` LONGTEXT,
	`peak_viewers` BIGINT NOT NULL DEFAULT 0,
	`live_messages` LONGTEXT NOT NULL DEFAULT '[]',
	`role_holders` LONGTEXT NOT NULL DEFAULT '[]',
	`last_video_id` LONGTEXT,
	`last_video_at` BIGINT,
	checked_at      INTEGER,
	`videos_checked_at` BIGINT,
	`error` LONGTEXT,
	FOREIGN KEY (`subscription_id`) REFERENCES `stream_subscriptions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `stream_history` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`subscription_id` BIGINT NOT NULL,
	`kind` LONGTEXT NOT NULL CHECK (kind IN ('live', 'video', 'short', 'end', 'test')),
	`title` LONGTEXT,
	`url` LONGTEXT,
	`channels` BIGINT NOT NULL DEFAULT 0,
	`at` BIGINT NOT NULL,
	FOREIGN KEY (`subscription_id`) REFERENCES `stream_subscriptions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `fivem_servers` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`name` LONGTEXT NOT NULL,
	`address` LONGTEXT NOT NULL,
	`join_code` LONGTEXT,
	`config` LONGTEXT NOT NULL DEFAULT '{}',
	`created_by` LONGTEXT NOT NULL,
	`created_at` BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `fivem_status_messages` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`server_id` BIGINT NOT NULL,
	`guild_id` LONGTEXT NOT NULL,
	`channel_id` VARCHAR(190) NOT NULL,
	`message_id` LONGTEXT,
	FOREIGN KEY (`server_id`) REFERENCES `fivem_servers` (`id`) ON DELETE CASCADE,
	UNIQUE (`server_id`, `channel_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `dm_threads` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`user_id` VARCHAR(190) NOT NULL UNIQUE,
	`user_name` LONGTEXT,
	`status` VARCHAR(190) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
	`assigned_to` LONGTEXT,
	`unread` BIGINT NOT NULL DEFAULT 0,
	`dms_closed` BIGINT NOT NULL DEFAULT 0,
	`started_by` LONGTEXT NOT NULL,
	`last_message_at` BIGINT NOT NULL,
	`created_at` BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `dm_messages` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`thread_id` BIGINT NOT NULL,
	`direction` LONGTEXT NOT NULL CHECK (direction IN ('in', 'out', 'note', 'system')),
	`author_id` LONGTEXT NOT NULL,
	`content` LONGTEXT NOT NULL DEFAULT '',
	`attachments` LONGTEXT NOT NULL DEFAULT '[]',
	`discord_message_id` LONGTEXT,
	`at` BIGINT NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `dm_threads` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `dm_blocklist` (
	`user_id` VARCHAR(190) PRIMARY KEY,
	`reason` LONGTEXT,
	`blocked_by` LONGTEXT NOT NULL,
	`at` BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `dm_snippets` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`name` LONGTEXT NOT NULL,
	`content` LONGTEXT NOT NULL,
	`created_by` LONGTEXT NOT NULL,
	`created_at` BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `server_templates` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`name` LONGTEXT NOT NULL,
	`description` LONGTEXT,
	`source_guild_id` LONGTEXT NOT NULL,
	`snapshot` LONGTEXT NOT NULL,
	`captured_at` BIGINT NOT NULL,
	`created_by` LONGTEXT NOT NULL,
	`created_at` BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `template_applications` (
	`guild_id` VARCHAR(190) PRIMARY KEY,
	`template_id` BIGINT,
	`mapping` LONGTEXT NOT NULL,
	`mode` LONGTEXT NOT NULL CHECK (mode IN ('reset', 'repair')),
	`status` LONGTEXT NOT NULL CHECK (status IN ('done', 'failed')),
	`report` LONGTEXT NOT NULL,
	`applied_at` BIGINT NOT NULL,
	`applied_by` LONGTEXT NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `server_templates` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `custom_commands` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`name` LONGTEXT NOT NULL,
	`definition` LONGTEXT NOT NULL,
	`enabled` BIGINT NOT NULL DEFAULT 1,
	`uses` BIGINT NOT NULL DEFAULT 0,
	`created_by` LONGTEXT NOT NULL,
	`created_at` BIGINT NOT NULL,
	`updated_by` LONGTEXT NOT NULL,
	`updated_at` BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `custom_command_counters` (
	`key` VARCHAR(190) NOT NULL,
	`user_id` VARCHAR(190) NOT NULL DEFAULT '',
	`value` BIGINT NOT NULL DEFAULT 0,
	PRIMARY KEY (`key`, `user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `custom_command_runs` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`command_id` BIGINT NOT NULL,
	`guild_id` LONGTEXT,
	`user_id` LONGTEXT NOT NULL,
	`trigger` LONGTEXT NOT NULL,
	`ok` BIGINT NOT NULL,
	`detail` LONGTEXT,
	`at` BIGINT NOT NULL,
	FOREIGN KEY (`command_id`) REFERENCES `custom_commands` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `server_backups` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`guild_id` VARCHAR(190) NOT NULL,
	`name` LONGTEXT NOT NULL,
	`kind` LONGTEXT NOT NULL CHECK (kind IN ('auto', 'manual')),
	`data` LONGBLOB NOT NULL,
	`roles` BIGINT NOT NULL,
	`channels` BIGINT NOT NULL,
	`members` BIGINT NOT NULL,
	`size` BIGINT NOT NULL,
	`created_by` LONGTEXT NOT NULL,
	`created_at` BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `rp_events` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`title` LONGTEXT NOT NULL,
	`description` LONGTEXT NOT NULL DEFAULT '',
	`image` LONGTEXT,
	`location` LONGTEXT,
	`starts_at` BIGINT NOT NULL,
	`ends_at` BIGINT NOT NULL,
	`capacity` BIGINT,
	`allow_maybe` BIGINT NOT NULL DEFAULT 1,
	`targets` LONGTEXT NOT NULL DEFAULT '[]',
	`roles` LONGTEXT NOT NULL DEFAULT '{}',
	`reminders` LONGTEXT NOT NULL DEFAULT '[60]',
	`reminded` LONGTEXT NOT NULL DEFAULT '[]',
	`messages` LONGTEXT NOT NULL DEFAULT '[]',
	`status` VARCHAR(190) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'live', 'ended', 'cancelled')),
	`created_by` LONGTEXT NOT NULL,
	`created_at` BIGINT NOT NULL,
	`updated_at` BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `rp_event_rsvps` (
	`event_id` BIGINT NOT NULL,
	`user_id` VARCHAR(190) NOT NULL,
	`status` LONGTEXT NOT NULL CHECK (status IN ('going', 'maybe', 'waitlist')),
	`at` BIGINT NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `rp_events` (`id`) ON DELETE CASCADE,
	PRIMARY KEY (`event_id`, `user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `sanction_templates` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`name` VARCHAR(190) COLLATE utf8mb4_unicode_ci NOT NULL UNIQUE,
	`type` LONGTEXT NOT NULL CHECK (type IN ('ban', 'kick', 'timeout', 'warn', 'restrict')),
	`reason` LONGTEXT NOT NULL DEFAULT '',
	`duration_ms` BIGINT,
	`scope` LONGTEXT NOT NULL DEFAULT 'network' CHECK (scope IN ('network', 'local')),
	`profile` LONGTEXT,
	`delete_message_seconds` BIGINT NOT NULL DEFAULT 0,
	`position` BIGINT NOT NULL DEFAULT 0,
	`created_at` BIGINT NOT NULL,
	`updated_at` BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `music_playlists` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`name` LONGTEXT NOT NULL,
	`owner_id` VARCHAR(190) NOT NULL,
	`shared` BIGINT NOT NULL DEFAULT 1,
	`tracks` LONGTEXT NOT NULL DEFAULT '[]',
	`plays` BIGINT NOT NULL DEFAULT 0,
	`created_at` BIGINT NOT NULL,
	`updated_at` BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `channel_features` (
	`channel_id` VARCHAR(190) NOT NULL,
	`guild_id` VARCHAR(190) NOT NULL,
	`kind` VARCHAR(190) NOT NULL CHECK (kind IN ('counting', 'oneword', 'sticky', 'autopublish', 'mediaonly')),
	`config` LONGTEXT NOT NULL DEFAULT '{}',
	`state` LONGTEXT NOT NULL DEFAULT '{}',
	`created_at` BIGINT NOT NULL,
	`updated_at` BIGINT NOT NULL,
	PRIMARY KEY (`channel_id`, `kind`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `verification_pending` (
	`guild_id` VARCHAR(190) NOT NULL,
	`user_id` VARCHAR(190) NOT NULL,
	`joined_at` BIGINT NOT NULL,
	`attempts` BIGINT NOT NULL DEFAULT 0,
	PRIMARY KEY (`guild_id`, `user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `built_messages` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`name` LONGTEXT NOT NULL,
	`guild_id` LONGTEXT,
	`channel_id` LONGTEXT,
	`message_id` LONGTEXT,
	`payload` LONGTEXT NOT NULL,
	`created_by` LONGTEXT NOT NULL,
	`created_at` BIGINT NOT NULL,
	`updated_at` BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `sanction_appeals` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`sanction_id` BIGINT NOT NULL,
	`user_id` LONGTEXT NOT NULL,
	`answers` LONGTEXT NOT NULL,
	`status` VARCHAR(190) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
	`decided_by` LONGTEXT,
	`decision_reason` LONGTEXT,
	`review_channel_id` LONGTEXT,
	`review_message_id` LONGTEXT,
	`created_at` BIGINT NOT NULL,
	`decided_at` BIGINT,
	FOREIGN KEY (`sanction_id`) REFERENCES `sanctions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `channel_schedules` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`guild_id` LONGTEXT NOT NULL,
	`name` LONGTEXT NOT NULL,
	`channel_ids` LONGTEXT NOT NULL,
	`mode` LONGTEXT NOT NULL CHECK (mode IN ('open_during', 'closed_during')),
	`lock_type` LONGTEXT NOT NULL CHECK (lock_type IN ('write', 'hide')),
	`weekly` LONGTEXT NOT NULL DEFAULT '[]',
	`dates` LONGTEXT NOT NULL DEFAULT '[]',
	`announce` BIGINT NOT NULL DEFAULT 1,
	`enabled` BIGINT NOT NULL DEFAULT 1,
	`applied` LONGTEXT,
	`created_at` BIGINT NOT NULL,
	`updated_at` BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `channel_archives` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`guild_id` LONGTEXT NOT NULL,
	`channel_id` LONGTEXT NOT NULL,
	`channel_name` LONGTEXT NOT NULL,
	`created_by` LONGTEXT NOT NULL,
	`message_count` BIGINT NOT NULL,
	`first_at` BIGINT,
	`last_at` BIGINT,
	`file` LONGTEXT NOT NULL,
	`size` BIGINT NOT NULL DEFAULT 0,
	`created_at` BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `meetings` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`guild_id` LONGTEXT NOT NULL,
	`title` LONGTEXT NOT NULL,
	`description` LONGTEXT NOT NULL DEFAULT '',
	`agenda` LONGTEXT NOT NULL DEFAULT '[]',
	`starts_at` BIGINT NOT NULL,
	`duration_minutes` BIGINT NOT NULL DEFAULT 60,
	`voice_channel_id` LONGTEXT NOT NULL,
	`announce_channel_id` LONGTEXT,
	`invites` LONGTEXT NOT NULL DEFAULT '{}',
	`reminders` LONGTEXT NOT NULL DEFAULT '[1440, 60, 10]',
	`reminded` LONGTEXT NOT NULL DEFAULT '[]',
	`recurrence` LONGTEXT,
	`status` VARCHAR(190) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'live', 'ended', 'cancelled')),
	`started_at` BIGINT,
	`ended_at` BIGINT,
	`notes` LONGTEXT NOT NULL DEFAULT '',
	`message_id` LONGTEXT,
	`created_by` LONGTEXT NOT NULL,
	`created_at` BIGINT NOT NULL,
	`updated_at` BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `meeting_invites` (
	`meeting_id` BIGINT NOT NULL,
	`user_id` VARCHAR(190) NOT NULL,
	`rsvp` LONGTEXT NOT NULL DEFAULT 'pending' CHECK (rsvp IN ('pending', 'yes', 'maybe', 'no')),
	`reason` LONGTEXT,
	`responded_at` BIGINT,
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings` (`id`) ON DELETE CASCADE,
	PRIMARY KEY (`meeting_id`, `user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `meeting_attendance` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`meeting_id` BIGINT NOT NULL,
	`user_id` VARCHAR(190) NOT NULL,
	`joined_at` BIGINT NOT NULL,
	`left_at` BIGINT,
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `meeting_actions` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`meeting_id` BIGINT NOT NULL,
	`text` LONGTEXT NOT NULL,
	`assignee_id` LONGTEXT,
	`due_at` BIGINT,
	`done_at` BIGINT,
	`created_at` BIGINT NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `api_keys` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`name` LONGTEXT NOT NULL,
	`owner_id` VARCHAR(190) NOT NULL,
	`prefix` LONGTEXT NOT NULL,
	`hash` VARCHAR(190) NOT NULL UNIQUE,
	-- JSON array of permissions, NULL: every permission of the owner (follows their rank)
	`permissions` LONGTEXT,
	`created_at` BIGINT NOT NULL,
	`expires_at` BIGINT,
	`last_used_at` BIGINT,
	`last_ip` LONGTEXT,
	`uses` BIGINT NOT NULL DEFAULT 0,
	`revoked_at` BIGINT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `antinuke_incidents` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`user_id` VARCHAR(190) NOT NULL,
	`guild_id` LONGTEXT NOT NULL,
	`trigger_type` LONGTEXT NOT NULL,
	-- JSON [{ type, guildId, targetId, targetName, at }] of the counted actions
	`actions` LONGTEXT NOT NULL,
	-- JSON { guildId: [roleId] } of the roles taken away, given back by "Rendre les rôles"
	`removed_roles` LONGTEXT NOT NULL,
	-- JSON [{ guildId, roleId, name, reason }] of what could not be done
	`failures` LONGTEXT NOT NULL,
	`timed_out` BIGINT NOT NULL DEFAULT 0,
	`status` VARCHAR(190) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'restored', 'dismissed')),
	`created_at` BIGINT NOT NULL,
	`resolved_at` BIGINT,
	`resolved_by` LONGTEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `tebex_payments` (
	-- Payment id given by Tebex
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`status` LONGTEXT NOT NULL,
	`amount` LONGTEXT,
	`currency` LONGTEXT,
	`player_uuid` LONGTEXT,
	`player_name` LONGTEXT,
	-- JSON [{ id, name }]
	`packages` LONGTEXT NOT NULL DEFAULT '[]',
	`paid_at` BIGINT,
	`seen_at` BIGINT NOT NULL,
	-- 1: already there when the store was connected, nothing is done for it
	`baseline` BIGINT NOT NULL DEFAULT 0,
	`discord_id` VARCHAR(190),
	-- fivem, license, name (read from the FiveM database), known (earlier manual link), manual
	`link_method` LONGTEXT,
	`link_checked_at` BIGINT,
	`logged_at` BIGINT,
	`applied_at` BIGINT,
	`revoked_at` BIGINT,
	`error` LONGTEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `tebex_grants` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`payment_id` BIGINT NOT NULL,
	`guild_id` LONGTEXT NOT NULL,
	`user_id` LONGTEXT NOT NULL,
	`role_id` LONGTEXT NOT NULL,
	`temp_role_id` BIGINT,
	`granted_at` BIGINT NOT NULL,
	`removed_at` BIGINT,
	FOREIGN KEY (`payment_id`) REFERENCES `tebex_payments` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `tebex_links` (
	`player_uuid` VARCHAR(190) PRIMARY KEY,
	`discord_id` LONGTEXT NOT NULL,
	`created_by` LONGTEXT NOT NULL,
	`created_at` BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `fivem_events` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`type` LONGTEXT NOT NULL,
	`server` LONGTEXT,
	-- JSON of the cleaned event data (no player identifiers besides a Discord ID)
	`data` LONGTEXT NOT NULL,
	-- posted | logged | disabled | ignored | duplicate | muted | failed
	`status` LONGTEXT NOT NULL,
	`detail` LONGTEXT,
	`test` BIGINT NOT NULL DEFAULT 0,
	`received_at` BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `ticket_replies` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`guild_id` VARCHAR(190) NOT NULL,
	`category_id` BIGINT,
	`name` VARCHAR(190) COLLATE utf8mb4_unicode_ci NOT NULL,
	`content` LONGTEXT NOT NULL,
	`uses` BIGINT NOT NULL DEFAULT 0,
	`created_by` LONGTEXT,
	`created_at` BIGINT NOT NULL,
	`updated_at` BIGINT NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `ticket_categories` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `feed_subscriptions` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`kind` LONGTEXT NOT NULL CHECK (kind IN ('rss', 'tiktok')),
	`url` LONGTEXT NOT NULL,
	`display_name` LONGTEXT NOT NULL,
	`targets` LONGTEXT NOT NULL,
	`payload` LONGTEXT NOT NULL,
	`config` LONGTEXT NOT NULL,
	`enabled` BIGINT NOT NULL DEFAULT 1,
	`created_by` LONGTEXT NOT NULL,
	`created_at` BIGINT NOT NULL,
	`updated_at` BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `feed_state` (
	`subscription_id` BIGINT PRIMARY KEY,
	`feed_title` LONGTEXT,
	`initialized_at` BIGINT,
	checked_at      INTEGER,
	`next_check_at` BIGINT,
	`failures` BIGINT NOT NULL DEFAULT 0,
	`error` LONGTEXT,
	`etag` LONGTEXT,
	`last_modified` LONGTEXT,
	`last_item_at` BIGINT,
	FOREIGN KEY (`subscription_id`) REFERENCES `feed_subscriptions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `feed_seen` (
	`subscription_id` BIGINT NOT NULL,
	`item_key` VARCHAR(190) NOT NULL,
	`seen_at` BIGINT NOT NULL,
	FOREIGN KEY (`subscription_id`) REFERENCES `feed_subscriptions` (`id`) ON DELETE CASCADE,
	PRIMARY KEY (`subscription_id`, `item_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `feed_history` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`subscription_id` BIGINT NOT NULL,
	`kind` LONGTEXT NOT NULL CHECK (kind IN ('item', 'test')),
	`title` LONGTEXT,
	`url` LONGTEXT,
	`channels` BIGINT NOT NULL DEFAULT 0,
	`at` BIGINT NOT NULL,
	FOREIGN KEY (`subscription_id`) REFERENCES `feed_subscriptions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `panel_notifications` (
	`id` BIGINT PRIMARY KEY AUTO_INCREMENT,
	`type` LONGTEXT NOT NULL,
	`title` LONGTEXT NOT NULL,
	`body` LONGTEXT,
	`url` LONGTEXT,
	`guild_id` LONGTEXT,
	`permission` LONGTEXT,
	`user_id` LONGTEXT,
	-- Whoever caused it never gets notified of their own action
	`actor_id` LONGTEXT,
	`created_at` BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `panel_notification_reads` (
	`notification_id` BIGINT NOT NULL,
	`user_id` VARCHAR(190) NOT NULL,
	FOREIGN KEY (`notification_id`) REFERENCES `panel_notifications` (`id`) ON DELETE CASCADE,
	PRIMARY KEY (`notification_id`, `user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `panel_notification_prefs` (
	`user_id` VARCHAR(190) PRIMARY KEY,
	`disabled` LONGTEXT NOT NULL DEFAULT '[]',
	`read_up_to` BIGINT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE UNIQUE INDEX `guilds_single_main` ON `guilds` (`main_flag`);
CREATE INDEX `rank_roles_by_role` ON `rank_roles` (`guild_id`, `role_id`);
CREATE INDEX `sessions_by_user` ON `sessions` (`discord_id`);
CREATE INDEX `audit_by_at` ON `audit_log` (`at`);
CREATE INDEX `audit_by_actor` ON `audit_log` (`actor_id`, `at`);
CREATE INDEX `audit_by_action` ON `audit_log` (`action`, `at`);
CREATE INDEX `audit_by_guild` ON `audit_log` (`guild_id`, `at`);
CREATE INDEX `events_by_at` ON `events` (`at`);
CREATE INDEX `events_by_guild` ON `events` (`guild_id`, `at`);
CREATE INDEX `events_by_category` ON `events` (`category`, `at`);
CREATE INDEX `events_by_user` ON `events` (`user_id`, `at`);
CREATE INDEX `ticket_categories_by_guild` ON `ticket_categories` (`guild_id`, `position`);
CREATE INDEX `tickets_by_status` ON `tickets` (`status`, `created_at`);
CREATE INDEX `tickets_by_opener` ON `tickets` (`opener_id`, `status`);
CREATE INDEX `tickets_by_channel` ON `tickets` (`channel_id`);
CREATE INDEX `announcements_by_status` ON `announcements` (`status`, `scheduled_at`);
CREATE INDEX `ticket_panels_by_guild` ON `ticket_panels` (`guild_id`);
CREATE INDEX `tickets_by_activity` ON `tickets` (`status`, `last_activity_at`);
CREATE INDEX `ticket_messages_by_ticket` ON `ticket_messages` (`ticket_id`, `created_at`);
CREATE INDEX `sanctions_by_user` ON `sanctions` (`user_id`, `created_at`);
CREATE INDEX `sanctions_by_type` ON `sanctions` (`type`, `created_at`);
CREATE INDEX `sanctions_active_bans` ON `sanctions` (`type`, `revoked_at`, `expires_at`);
CREATE INDEX `temp_roles_due` ON `temp_roles` (`removed_at`, `expires_at`);
CREATE INDEX `temp_roles_by_user` ON `temp_roles` (`user_id`, `removed_at`);
CREATE INDEX `stats_activity_by_user` ON `stats_activity` (`user_id`, `day`);
CREATE INDEX `stats_activity_by_day` ON `stats_activity` (`day`);
CREATE INDEX `voice_rooms_by_owner` ON `voice_rooms` (`guild_id`, `owner_id`);
CREATE INDEX `polls_by_status` ON `polls` (`status`, `ends_at`);
CREATE INDEX `giveaways_by_status` ON `giveaways` (`status`, `ends_at`);
CREATE INDEX `giveaway_winners_by_user` ON `giveaway_winners` (`user_id`, `drawn_at`);
CREATE INDEX `feedback_boxes_by_guild` ON `feedback_boxes` (`guild_id`);
CREATE INDEX `feedback_items_by_box` ON `feedback_items` (`box_id`, `status`);
CREATE INDEX `recruit_applications_by_user` ON `recruit_applications` (`user_id`, `position_id`, `created_at`);
CREATE INDEX `absences_by_status` ON `absences` (`status`, `start_at`, `end_at`);
CREATE INDEX `absences_by_user` ON `absences` (`user_id`, `start_at`);
CREATE INDEX `scheduled_deletions_by_date` ON `scheduled_deletions` (`delete_at`);
CREATE INDEX `stream_history_by_date` ON `stream_history` (`at` DESC);
CREATE INDEX `dm_threads_by_activity` ON `dm_threads` (`status`, `last_message_at` DESC);
CREATE INDEX `dm_messages_by_thread` ON `dm_messages` (`thread_id`, `id`);
CREATE INDEX `custom_command_runs_by_command` ON `custom_command_runs` (`command_id`, `at` DESC);
CREATE INDEX `server_backups_by_guild` ON `server_backups` (`guild_id`, `created_at` DESC);
CREATE INDEX `rp_events_by_start` ON `rp_events` (`status`, `starts_at`);
CREATE INDEX `music_playlists_by_owner` ON `music_playlists` (`owner_id`);
CREATE INDEX `channel_features_by_guild` ON `channel_features` (`guild_id`);
CREATE INDEX `sanction_appeals_by_sanction` ON `sanction_appeals` (`sanction_id`, `created_at`);
CREATE INDEX `sanction_appeals_by_status` ON `sanction_appeals` (`status`, `created_at`);
CREATE INDEX `meetings_by_status` ON `meetings` (`status`, `starts_at`);
CREATE INDEX `meeting_attendance_by_meeting` ON `meeting_attendance` (`meeting_id`, `user_id`);
CREATE INDEX `api_keys_by_owner` ON `api_keys` (`owner_id`);
CREATE INDEX `antinuke_incidents_by_user` ON `antinuke_incidents` (`user_id`, `status`);
CREATE INDEX `tebex_payments_by_discord` ON `tebex_payments` (`discord_id`);
CREATE INDEX `tebex_grants_by_payment` ON `tebex_grants` (`payment_id`);
CREATE INDEX `fivem_events_by_time` ON `fivem_events` (`received_at`);
CREATE INDEX `tickets_by_guild_created` ON `tickets` (`guild_id`, `created_at`);
CREATE UNIQUE INDEX `ticket_replies_by_name` ON `ticket_replies` (`guild_id`, `name`);
CREATE INDEX `feed_history_by_date` ON `feed_history` (`at` DESC);
CREATE INDEX `panel_notifications_by_date` ON `panel_notifications` (`created_at`);

-- Restriction profiles offered by default
INSERT INTO `restriction_profiles` (`key`, `label`, `deny`, `position`) VALUES
	('mute_text', 'Muet écrit', '["SendMessages","SendMessagesInThreads","CreatePublicThreads","CreatePrivateThreads","AddReactions"]', 0),
	('mute_voice', 'Muet vocal', '["Speak","Stream","UseSoundboard"]', 1),
	('no_voice', 'Pas de vocal', '["Connect"]', 2),
	('no_media', 'Pas d’images', '["AttachFiles","EmbedLinks"]', 3);
