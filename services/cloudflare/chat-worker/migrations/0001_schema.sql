CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_key TEXT NOT NULL UNIQUE,
  phone10 TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('parent', 'educator')),
  type TEXT NOT NULL DEFAULT 'text',
  text TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  read_by_parent INTEGER NOT NULL DEFAULT 0,
  read_by_educator INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_phone_created
  ON chat_messages(phone10, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_chat_messages_unread_educator
  ON chat_messages(read_by_educator, created_at DESC);

CREATE TABLE IF NOT EXISTS chat_profiles (
  phone10 TEXT PRIMARY KEY,
  parent_name TEXT NOT NULL,
  child_name TEXT NOT NULL
);
