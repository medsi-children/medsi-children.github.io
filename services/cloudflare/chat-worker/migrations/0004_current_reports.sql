CREATE TABLE IF NOT EXISTS report_current (
  phone10 TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('morning', 'evening', 'psychology')),
  text TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (phone10, kind)
);

CREATE INDEX IF NOT EXISTS idx_report_current_phone
  ON report_current (phone10);
