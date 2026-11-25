-- Forms filled as a conversation (the bot asks one question per message): the progress of each
-- conversation, so it survives a restart of the bot. key = 'c:<channel id>' or 'u:<user id>' (private messages).
CREATE TABLE IF NOT EXISTS form_chats (
	key TEXT PRIMARY KEY,
	kind TEXT NOT NULL,
	user_id TEXT NOT NULL,
	channel_id TEXT,
	data TEXT NOT NULL,
	updated_at BIGINT NOT NULL
);
