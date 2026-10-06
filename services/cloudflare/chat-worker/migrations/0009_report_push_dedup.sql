CREATE TABLE IF NOT EXISTS report_push_dedup (
  phone10 TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('morning', 'evening')),
  report_date TEXT NOT NULL,
  last_push_at INTEGER NOT NULL,
  PRIMARY KEY (phone10, kind, report_date)
);

CREATE INDEX IF NOT EXISTS idx_report_push_dedup_date
  ON report_push_dedup (report_date);
