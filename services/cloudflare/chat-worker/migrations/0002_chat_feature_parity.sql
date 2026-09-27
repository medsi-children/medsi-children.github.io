ALTER TABLE chat_messages ADD COLUMN file_id TEXT NOT NULL DEFAULT '';
ALTER TABLE chat_messages ADD COLUMN delete_after INTEGER;
ALTER TABLE chat_messages ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE chat_messages ADD COLUMN reply_to_key TEXT NOT NULL DEFAULT '';
ALTER TABLE chat_messages ADD COLUMN reaction TEXT NOT NULL DEFAULT '';
ALTER TABLE chat_messages ADD COLUMN edited_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_chat_messages_key ON chat_messages(message_key);

CREATE TABLE IF NOT EXISTS chat_pins (
  phone10 TEXT PRIMARY KEY,
  bucket TEXT NOT NULL CHECK (bucket IN ('read', 'unread')),
  updated_at INTEGER NOT NULL
);
