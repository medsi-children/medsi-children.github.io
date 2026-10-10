CREATE TABLE IF NOT EXISTS parent_deletion_queue (
  operation_id TEXT PRIMARY KEY,
  phone10 TEXT NOT NULL,
  parent_name TEXT NOT NULL DEFAULT '',
  child_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  result_json TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_parent_deletion_queue_phone_active
  ON parent_deletion_queue(phone10)
  WHERE status IN ('pending','retry','processing');

CREATE INDEX IF NOT EXISTS idx_parent_deletion_queue_status
  ON parent_deletion_queue(status, updated_at);
