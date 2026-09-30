-- Channel receiving the transcripts of a ticket category (null: only the "tickets" log channel)
ALTER TABLE ticket_categories ADD COLUMN transcript_channel_id TEXT;
