DROP TABLE IF EXISTS email_outbox;
-- skip-if: SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'preferred_language')
ALTER TABLE users DROP COLUMN preferred_language, DROP COLUMN team_invite_email_enabled,
  DROP COLUMN email_verified, DROP COLUMN email_suppressed;
