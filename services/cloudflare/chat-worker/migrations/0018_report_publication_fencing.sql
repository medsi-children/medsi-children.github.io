-- Source-order fence for Apps Script current-report publications and history.
-- The source fingerprint is generated from the current Sheets snapshot by GAS.
CREATE TABLE IF NOT EXISTS report_publication_state (
  kind TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0,
  source_fingerprint TEXT NOT NULL DEFAULT '',
  publication_id TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE report_snapshots ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
