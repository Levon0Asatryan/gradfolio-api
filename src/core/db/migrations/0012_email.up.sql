-- Email preferences and a transactional outbox. Old revisions ignore these fields.
-- Existing email addresses are not assumed to be verified (the badge also means GitHub).
-- skip-if: SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'preferred_language'
ALTER TABLE users
  ADD COLUMN preferred_language ENUM('en','ru','am') NOT NULL DEFAULT 'en',
  ADD COLUMN team_invite_email_enabled TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN email_verified TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN email_suppressed TINYINT(1) NOT NULL DEFAULT 0;

-- skip-if: SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'email_outbox'
CREATE TABLE email_outbox (
  id CHAR(36) NOT NULL,
  recipient_user_id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  actor_name VARCHAR(255) NOT NULL,
  project_title VARCHAR(500) NOT NULL,
  language ENUM('en','ru','am') NOT NULL,
  status ENUM('pending','leased','sent','failed','canceled','uncertain','bounced','complained') NOT NULL DEFAULT 'pending',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  first_attempt_at DATETIME(3) NULL,
  lease_token CHAR(36) NULL,
  lease_expires_at DATETIME(3) NULL,
  provider_message_id VARCHAR(255) NULL,
  destination_hash CHAR(64) NULL,
  failure_code VARCHAR(50) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  sent_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  INDEX idx_email_due (status, next_attempt_at, lease_expires_at),
  INDEX idx_email_invite (project_id, recipient_user_id, created_at),
  CONSTRAINT fk_email_recipient FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_email_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
