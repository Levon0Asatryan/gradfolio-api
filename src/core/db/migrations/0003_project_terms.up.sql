-- Project technologies and tags move from JSON columns into tables, with one
-- canonical spelling per term (tracker 1.6, plan §6).
--
-- Why tables: matching must be case-insensitive (JSON_CONTAINS is exact), and on
-- MySQL 8.4.11 a correlated EXISTS over JSON_TABLE(p.technologies) returns no
-- rows at all. The tables match through their collation and use an index.
--
-- `terms` holds the canonical spelling of every skill, technology and tag,
-- keyed case-insensitively: the first spelling to reach the key wins, and every
-- writer stores that spelling (src/core/db/terms.ts). The new tables take the
-- database's default collation, like the baseline tables they join with.
--
-- Legacy values are normalized before they are registered, with the SQL twin
-- of normalizeTerm: TRIM(REGEXP_REPLACE(x, '[[:space:]]+', ' ')). Elements are
-- read as TEXT ... ERROR ON ERROR: by default JSON_TABLE turns a value too long
-- for its column into NULL, which would drop it silently; this way an
-- over-long name fails the insert (1406) and the migration stops.
--
-- Case-insensitive duplicate skills (React + react for one user) would make
-- the UNIQUE key fail with 1062, so they are merged first: the entry with the
-- lowest sort_order stays. Audit before migrating an existing database:
--
--   SELECT s1.user_id, s1.skill_name FROM user_skills s1 JOIN user_skills s2
--     ON s1.user_id = s2.user_id AND s1.skill_name = s2.skill_name
--    AND (s1.sort_order > s2.sort_order OR (s1.sort_order = s2.sort_order AND s1.id > s2.id));

CREATE TABLE IF NOT EXISTS terms (
  name VARCHAR(255) NOT NULL,
  PRIMARY KEY (name)
);

CREATE TABLE IF NOT EXISTS project_technologies (
  project_id CHAR(36)     NOT NULL,
  name       VARCHAR(255) NOT NULL,
  sort_order INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, name),
  INDEX idx_project_technologies_name (name),
  CONSTRAINT fk_project_technologies_project
    FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS project_tags (
  project_id CHAR(36)     NOT NULL,
  name       VARCHAR(255) NOT NULL,
  sort_order INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, name),
  INDEX idx_project_tags_name (name),
  CONSTRAINT fk_project_tags_project
    FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);

UPDATE user_skills
   SET skill_name = TRIM(REGEXP_REPLACE(skill_name, '[[:space:]]+', ' '))
 WHERE CAST(skill_name AS BINARY) <> CAST(TRIM(REGEXP_REPLACE(skill_name, '[[:space:]]+', ' ')) AS BINARY);

DELETE FROM user_skills WHERE skill_name = '';

INSERT INTO project_technologies (project_id, name, sort_order)
  SELECT p.id, TRIM(REGEXP_REPLACE(jt.name, '[[:space:]]+', ' ')), jt.ord - 1
    FROM projects p,
         JSON_TABLE(p.technologies, '$[*]' COLUMNS (ord FOR ORDINALITY, name TEXT PATH '$' ERROR ON ERROR)) AS jt
   WHERE TRIM(REGEXP_REPLACE(jt.name, '[[:space:]]+', ' ')) <> ''
  ON DUPLICATE KEY UPDATE project_technologies.project_id = project_technologies.project_id;

INSERT INTO project_tags (project_id, name, sort_order)
  SELECT p.id, TRIM(REGEXP_REPLACE(jt.name, '[[:space:]]+', ' ')), jt.ord - 1
    FROM projects p,
         JSON_TABLE(p.tags, '$[*]' COLUMNS (ord FOR ORDINALITY, name TEXT PATH '$' ERROR ON ERROR)) AS jt
   WHERE TRIM(REGEXP_REPLACE(jt.name, '[[:space:]]+', ' ')) <> ''
  ON DUPLICATE KEY UPDATE project_tags.project_id = project_tags.project_id;

-- Skills register first, so an existing skill's spelling wins over a
-- technology's; within a table, the lowest sort_order.
INSERT INTO terms (name)
  SELECT s.skill_name FROM user_skills s ORDER BY s.sort_order, s.id
  ON DUPLICATE KEY UPDATE terms.name = terms.name;

INSERT INTO terms (name)
  SELECT x.name FROM project_technologies x ORDER BY x.sort_order, x.project_id
  ON DUPLICATE KEY UPDATE terms.name = terms.name;

INSERT INTO terms (name)
  SELECT x.name FROM project_tags x ORDER BY x.sort_order, x.project_id
  ON DUPLICATE KEY UPDATE terms.name = terms.name;

UPDATE user_skills s JOIN terms t ON t.name = s.skill_name
   SET s.skill_name = t.name
 WHERE CAST(s.skill_name AS BINARY) <> CAST(t.name AS BINARY);

UPDATE project_technologies x JOIN terms t ON t.name = x.name
   SET x.name = t.name
 WHERE CAST(x.name AS BINARY) <> CAST(t.name AS BINARY);

UPDATE project_tags x JOIN terms t ON t.name = x.name
   SET x.name = t.name
 WHERE CAST(x.name AS BINARY) <> CAST(t.name AS BINARY);

DELETE s1 FROM user_skills s1
  JOIN user_skills s2
    ON s1.user_id = s2.user_id AND s1.skill_name = s2.skill_name
   AND (s1.sort_order > s2.sort_order OR (s1.sort_order = s2.sort_order AND s1.id > s2.id));

-- skip-if: SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'projects' AND column_name = 'tags')
ALTER TABLE projects DROP COLUMN tags, DROP COLUMN technologies;

-- skip-if: SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'user_skills' AND index_name = 'uq_user_skills_user_name'
ALTER TABLE user_skills ADD UNIQUE KEY uq_user_skills_user_name (user_id, skill_name);
