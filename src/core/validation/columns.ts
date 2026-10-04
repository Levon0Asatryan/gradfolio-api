import { chars, type ColumnLimit, LONGTEXT, limitedString, TEXT } from './text.js';

/**
 * The real limit of every string column, as the migrations define it.
 * column-limits.int.test.ts compares this map with information_schema after
 * migrating, so a migration that changes a length fails until this follows.
 * ENUM and JSON columns are validated by their own schemas, not here.
 */
export const COLUMN_LIMITS = {
  'users.id': chars(36),
  'users.auth0_id': chars(255),
  'users.name': chars(255),
  'users.headline': chars(500),
  'users.location': chars(255),
  'users.email': chars(255),
  'users.contact_email': chars(255),
  'users.avatar_url': TEXT,
  'users.bio': TEXT,
  'users.github': chars(500),
  'users.linkedin': chars(500),
  'users.twitter': chars(500),
  'users.website': chars(500),
  'users.phone': chars(50),

  'education.id': chars(36),
  'education.user_id': chars(36),
  'education.institution': chars(500),
  'education.degree': chars(500),
  'education.field': chars(500),
  'education.description': TEXT,

  'experience.id': chars(36),
  'experience.user_id': chars(36),
  'experience.title': chars(500),
  'experience.organization': chars(500),
  'experience.start': chars(7),
  'experience.end': chars(7),
  'experience.summary': TEXT,

  'certifications.id': chars(36),
  'certifications.user_id': chars(36),
  'certifications.name': chars(500),
  'certifications.issuer': chars(500),
  'certifications.date': chars(7),
  'certifications.credential_url': TEXT,

  'user_skills.id': chars(36),
  'user_skills.user_id': chars(36),
  'user_skills.skill_name': chars(255),

  'terms.name': chars(255),
  'project_technologies.project_id': chars(36),
  'project_technologies.name': chars(255),
  'project_tags.project_id': chars(36),
  'project_tags.name': chars(255),

  'projects.id': chars(36),
  'projects.user_id': chars(36),
  'projects.title': chars(500),
  'projects.summary': TEXT,
  'projects.ai_summary': TEXT,
  'projects.hero_image_url': TEXT,
  'projects.description_html': LONGTEXT,
  'projects.live_demo_url': TEXT,
  'projects.href': TEXT,
  'projects.repo_url': TEXT,
  'projects.repo_readme_url': TEXT,
  'projects.repo_language': chars(100),
  'projects.meta_course': chars(500),
  'projects.meta_professor': chars(500),

  'project_attachments.id': chars(36),
  'project_attachments.project_id': chars(36),
  'project_attachments.url': TEXT,
  'project_attachments.title': chars(500),
  'project_attachments.thumbnail_url': TEXT,

  'project_team_members.id': chars(36),
  'project_team_members.project_id': chars(36),
  'project_team_members.user_id': chars(36),
  'project_team_members.name': chars(255),
  'project_team_members.role': chars(255),
  'project_team_members.avatar_url': TEXT,

  'integrations.id': chars(36),
  'integrations.user_id': chars(36),
  'integrations.access_token': TEXT,
  'integrations.refresh_token': TEXT,
  'integrations.external_user_id': chars(255),

  'activities.id': chars(36),
  'activities.user_id': chars(36),
  'activities.translation_key': chars(255),
  'activities.details': TEXT,

  'notifications.id': chars(36),
  'notifications.user_id': chars(36),
  'notifications.title': chars(500),
  'notifications.message': TEXT,
  'notifications.reference_id': chars(36),
  'notifications.reference_type': chars(50),
  'notifications.link': TEXT,
} as const satisfies Record<string, ColumnLimit>;

export type StringColumn = keyof typeof COLUMN_LIMITS;

/** A string that fits `table.column`, by that column's real limit. */
export function columnString(column: StringColumn) {
  return limitedString(COLUMN_LIMITS[column]);
}
