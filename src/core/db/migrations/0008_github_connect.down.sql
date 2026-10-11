-- Reverses 0008 in the opposite order. A reservation ('linking') has no
-- meaning without this migration, so it becomes 'not_connected' with its GitHub
-- id cleared before the value is removed from the ENUM.

DROP TABLE IF EXISTS project_github_imports;

DROP TABLE IF EXISTS integration_nonces;

-- skip-if: SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM information_schema.check_constraints WHERE constraint_schema = DATABASE() AND constraint_name = 'ck_integrations_no_tokens')
ALTER TABLE integrations
  DROP CHECK ck_integrations_no_tokens;

-- skip-if: SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'integrations' AND index_name = 'uq_integration_external')
ALTER TABLE integrations
  DROP INDEX uq_integration_external;

-- skip-if: SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'integrations' AND column_name = 'external_login')
ALTER TABLE integrations
  DROP COLUMN external_login,
  DROP COLUMN generation;

UPDATE integrations
   SET status = 'not_connected', external_user_id = NULL
 WHERE status = 'linking';

-- skip-if: SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'integrations' AND column_name = 'status' AND column_type LIKE '%linking%')
ALTER TABLE integrations
  MODIFY COLUMN status ENUM('connected','not_connected') NOT NULL DEFAULT 'not_connected';
