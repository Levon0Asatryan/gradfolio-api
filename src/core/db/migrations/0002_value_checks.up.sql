-- CHECK constraints on every JSON and YYYY-MM column (tracker 1.8, plan §7).
--
-- Defence in depth: the API validates every write with the zod schemas in
-- src/core/validation; these stop a write path that forgets. They check shape
-- only (arrays of strings, {label, url} objects, the month format). URL schemes
-- and lengths stay the API's job.
--
-- Existing rows: adding a CHECK that a row violates fails with 3819 and adds
-- nothing (the ALTER is atomic), so the runner stops at that step. Find the
-- offending rows, correct them by hand, and run `npm run migrate` again. The
-- audit, per table (every row it returns must be fixed):
--
--   SELECT id FROM education WHERE highlights IS NOT NULL
--     AND NOT JSON_SCHEMA_VALID('{"type":"array","items":{"type":"string"}}', highlights);
--   SELECT id FROM experience
--    WHERE (achievements IS NOT NULL AND NOT JSON_SCHEMA_VALID('{"type":"array","items":{"type":"string"}}', achievements))
--       OR (skills IS NOT NULL AND NOT JSON_SCHEMA_VALID('{"type":"array","items":{"type":"string"}}', skills))
--       OR NOT REGEXP_LIKE(start, '^[0-9]{4}-(0[1-9]|1[0-2])$')
--       OR (`end` IS NOT NULL AND NOT REGEXP_LIKE(`end`, '^[0-9]{4}-(0[1-9]|1[0-2])$'));
--   SELECT id FROM certifications WHERE NOT REGEXP_LIKE(date, '^[0-9]{4}-(0[1-9]|1[0-2])$');
--   SELECT id FROM projects (tags, technologies, links, files as below);
--   SELECT id FROM activities WHERE translation_params IS NOT NULL AND NOT JSON_SCHEMA_VALID(…);
--
-- Each ALTER adds all of one table's constraints atomically, so a guard on the
-- first constraint's name is enough.

-- skip-if: SELECT 1 FROM information_schema.check_constraints WHERE constraint_schema = DATABASE() AND constraint_name = 'ck_education_highlights'
ALTER TABLE education
  ADD CONSTRAINT ck_education_highlights CHECK (
    highlights IS NULL OR JSON_SCHEMA_VALID('{"type":"array","items":{"type":"string"}}', highlights)
  );

-- skip-if: SELECT 1 FROM information_schema.check_constraints WHERE constraint_schema = DATABASE() AND constraint_name = 'ck_experience_achievements'
ALTER TABLE experience
  ADD CONSTRAINT ck_experience_achievements CHECK (
    achievements IS NULL OR JSON_SCHEMA_VALID('{"type":"array","items":{"type":"string"}}', achievements)
  ),
  ADD CONSTRAINT ck_experience_skills CHECK (
    skills IS NULL OR JSON_SCHEMA_VALID('{"type":"array","items":{"type":"string"}}', skills)
  ),
  ADD CONSTRAINT ck_experience_start CHECK (REGEXP_LIKE(start, '^[0-9]{4}-(0[1-9]|1[0-2])$')),
  ADD CONSTRAINT ck_experience_end CHECK (
    `end` IS NULL OR REGEXP_LIKE(`end`, '^[0-9]{4}-(0[1-9]|1[0-2])$')
  );

-- skip-if: SELECT 1 FROM information_schema.check_constraints WHERE constraint_schema = DATABASE() AND constraint_name = 'ck_certifications_date'
ALTER TABLE certifications
  ADD CONSTRAINT ck_certifications_date CHECK (REGEXP_LIKE(date, '^[0-9]{4}-(0[1-9]|1[0-2])$'));

-- skip-if: SELECT 1 FROM information_schema.check_constraints WHERE constraint_schema = DATABASE() AND constraint_name = 'ck_projects_tags'
ALTER TABLE projects
  ADD CONSTRAINT ck_projects_tags CHECK (
    tags IS NULL OR JSON_SCHEMA_VALID('{"type":"array","items":{"type":"string"}}', tags)
  ),
  ADD CONSTRAINT ck_projects_technologies CHECK (
    technologies IS NULL OR JSON_SCHEMA_VALID('{"type":"array","items":{"type":"string"}}', technologies)
  ),
  ADD CONSTRAINT ck_projects_links CHECK (
    links IS NULL OR JSON_SCHEMA_VALID('{"type":"array","items":{"type":"object","required":["label","url"],"properties":{"label":{"type":"string"},"url":{"type":"string"}}}}', links)
  ),
  ADD CONSTRAINT ck_projects_files CHECK (
    files IS NULL OR JSON_SCHEMA_VALID('{"type":"array","items":{"type":"object","required":["label","url"],"properties":{"label":{"type":"string"},"url":{"type":"string"}}}}', files)
  );

-- skip-if: SELECT 1 FROM information_schema.check_constraints WHERE constraint_schema = DATABASE() AND constraint_name = 'ck_activities_translation_params'
ALTER TABLE activities
  ADD CONSTRAINT ck_activities_translation_params CHECK (
    translation_params IS NULL OR JSON_SCHEMA_VALID('{"type":"object","additionalProperties":{"type":["string","number"]}}', translation_params)
  );
