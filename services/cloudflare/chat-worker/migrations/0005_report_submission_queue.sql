CREATE TABLE IF NOT EXISTS report_submission_queue (
  submission_id TEXT PRIMARY KEY,
  report_type TEXT NOT NULL,
  report_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  result_json TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_report_submission_queue_status
  ON report_submission_queue(status, updated_at);
