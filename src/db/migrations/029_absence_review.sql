-- Absences: the validation message (embed with Valider / Refuser) posted in the staff channel
ALTER TABLE absences ADD COLUMN review_channel_id TEXT;
ALTER TABLE absences ADD COLUMN review_message_id TEXT;
