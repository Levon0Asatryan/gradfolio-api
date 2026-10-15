-- GitHub connect and import (docs/m7-plan.md §2.3, §2.6, §3.5, §9). Additive:
-- the previous revision never reads the new column or tables, and never writes
-- a token, so it serves unchanged while this applies.
--
--   integrations.status        + 'linking' (appended, ALGORITHM=INSTANT: run on
--                              8.4.11): a link reserved here, not yet confirmed
--                              by Auth0; never counts as connected
--   integrations.external_login  the GitHub login, shown on the owner's card
--   integrations.generation    bumped by every write of the row: a transition
--                              (connect, disconnect, account deletion) writes
--                              only if the row is still the version it read
--   (integration_type, external_user_id)  one Gradfolio account per GitHub
--                              account; NULLs never clash
--   ck_integrations_no_tokens  no token is ever stored (D2): the token lives at
--                              Auth0 and in memory only
--   integration_nonces         the link nonce's SHA-256, bound to its user, single
--                              use, with an expiry
--   project_github_imports     per imported project, the SHA-256 of each synced
--                              field as last written (re-sync, PR b)
--
-- Existing rows. No revision has written a token (the seed has none), but a
-- token left by hand would make the CHECK fail with 3819; it is cleared first,
-- because storing none is the decision. Two rows with one GitHub id cannot
-- exist (nothing writes external_user_id yet); if one did, adding the key
-- fails with 1062 and the runner stops at that step: find them with
--   SELECT integration_type, external_user_id, COUNT(*) FROM integrations
--    WHERE external_user_id IS NOT NULL GROUP BY 1, 2 HAVING COUNT(*) > 1;
-- and clear the stale one's external_user_id.

-- skip-if: SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'integrations' AND column_name = 'status' AND column_type LIKE '%linking%'
ALTER TABLE integrations
  MODIFY COLUMN status ENUM('connected','not_connected','linking') NOT NULL DEFAULT 'not_connected',
  ALGORITHM=INSTANT;

-- skip-if: SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'integrations' AND column_name = 'external_login'
ALTER TABLE integrations
  ADD COLUMN external_login VARCHAR(100) NULL AFTER external_user_id,
  ADD COLUMN generation INT UNSIGNED NOT NULL DEFAULT 0 AFTER status,
  ALGORITHM=INSTANT;

-- skip-if: SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'integrations' AND index_name = 'uq_integration_external'
ALTER TABLE integrations
  ADD UNIQUE KEY uq_integration_external (integration_type, external_user_id);

UPDATE integrations
   SET access_token = NULL, refresh_token = NULL, token_expires_at = NULL
 WHERE access_token IS NOT NULL OR refresh_token IS NOT NULL OR token_expires_at IS NOT NULL;

-- skip-if: SELECT 1 FROM information_schema.check_constraints WHERE constraint_schema = DATABASE() AND constraint_name = 'ck_integrations_no_tokens'
ALTER TABLE integrations
  ADD CONSTRAINT ck_integrations_no_tokens CHECK (
    access_token IS NULL AND refresh_token IS NULL AND token_expires_at IS NULL
  );

CREATE TABLE IF NOT EXISTS integration_nonces (
  hash       CHAR(64)  NOT NULL,
  user_id    CHAR(36)  NOT NULL,
  expires_at DATETIME  NOT NULL,
  created_at DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (hash),
  INDEX idx_integration_nonces_user (user_id, expires_at),
  CONSTRAINT fk_integration_nonces_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT ck_integration_nonces_hash CHECK (REGEXP_LIKE(hash, '^[0-9a-f]{64}$', 'c'))
);

CREATE TABLE IF NOT EXISTS project_github_imports (
  project_id CHAR(36)  NOT NULL,
  synced_at  DATETIME  NOT NULL,
  snapshot   JSON      NOT NULL,
  PRIMARY KEY (project_id),
  CONSTRAINT fk_project_github_imports_project
    FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
  CONSTRAINT ck_project_github_imports_snapshot CHECK (
    JSON_SCHEMA_VALID('{"type":"object","additionalProperties":{"type":"string","pattern":"^[0-9a-f]{64}$"}}', snapshot)
  )
);
