import { z } from 'zod';

/**
 * Every activity the API writes: its key, whether it is a `project` or a
 * `profile` event, and the exact shape of its parameters (docs/m5-plan.md §8).
 *
 * The frontend renders the text from the key and the parameters (its
 * `dashboard.activity.<key>` strings, placeholders `{name}`, `{skill}`,
 * `{member}`, `{count}`), so the API stores no prose and no language. Strict
 * schemas keep the parameters to what the feed needs -- an id, a display name,
 * a count -- and nothing a reader of the feed could not already see: never a
 * description, an email, a link or another user's private field.
 *
 * A write with an unknown key or parameters outside the schema throws, and
 * because it runs inside the transaction of the event it reports, the event
 * does not happen either.
 */

const projectId = z.string().min(1).max(36);
/** A project title or a person's display name: as long as the columns they came from. */
const label = z.string().min(1).max(255);

const project = z.strictObject({ projectId, name: label });
const projectWithMember = z.strictObject({ projectId, name: label, member: label });

export const ACTIVITY_REGISTRY = {
  projectCreated: { type: 'project', params: project },
  projectPublished: { type: 'project', params: project },
  // The project is gone, so no id: only the name it had.
  projectDeleted: { type: 'project', params: z.strictObject({ name: label }) },
  newSkill: { type: 'profile', params: z.strictObject({ skill: label }) },
  skillsAdded: { type: 'profile', params: z.strictObject({ count: z.number().int().min(2) }) },
  // The owner's feed:
  teamInvited: { type: 'project', params: projectWithMember },
  teamMemberJoined: { type: 'project', params: projectWithMember },
  teamMemberDeclined: { type: 'project', params: projectWithMember },
  teamLeft: { type: 'project', params: projectWithMember },
  // The new member's feed:
  teamJoined: { type: 'project', params: project },
} as const;

export type ActivityKey = keyof typeof ACTIVITY_REGISTRY;
export type ActivityParams<K extends ActivityKey> = z.input<
  (typeof ACTIVITY_REGISTRY)[K]['params']
>;

export class InvalidActivityError extends Error {
  override name = 'InvalidActivityError';
}

/** The row to store for `key` and `params`, or a throw: unknown key, or parameters off the schema. */
export function checkActivity<K extends ActivityKey>(
  key: K,
  params: ActivityParams<K>,
): { type: 'project' | 'profile'; params: Record<string, string | number> } {
  // `key` is typed, but a caller can still pass a string that is not an own key.
  if (!Object.hasOwn(ACTIVITY_REGISTRY, key)) {
    throw new InvalidActivityError('unknown activity key');
  }
  const entry = ACTIVITY_REGISTRY[key];
  const parsed = entry.params.safeParse(params);
  if (!parsed.success) {
    throw new InvalidActivityError(`activity ${key}: parameters do not fit its schema`);
  }
  return { type: entry.type, params: parsed.data };
}
