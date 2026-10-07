CREATE TABLE report_snapshots_next (
  phone10 TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('morning', 'evening', 'psychology')),
  report_date TEXT NOT NULL,
  text TEXT NOT NULL,
  captured_at INTEGER NOT NULL,
  PRIMARY KEY (phone10, kind, report_date)
);

INSERT INTO report_snapshots_next (phone10, kind, report_date, text, captured_at)
SELECT phone10, kind, report_date, text, captured_at
FROM report_snapshots;

DROP TABLE report_snapshots;

ALTER TABLE report_snapshots_next RENAME TO report_snapshots;

CREATE INDEX IF NOT EXISTS idx_report_snapshots_phone_date
  ON report_snapshots (phone10, report_date DESC);
