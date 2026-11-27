-- The private channel of an application is handled like a ticket: open, closed (the candidate no longer
-- sees it, the staff can reopen it), then deleted (by hand or some hours after it was closed).
ALTER TABLE recruit_applications ADD COLUMN IF NOT EXISTS interview_state TEXT;
ALTER TABLE recruit_applications ADD COLUMN IF NOT EXISTS interview_closed_at BIGINT;

-- Channels made before this migration: never deleted by the bot on its own (no closing date)
UPDATE recruit_applications
SET interview_state = CASE WHEN status IN ('accepted', 'rejected', 'withdrawn') THEN 'closed' ELSE 'open' END
WHERE interview_channel_id IS NOT NULL AND interview_state IS NULL;
