import type { Activity } from '../dto/activity.dto.js';

interface ActivityRow {
  id: string;
  type: 'project' | 'profile';
  translationKey: string;
  translationParams: Record<string, string | number> | null;
  timestamp: Date;
}

/** A stored feed row as the API shows it. Shared by the feed and the dashboard so they cannot drift. */
export function toActivity(r: ActivityRow): Activity {
  return {
    id: r.id,
    type: r.type,
    translationKey: r.translationKey,
    translationParams: r.translationParams,
    timestamp: r.timestamp.toISOString(),
  };
}
