-- One notification per refresh that opened repository suggestions
-- (docs/modules/m7/plan.md §6.6e). Additive: the previous revision never writes the
-- new type, and reads an unknown type as `general`, so it serves unchanged while
-- this applies.
--
--   notifications.type   + 'suggestions_available' (appended: no table rebuild)

-- skip-if: SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'notifications' AND column_name = 'type' AND column_type LIKE '%suggestions_available%'
ALTER TABLE notifications
  MODIFY COLUMN type ENUM('team_invite','team_accepted','team_rejected',
                          'project_verified','comment','contact_request',
                          'general','team_left','suggestions_available') NOT NULL;
