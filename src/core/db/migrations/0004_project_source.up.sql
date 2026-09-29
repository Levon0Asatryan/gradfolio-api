-- Columns for GitHub import (tracker 1.7, plan §3.6), in one atomic ALTER.
--
--   source          where the project came from: typed in, or imported
--   is_draft        imported projects start as drafts, readable by their owner
--                   only until published (M4 applies that on every read path)
--   github_repo_id  GitHub's integer repository id; with user_id it is unique,
--                   so a user imports a repository once (NULLs never clash)
--   repo_stars, repo_forks, repo_language   shown on the project (spec §2)

-- skip-if: SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'projects' AND column_name = 'source'
ALTER TABLE projects
  ADD COLUMN source ENUM('manual','github') NOT NULL DEFAULT 'manual' AFTER status,
  ADD COLUMN is_draft TINYINT(1) NOT NULL DEFAULT 0 AFTER is_public,
  ADD COLUMN github_repo_id BIGINT UNSIGNED NULL AFTER repo_readme_url,
  ADD COLUMN repo_stars INT UNSIGNED NULL AFTER github_repo_id,
  ADD COLUMN repo_forks INT UNSIGNED NULL AFTER repo_stars,
  ADD COLUMN repo_language VARCHAR(100) NULL AFTER repo_forks,
  ADD UNIQUE KEY uq_projects_user_repo (user_id, github_repo_id);
