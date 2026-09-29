-- skip-if: SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'projects' AND column_name = 'source')
ALTER TABLE projects
  DROP INDEX uq_projects_user_repo,
  DROP COLUMN repo_language,
  DROP COLUMN repo_forks,
  DROP COLUMN repo_stars,
  DROP COLUMN github_repo_id,
  DROP COLUMN is_draft,
  DROP COLUMN source;
