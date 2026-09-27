ALTER TABLE chat_messages ADD COLUMN client_message_id TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_messages_client_id
  ON chat_messages(phone10, client_message_id)
  WHERE client_message_id <> '';
