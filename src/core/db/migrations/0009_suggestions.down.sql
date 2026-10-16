-- Reverses 0009: the table, then the columns.

DROP TABLE IF EXISTS suggestions;

-- skip-if: SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'integrations' AND column_name = 'suggestions_polled_at')
ALTER TABLE integrations
  DROP COLUMN suggestions_polled_at,
  DROP COLUMN profile_etag,
  DROP COLUMN profile_snapshot;
