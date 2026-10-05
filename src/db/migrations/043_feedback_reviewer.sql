-- Who published a suggestion / bug held for review, and when
ALTER TABLE feedback_items ADD COLUMN approved_by TEXT;
ALTER TABLE feedback_items ADD COLUMN approved_at INTEGER;
