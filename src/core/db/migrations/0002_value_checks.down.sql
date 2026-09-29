-- Drops the CHECK constraints 0002 added. Each ALTER drops one table's
-- constraints atomically, so a guard on the first one's name is enough.

-- skip-if: SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM information_schema.check_constraints WHERE constraint_schema = DATABASE() AND constraint_name = 'ck_activities_translation_params')
ALTER TABLE activities DROP CHECK ck_activities_translation_params;

-- skip-if: SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM information_schema.check_constraints WHERE constraint_schema = DATABASE() AND constraint_name = 'ck_projects_tags')
ALTER TABLE projects
  DROP CHECK ck_projects_tags,
  DROP CHECK ck_projects_technologies,
  DROP CHECK ck_projects_links,
  DROP CHECK ck_projects_files;

-- skip-if: SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM information_schema.check_constraints WHERE constraint_schema = DATABASE() AND constraint_name = 'ck_certifications_date')
ALTER TABLE certifications DROP CHECK ck_certifications_date;

-- skip-if: SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM information_schema.check_constraints WHERE constraint_schema = DATABASE() AND constraint_name = 'ck_experience_achievements')
ALTER TABLE experience
  DROP CHECK ck_experience_achievements,
  DROP CHECK ck_experience_skills,
  DROP CHECK ck_experience_start,
  DROP CHECK ck_experience_end;

-- skip-if: SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM information_schema.check_constraints WHERE constraint_schema = DATABASE() AND constraint_name = 'ck_education_highlights')
ALTER TABLE education DROP CHECK ck_education_highlights;
