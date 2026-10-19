import { normalizeTerm } from '../../../core/validation/terms.js';

/**
 * Skills the student probably has but has not listed (docs/modules/m7/plan.md §6): pure
 * rules, no I/O. The evidence is a list of items, each a public repository or a
 * project of the student's own, with the names it shows (language, topics,
 * technologies). A project imported from a repository is the same item as that
 * repository, so one piece of work is never counted twice.
 */

/** A skill is offered only when at least this many items show it. */
export const SKILL_MIN_EVIDENCE = 2;
/** The most skill suggestions one refresh may offer: the best evidenced first. */
export const MAX_SKILL_SUGGESTIONS = 10;
/** `suggestions.dedupe_key` is VARCHAR(190). */
const MAX_KEY_LENGTH = 190;

export interface EvidenceItem {
  /** `repo:<github id>` or `project:<id>`; a project with a repository shares the repo's. */
  id: string;
  from: 'repository' | 'project';
  names: readonly string[];
}

export interface WantedSkill {
  name: string;
  dedupeKey: string;
  /** Items that show the skill, in all. */
  evidence: number;
  repositories: number;
  projects: number;
}

/** Case-insensitive, like the skills namespace. */
export const skillKey = (name: string): string => normalizeTerm(name).toLowerCase();

export const skillDedupeKey = (name: string): string => `skill:${skillKey(name)}`;

/** Folds items with one id into one (names joined, both sources kept). */
function merged(items: readonly EvidenceItem[]) {
  const byId = new Map<string, { names: string[]; from: Set<EvidenceItem['from']> }>();
  for (const item of items) {
    const entry = byId.get(item.id) ?? { names: [], from: new Set() };
    entry.names.push(...item.names);
    entry.from.add(item.from);
    byId.set(item.id, entry);
  }
  return [...byId.values()];
}

/**
 * What to offer: skills shown by at least SKILL_MIN_EVIDENCE items and missing
 * from `have` (compared case-insensitively), best evidenced first.
 */
export function skillsToOffer(
  items: readonly EvidenceItem[],
  have: Iterable<string>,
): WantedSkill[] {
  const owned = new Set([...have].map(skillKey));
  const found = new Map<string, WantedSkill>();
  for (const item of merged(items)) {
    const inThisItem = new Set<string>();
    for (const raw of item.names) {
      const name = normalizeTerm(raw);
      const key = skillKey(name);
      if (key === '' || owned.has(key) || inThisItem.has(key)) continue;
      inThisItem.add(key);
      const dedupeKey = skillDedupeKey(name);
      if (dedupeKey.length > MAX_KEY_LENGTH) continue;
      // The first spelling seen stays; the registry fixes the stored one on accept.
      const entry = found.get(key) ?? {
        name,
        dedupeKey,
        evidence: 0,
        repositories: 0,
        projects: 0,
      };
      entry.evidence++;
      if (item.from.has('repository')) entry.repositories++;
      if (item.from.has('project')) entry.projects++;
      found.set(key, entry);
    }
  }
  return [...found.values()]
    .filter((w) => w.evidence >= SKILL_MIN_EVIDENCE)
    .sort((a, b) => b.evidence - a.evidence || a.name.localeCompare(b.name))
    .slice(0, MAX_SKILL_SUGGESTIONS);
}
