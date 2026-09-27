CREATE TABLE IF NOT EXISTS report_snapshots (
  phone10 TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('morning', 'evening')),
  report_date TEXT NOT NULL,
  text TEXT NOT NULL,
  captured_at INTEGER NOT NULL,
  PRIMARY KEY (phone10, kind, report_date)
);

CREATE INDEX IF NOT EXISTS idx_report_snapshots_phone_date
  ON report_snapshots (phone10, report_date DESC);
