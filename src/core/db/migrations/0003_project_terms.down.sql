-- Puts technologies and tags back into JSON columns on projects, in their
-- stored order, and drops the term tables. Duplicate skills that the up
-- migration merged, and spellings it made canonical, are not restored: they
-- were the same term.
--
-- GROUP_CONCAT(... ORDER BY sort_order) rather than JSON_ARRAYAGG, whose
-- element order is undefined; the SET_VAR hint lifts GROUP_CONCAT's 1024-byte
-- default, which would otherwise truncate a long list into invalid JSON.

-- skip-if: SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'projects' AND column_name = 'tags'
ALTER TABLE projects
  ADD COLUMN tags JSON NULL AFTER is_public,
  ADD COLUMN technologies JSON NULL AFTER tags,
  ADD CONSTRAINT ck_projects_tags CHECK (
    tags IS NULL OR JSON_SCHEMA_VALID('{"type":"array","items":{"type":"string"}}', tags)
  ),
  ADD CONSTRAINT ck_projects_technologies CHECK (
    technologies IS NULL OR JSON_SCHEMA_VALID('{"type":"array","items":{"type":"string"}}', technologies)
  );

UPDATE /*+ SET_VAR(group_concat_max_len = 16777216) */ projects p
   SET p.tags = (
     SELECT CONCAT('[', GROUP_CONCAT(JSON_QUOTE(x.name) ORDER BY x.sort_order, x.name SEPARATOR ','), ']')
       FROM project_tags x WHERE x.project_id = p.id
   );

UPDATE /*+ SET_VAR(group_concat_max_len = 16777216) */ projects p
   SET p.technologies = (
     SELECT CONCAT('[', GROUP_CONCAT(JSON_QUOTE(x.name) ORDER BY x.sort_order, x.name SEPARATOR ','), ']')
       FROM project_technologies x WHERE x.project_id = p.id
   );

-- skip-if: SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'user_skills' AND index_name = 'uq_user_skills_user_name')
ALTER TABLE user_skills DROP INDEX uq_user_skills_user_name;

DROP TABLE IF EXISTS project_tags;

DROP TABLE IF EXISTS project_technologies;

DROP TABLE IF EXISTS terms;
