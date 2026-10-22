ALTER TABLE report_current ADD COLUMN read_version TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS report_inactivity_state (
  phone10 TEXT PRIMARY KEY,
  last_new_report_at INTEGER NOT NULL DEFAULT 0,
  first_seen_at INTEGER NOT NULL DEFAULT 0,
  last_prompt_days INTEGER NOT NULL DEFAULT 0 CHECK (last_prompt_days IN (0, 3, 7, 21)),
  roster_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_report_inactivity_order
  ON report_inactivity_state (roster_order DESC);
