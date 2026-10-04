-- skip-if: SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'contact_email')
ALTER TABLE users
  DROP COLUMN onboarded_at,
  DROP COLUMN contact_email;
