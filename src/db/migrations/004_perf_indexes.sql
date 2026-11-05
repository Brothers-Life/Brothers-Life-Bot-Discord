-- Indexes for the period reports (staff activity, ticket stats): they scan by date columns that had none

CREATE INDEX IF NOT EXISTS tickets_by_closed ON tickets (closed_at) WHERE closed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS ticket_messages_by_created ON ticket_messages (created_at);
CREATE INDEX IF NOT EXISTS sanctions_by_created ON sanctions (created_at);
CREATE INDEX IF NOT EXISTS sanctions_by_moderator ON sanctions (moderator_id, created_at);
CREATE INDEX IF NOT EXISTS dm_messages_by_at ON dm_messages (at);
CREATE INDEX IF NOT EXISTS audit_by_source ON audit_log (source, at);
