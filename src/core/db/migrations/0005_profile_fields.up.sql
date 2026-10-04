-- Two profile columns (docs/m3-plan.md §5.2), in one atomic ALTER.
--
--   contact_email  the address shown on the public profile, chosen by the
--                  user. users.email (the login address, pre-filled from
--                  Auth0) stays private: publishing it would expose an address
--                  the user never chose to show.
--   onboarded_at   when the user finished (or skipped) first-login onboarding;
--                  NULL means the frontend should still offer it. No backfill:
--                  existing accounts see onboarding once.

-- skip-if: SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'contact_email'
ALTER TABLE users
  ADD COLUMN contact_email VARCHAR(255) NULL AFTER email,
  ADD COLUMN onboarded_at DATETIME NULL AFTER verified;
