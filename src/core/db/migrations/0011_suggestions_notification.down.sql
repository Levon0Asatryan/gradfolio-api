-- Reverses 0011. Notifications of the type it added cannot exist without it,
-- so they are deleted first.

DELETE FROM notifications WHERE type = 'suggestions_available';

-- skip-if: SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'notifications' AND column_name = 'type' AND column_type LIKE '%suggestions_available%')
ALTER TABLE notifications
  MODIFY COLUMN type ENUM('team_invite','team_accepted','team_rejected',
                          'project_verified','comment','contact_request',
                          'general','team_left') NOT NULL;
