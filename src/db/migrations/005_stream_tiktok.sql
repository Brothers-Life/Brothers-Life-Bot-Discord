-- TikTok lives in the stream notifications: the platform check (whatever its name) accepts 'tiktok'
DO $$
DECLARE c record;
BEGIN
	FOR c IN SELECT conname FROM pg_constraint
		WHERE conrelid = 'stream_subscriptions'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%platform%'
	LOOP
		EXECUTE format('ALTER TABLE stream_subscriptions DROP CONSTRAINT %I', c.conname);
	END LOOP;
END $$;

ALTER TABLE stream_subscriptions ADD CONSTRAINT stream_subscriptions_platform_check CHECK (platform IN ('twitch', 'youtube', 'kick', 'tiktok'));
