CREATE TABLE IF NOT EXISTS legacy_parent_access (
  phone10 TEXT PRIMARY KEY,
  parent_name TEXT NOT NULL,
  child_name TEXT NOT NULL,
  captured_at INTEGER NOT NULL
);

-- Capture pre-Cloudflare accounts once. New app registrations have an attempt
-- row and are deliberately excluded from the legacy-session compatibility set.
INSERT OR IGNORE INTO legacy_parent_access (phone10, parent_name, child_name, captured_at)
SELECT profile.phone10, profile.parent_name, profile.child_name, CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM chat_profiles AS profile
WHERE NOT EXISTS (
  SELECT 1 FROM parent_registration_attempts AS attempt WHERE attempt.phone10 = profile.phone10
);
