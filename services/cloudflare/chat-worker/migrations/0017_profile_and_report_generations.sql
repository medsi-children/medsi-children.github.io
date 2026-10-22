-- Additive foundation for fencing stale profile and report writes. Runtime
-- behavior stays unchanged until a later compatible Worker release uses these
-- fields. Existing history is intentionally left unassigned to a new admission.
ALTER TABLE chat_profiles ADD COLUMN profile_generation TEXT NOT NULL DEFAULT '';
ALTER TABLE chat_profiles ADD COLUMN child_admission_id TEXT NOT NULL DEFAULT '';

ALTER TABLE report_current ADD COLUMN profile_generation TEXT NOT NULL DEFAULT '';
ALTER TABLE report_current ADD COLUMN child_admission_id TEXT NOT NULL DEFAULT '';
ALTER TABLE report_current ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE report_current ADD COLUMN publication_id TEXT NOT NULL DEFAULT '';

ALTER TABLE report_snapshots ADD COLUMN profile_generation TEXT NOT NULL DEFAULT '';
ALTER TABLE report_snapshots ADD COLUMN child_admission_id TEXT NOT NULL DEFAULT '';
ALTER TABLE report_snapshots ADD COLUMN publication_id TEXT NOT NULL DEFAULT '';

ALTER TABLE parent_deletion_queue ADD COLUMN profile_generation TEXT NOT NULL DEFAULT '';

-- Only attach a generation when the current D1 profile exactly matches a
-- completed registration record. Ambiguous/unmatched profiles remain legacy.
UPDATE chat_profiles
SET profile_generation = (
  SELECT attempt_id
  FROM parent_registration_attempts
  WHERE parent_registration_attempts.phone10 = chat_profiles.phone10
    AND parent_registration_attempts.parent_name = chat_profiles.parent_name
    AND parent_registration_attempts.child_name = chat_profiles.child_name
  ORDER BY created_at DESC, attempt_id DESC
  LIMIT 1
)
WHERE profile_generation = ''
  AND EXISTS (
    SELECT 1
    FROM parent_registration_attempts
    WHERE parent_registration_attempts.phone10 = chat_profiles.phone10
      AND parent_registration_attempts.parent_name = chat_profiles.parent_name
      AND parent_registration_attempts.child_name = chat_profiles.child_name
  );

UPDATE report_current
SET profile_generation = (
  SELECT profile_generation FROM chat_profiles
  WHERE chat_profiles.phone10 = report_current.phone10
)
WHERE profile_generation = ''
  AND EXISTS (
    SELECT 1 FROM chat_profiles
    WHERE chat_profiles.phone10 = report_current.phone10
      AND chat_profiles.profile_generation <> ''
  );

CREATE INDEX IF NOT EXISTS idx_parent_deletion_generation
  ON parent_deletion_queue(phone10, profile_generation, status);
