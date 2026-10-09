-- Reverses 0006 in the opposite order. Notifications of the type this
-- migration added cannot exist without it, so they are deleted first; the
-- same goes for params, which only a revision with this migration writes.

-- skip-if: SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'activities' AND index_name = 'idx_activities_user_ts')
DROP INDEX idx_activities_user_ts ON activities;

-- skip-if: SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'notifications' AND index_name = 'idx_notifications_user_created')
DROP INDEX idx_notifications_user_created ON notifications;

DELETE FROM notifications WHERE type = 'team_left';

-- skip-if: SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'notifications' AND column_name = 'type' AND column_type LIKE '%team_left%')
ALTER TABLE notifications
  MODIFY COLUMN type ENUM('team_invite','team_accepted','team_rejected',
                          'project_verified','comment','contact_request',
                          'general') NOT NULL;

-- skip-if: SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'notifications' AND column_name = 'params')
ALTER TABLE notifications
  DROP CHECK ck_notifications_params,
  DROP COLUMN params;
