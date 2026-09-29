-- ============================================================
-- Gradfolio Database Schema
-- MySQL 8.4+
-- All PKs use CHAR(36) with GENERATED ALWAYS to enforce
-- auto-generated UUIDs — inserts must omit the id column.
-- ============================================================

CREATE DATABASE IF NOT EXISTS gradfolio
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE gradfolio;

-- ============================================================
-- USERS / PROFILES
-- ============================================================

CREATE TABLE users (
  id          CHAR(36)     NOT NULL DEFAULT (UUID()),
  auth0_id    VARCHAR(255) NOT NULL,
  name        VARCHAR(255) NOT NULL,
  headline    VARCHAR(500) NOT NULL DEFAULT '',
  location    VARCHAR(255) NULL,
  verified    TINYINT(1)   NOT NULL DEFAULT 0,
  is_public   TINYINT(1)   NOT NULL DEFAULT 1,
  email       VARCHAR(255) NULL,
  avatar_url  TEXT         NULL,
  bio         TEXT         NULL,
  github      VARCHAR(500) NULL,
  linkedin    VARCHAR(500) NULL,
  twitter     VARCHAR(500) NULL,
  website     VARCHAR(500) NULL,
  phone       VARCHAR(50)  NULL,
  birthday    DATE         NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_auth0 (auth0_id),
  INDEX idx_users_email (email),
  FULLTEXT INDEX ft_users_search (name, headline)
);

-- ============================================================
-- EDUCATION
-- highlights stored as JSON array of strings
-- ============================================================

CREATE TABLE education (
  id          CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id     CHAR(36)     NOT NULL,
  institution VARCHAR(500) NOT NULL,
  degree      VARCHAR(500) NOT NULL,
  field       VARCHAR(500) NOT NULL,
  start_year  SMALLINT     NOT NULL,
  end_year    SMALLINT     NULL,
  description TEXT         NULL,
  highlights  JSON         NULL, -- string[]
  sort_order  INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  INDEX idx_education_user (user_id),
  CONSTRAINT fk_education_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- ============================================================
-- EXPERIENCE
-- achievements and skills stored as JSON arrays
-- ============================================================

CREATE TABLE experience (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id      CHAR(36)     NOT NULL,
  title        VARCHAR(500) NOT NULL,
  organization VARCHAR(500) NOT NULL,
  start        VARCHAR(7)   NOT NULL, -- ISO month YYYY-MM
  end          VARCHAR(7)   NULL,     -- ISO month, NULL means "Present"
  summary      TEXT         NOT NULL,
  achievements JSON         NULL, -- string[]
  skills       JSON         NULL, -- string[]
  sort_order   INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  INDEX idx_experience_user (user_id),
  CONSTRAINT fk_experience_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- ============================================================
-- CERTIFICATIONS
-- ============================================================

CREATE TABLE certifications (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id        CHAR(36)     NOT NULL,
  name           VARCHAR(500) NOT NULL,
  issuer         VARCHAR(500) NOT NULL,
  date           VARCHAR(7)   NOT NULL, -- YYYY-MM
  credential_url TEXT         NULL,
  sort_order     INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  INDEX idx_certifications_user (user_id),
  CONSTRAINT fk_certifications_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- ============================================================
-- USER SKILLS
-- ============================================================

CREATE TABLE user_skills (
  id         CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id    CHAR(36)     NOT NULL,
  skill_name VARCHAR(255) NOT NULL,
  sort_order INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  INDEX idx_user_skills_user (user_id),
  INDEX idx_user_skills_name (skill_name),
  CONSTRAINT fk_user_skills_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- ============================================================
-- PROJECTS
-- tags, technologies, links, files stored as JSON
-- repo and metadata fields embedded directly
-- ============================================================

CREATE TABLE projects (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id          CHAR(36)     NOT NULL,
  title            VARCHAR(500) NOT NULL,
  summary          TEXT         NULL,
  ai_summary       TEXT         NULL,
  hero_image_url   TEXT         NULL,
  description_html LONGTEXT     NULL,
  live_demo_url    TEXT         NULL,
  href             TEXT         NULL,
  category         ENUM('academic','personal','research','hackathon','course','other') NOT NULL DEFAULT 'other',
  status           ENUM('ongoing','completed','archived') NOT NULL DEFAULT 'ongoing',
  is_public        TINYINT(1)   NOT NULL DEFAULT 1,
  tags             JSON         NULL, -- string[]
  technologies     JSON         NULL, -- string[]
  links            JSON         NULL, -- { label, url }[]
  files            JSON         NULL, -- { label, url }[]
  -- repo info
  repo_url              TEXT NULL,
  repo_latest_commit    DATE NULL,
  repo_readme_url       TEXT NULL,
  -- metadata
  meta_start_date  DATE         NULL,
  meta_end_date    DATE         NULL,
  meta_course      VARCHAR(500) NULL,
  meta_professor   VARCHAR(500) NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_projects_user (user_id),
  INDEX idx_projects_category (category),
  INDEX idx_projects_status (status),
  FULLTEXT INDEX ft_projects_search (title, summary, ai_summary),
  CONSTRAINT fk_projects_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- ============================================================
-- PROJECT ATTACHMENTS
-- kept as a proper table since each row has multiple fields
-- ============================================================

CREATE TABLE project_attachments (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()),
  project_id    CHAR(36)     NOT NULL,
  type          ENUM('image','video','pdf','link') NOT NULL,
  url           TEXT         NOT NULL,
  title         VARCHAR(500) NULL,
  thumbnail_url TEXT         NULL,
  sort_order    INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  INDEX idx_project_attach_project (project_id),
  CONSTRAINT fk_project_attach_project
    FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);

-- ============================================================
-- PROJECT TEAM MEMBERS
-- tracks collaborators on a project; teammates must accept
-- ============================================================

CREATE TABLE project_team_members (
  id          CHAR(36)     NOT NULL DEFAULT (UUID()),
  project_id  CHAR(36)     NOT NULL,
  user_id     CHAR(36)     NULL,
  name        VARCHAR(255) NOT NULL,
  role        VARCHAR(255) NULL,
  avatar_url  TEXT         NULL,
  status      ENUM('pending','accepted','rejected') NOT NULL DEFAULT 'pending',
  sort_order  INT          NOT NULL DEFAULT 0,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_team_project (project_id),
  INDEX idx_team_user (user_id),
  UNIQUE KEY uq_team_project_user (project_id, user_id),
  CONSTRAINT fk_team_project
    FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
  CONSTRAINT fk_team_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
);

-- ============================================================
-- INTEGRATIONS
-- ============================================================

CREATE TABLE integrations (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id          CHAR(36)     NOT NULL,
  integration_type ENUM('linkedin','github') NOT NULL,
  status           ENUM('connected','not_connected') NOT NULL DEFAULT 'not_connected',
  access_token     TEXT         NULL,
  refresh_token    TEXT         NULL,
  token_expires_at DATETIME     NULL,
  external_user_id VARCHAR(255) NULL,
  last_synced_at   DATETIME     NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_integration_user_type (user_id, integration_type),
  CONSTRAINT fk_integrations_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- ============================================================
-- ACTIVITIES
-- ============================================================

CREATE TABLE activities (
  id                 CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id            CHAR(36)     NOT NULL,
  type               ENUM('project','profile') NOT NULL,
  translation_key    VARCHAR(255) NOT NULL,
  translation_params JSON         NULL, -- Record<string, string | number>
  timestamp          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  details            TEXT         NULL,
  PRIMARY KEY (id),
  INDEX idx_activities_user (user_id),
  INDEX idx_activities_timestamp (timestamp),
  CONSTRAINT fk_activities_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================

CREATE TABLE notifications (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id         CHAR(36)     NOT NULL,
  type            ENUM('team_invite','team_accepted','team_rejected',
                       'project_verified','comment','contact_request',
                       'general') NOT NULL,
  title           VARCHAR(500) NOT NULL,
  message         TEXT         NULL,
  is_read         TINYINT(1)   NOT NULL DEFAULT 0,
  reference_id    CHAR(36)     NULL,
  reference_type  VARCHAR(50)  NULL,
  link            TEXT         NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_notifications_user (user_id),
  INDEX idx_notifications_user_unread (user_id, is_read),
  INDEX idx_notifications_created (created_at),
  CONSTRAINT fk_notifications_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
