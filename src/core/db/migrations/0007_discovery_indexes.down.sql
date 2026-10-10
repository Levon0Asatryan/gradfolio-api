-- Reverses 0007 in the opposite order.

-- skip-if: SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'education' AND index_name = 'idx_education_end_year')
DROP INDEX idx_education_end_year ON education;

-- skip-if: SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'education' AND index_name = 'idx_education_field')
DROP INDEX idx_education_field ON education;

-- skip-if: SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'education' AND index_name = 'idx_education_institution')
DROP INDEX idx_education_institution ON education;

-- skip-if: SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'users' AND index_name = 'idx_users_browse')
DROP INDEX idx_users_browse ON users;

-- skip-if: SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'projects' AND index_name = 'idx_projects_browse_updated')
DROP INDEX idx_projects_browse_updated ON projects;

-- skip-if: SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'projects' AND index_name = 'idx_projects_browse_category')
DROP INDEX idx_projects_browse_category ON projects;

-- skip-if: SELECT 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'projects' AND index_name = 'idx_projects_browse')
DROP INDEX idx_projects_browse ON projects;
