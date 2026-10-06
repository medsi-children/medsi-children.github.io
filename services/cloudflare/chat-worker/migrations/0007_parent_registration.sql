CREATE TABLE IF NOT EXISTS parent_registration_attempts (
  attempt_id TEXT PRIMARY KEY,
  phone10 TEXT NOT NULL,
  parent_name TEXT NOT NULL,
  child_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'COMPLETED',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_parent_registration_phone_created
  ON parent_registration_attempts(phone10, created_at DESC);

CREATE TABLE IF NOT EXISTS parent_registration_outbox (
  attempt_id TEXT PRIMARY KEY,
  phone10 TEXT NOT NULL,
  parent_name TEXT NOT NULL,
  child_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_parent_registration_outbox_created
  ON parent_registration_outbox(created_at ASC);

CREATE TABLE IF NOT EXISTS parent_access_requests (
  request_id TEXT PRIMARY KEY,
  phone10 TEXT NOT NULL,
  code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  decided_at INTEGER,
  decision TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_parent_access_requests_pending
  ON parent_access_requests(status, created_at ASC, expires_at);
