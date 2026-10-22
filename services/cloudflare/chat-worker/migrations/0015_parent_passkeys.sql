CREATE TABLE IF NOT EXISTS parent_auth_profiles (
  phone10 TEXT PRIMARY KEY,
  user_handle TEXT NOT NULL UNIQUE,
  generation_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO parent_auth_profiles(phone10,user_handle,generation_id,created_at,updated_at)
SELECT phone10,lower(hex(randomblob(32))),lower(hex(randomblob(16))),0,0 FROM chat_profiles;

CREATE TABLE IF NOT EXISTS parent_passkeys (
  credential_id TEXT PRIMARY KEY,
  user_handle TEXT NOT NULL,
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT NOT NULL DEFAULT '[]',
  device_type TEXT NOT NULL DEFAULT '',
  backed_up INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_parent_passkeys_user_handle
  ON parent_passkeys(user_handle, revoked_at);

CREATE TABLE IF NOT EXISTS parent_auth_challenges (
  challenge_id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('registration', 'authentication')),
  user_handle TEXT,
  phone10 TEXT,
  generation_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_parent_auth_challenges_expiry
  ON parent_auth_challenges(expires_at, consumed_at);

ALTER TABLE parent_access_requests
  ADD COLUMN request_secret_hash TEXT NOT NULL DEFAULT '';

CREATE TRIGGER IF NOT EXISTS parent_auth_profile_insert
AFTER INSERT ON chat_profiles
WHEN NOT EXISTS (SELECT 1 FROM parent_auth_profiles WHERE phone10=NEW.phone10)
BEGIN
  INSERT INTO parent_auth_profiles(phone10,user_handle,generation_id,created_at,updated_at)
  VALUES (NEW.phone10,lower(hex(randomblob(32))),lower(hex(randomblob(16))),CAST(unixepoch('subsec')*1000 AS INTEGER),CAST(unixepoch('subsec')*1000 AS INTEGER));
END;

CREATE TRIGGER IF NOT EXISTS parent_auth_profile_delete
AFTER DELETE ON chat_profiles
BEGIN
  DELETE FROM parent_passkeys WHERE user_handle=(SELECT user_handle FROM parent_auth_profiles WHERE phone10=OLD.phone10);
  DELETE FROM parent_auth_challenges WHERE phone10=OLD.phone10 OR user_handle=(SELECT user_handle FROM parent_auth_profiles WHERE phone10=OLD.phone10);
  DELETE FROM parent_auth_profiles WHERE phone10=OLD.phone10;
END;
