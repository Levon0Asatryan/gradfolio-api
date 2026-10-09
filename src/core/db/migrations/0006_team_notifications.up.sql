-- Teams and notifications (docs/m5-plan.md §3). Additive: the previous
-- revision never reads these, so it serves unchanged while this applies.
--
--   notifications.params   the snapshot a notification renders from (actor and
--                          project names, role), so the frontend writes the
--                          text in the reader's language; a JSON object
--   notifications.type     + 'team_left' (appended: no table rebuild)
--   (user_id, created_at, id) on notifications and activities: the newest-first
--                          list is an index range scan, not a filesort

-- skip-if: SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'notifications' AND column_name = 'params'
ALTER TABLE notifications
  ADD COLUMN params JSON NULL AFTER message,
  ADD CONSTRAINT ck_notifications_params CHECK (
    params IS NULL OR JSON_SCHEMA_VALID('{"type":"object"}', params)
  );

-- skip-if: SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'notifications' AND column_name = 'type' AND column_type LIKE '%team_left%'
ALTER TABLE notifications
  MODIFY COLUMN type ENUM('team_invite','team_accepted','team_rejected',
                          'project_verified','comment','contact_request',
                          'general','team_left') NOT NULL;

-- skip-if: SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'notifications' AND index_name = 'idx_notifications_user_created'
CREATE INDEX idx_notifications_user_created ON notifications (user_id, created_at, id);

-- skip-if: SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'activities' AND index_name = 'idx_activities_user_ts'
CREATE INDEX idx_activities_user_ts ON activities (user_id, timestamp, id);
