-- Deletion tombstone (docs/modules/m7/plan.md §2.8, M7-T23): the `sub`s of deleted
-- accounts, each until the access token that could still carry it has expired.
-- With AUTH0_DELETE_USERS the login is gone, but a token issued before the
-- deletion stays valid for up to its lifetime and would provision a blank,
-- public `users` row from its claims. Provisioning refuses a `sub` listed
-- here. Additive: the previous revision never reads the table, so it serves
-- unchanged while this applies.
--
--   deleted_subjects.auth0_id    the token's `sub` (users.auth0_id)
--   deleted_subjects.expires_at  deletion time + ACCOUNT_TOMBSTONE_TTL_S; a row
--                                past it is inert and purged by the next deletion
--
-- No foreign key: the user row it names is gone by definition.

CREATE TABLE IF NOT EXISTS deleted_subjects (
  auth0_id   VARCHAR(255) NOT NULL,
  expires_at DATETIME     NOT NULL,
  PRIMARY KEY (auth0_id),
  KEY idx_deleted_subjects_expires (expires_at)
);
