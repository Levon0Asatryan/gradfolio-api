-- Discovery indexes (docs/m6-plan.md §5). Additive: the previous revision never
-- names them, so it serves unchanged while they build (BTREE, INPLACE, no lock).
-- Nothing is dropped, tightened or rewritten.
--
--   projects (is_public, is_draft, ...)   published projects newest/updated first,
--                          alone and by category: an index range scan with no
--                          filesort, so a page costs its rows, not the table
--   users (is_public, created_at, id)      public users newest first
--   education (institution|field|end_year, ...)  the school, major and graduation
--                          year filters of the user directory; the text columns
--                          are VARCHAR(500) utf8mb4, so a 100-character prefix
--                          keeps the key small and equality still uses it

-- skip-if: SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'projects' AND index_name = 'idx_projects_browse'
CREATE INDEX idx_projects_browse ON projects (is_public, is_draft, created_at, id);

-- skip-if: SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'projects' AND index_name = 'idx_projects_browse_category'
CREATE INDEX idx_projects_browse_category ON projects (is_public, is_draft, category, created_at, id);

-- skip-if: SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'projects' AND index_name = 'idx_projects_browse_updated'
CREATE INDEX idx_projects_browse_updated ON projects (is_public, is_draft, updated_at, id);

-- skip-if: SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'users' AND index_name = 'idx_users_browse'
CREATE INDEX idx_users_browse ON users (is_public, created_at, id);

-- skip-if: SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'education' AND index_name = 'idx_education_institution'
CREATE INDEX idx_education_institution ON education (institution(100), end_year, user_id);

-- skip-if: SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'education' AND index_name = 'idx_education_field'
CREATE INDEX idx_education_field ON education (field(100), end_year, user_id);

-- skip-if: SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'education' AND index_name = 'idx_education_end_year'
CREATE INDEX idx_education_end_year ON education (end_year, user_id);
