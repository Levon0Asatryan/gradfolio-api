-- Suggestions (docs/modules/m7/plan.md §6.4): proposals computed from GitHub and the
-- sign-in claims that the student accepts or dismisses; nothing is applied
-- without an accept. Additive: the previous revision never reads the table or
-- the new columns, so it serves unchanged while this applies.
--
--   suggestions.dedupe_key   one row per (user, key): a poll is idempotent, and a
--                            dismissed suggestion with the same key never returns.
--                            The key carries a hash of the proposed value, so a new
--                            upstream value is a new key (e.g. `profile:bio:<h16>`)
--   suggestions.status       open -> accepted | dismissed | superseded (the value it
--                            proposed is no longer what GitHub says, or the field
--                            already equals it)
--   integrations.suggestions_polled_at  the last refresh claim; its floor is
--                            SUGGESTIONS_MIN_INTERVAL_S
--   integrations.profile_etag, profile_snapshot  GitHub's public profile fields as
--                            last read (not a token: bio, location, company,
--                            avatar, blog, profile URL), so a 304 recomputes
--                            from them

CREATE TABLE IF NOT EXISTS suggestions (
  id          CHAR(36)     NOT NULL,
  user_id     CHAR(36)     NOT NULL,
  kind        VARCHAR(40)  NOT NULL,
  source      ENUM('github','linkedin','auth0') NOT NULL,
  target_id   CHAR(36)     NULL,
  dedupe_key  VARCHAR(190) NOT NULL,
  payload     JSON         NOT NULL,
  status      ENUM('open','accepted','dismissed','superseded') NOT NULL DEFAULT 'open',
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_suggestions_user_key (user_id, dedupe_key),
  KEY idx_suggestions_user_status (user_id, status, created_at, id),
  CONSTRAINT fk_suggestions_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT ck_suggestions_payload CHECK (JSON_TYPE(payload) = 'OBJECT')
);

-- skip-if: SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'integrations' AND column_name = 'suggestions_polled_at'
ALTER TABLE integrations
  ADD COLUMN suggestions_polled_at DATETIME NULL,
  ADD COLUMN profile_etag VARCHAR(255) NULL,
  ADD COLUMN profile_snapshot JSON NULL,
  ALGORITHM=INSTANT;
