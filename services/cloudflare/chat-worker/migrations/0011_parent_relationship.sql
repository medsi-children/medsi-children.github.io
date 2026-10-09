ALTER TABLE chat_profiles ADD COLUMN relationship TEXT NOT NULL DEFAULT 'Родитель';
ALTER TABLE chat_profiles ADD COLUMN child_genitive TEXT NOT NULL DEFAULT '';
