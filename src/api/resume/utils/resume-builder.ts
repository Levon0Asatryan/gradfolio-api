import { type ResumeData, resumeUrl } from './resume-data.js';

type Entry = ResumeData['blocks'][number]['entries'][number];

/**
 * One line of a section, before validation. `link` prints a URL as its own clickable text;
 * `urls` are candidates for an entry's link, and the first safe one wins.
 */
export type ResumeEntryInput =
  | { title?: string; text: string; urls?: readonly (string | null | undefined)[] }
  | { link: string | null | undefined };

/**
 * Assembles what a résumé contains, in reading order: a header, then sections of entries.
 * Every link passes `resumeUrl`, and a section with no entries is left out.
 */
export class ResumeBuilder {
  private readonly blocks: ResumeData['blocks'] = [];

  constructor(
    private readonly name: string,
    private readonly headline: string,
  ) {}

  section(title: string, entries: readonly ResumeEntryInput[]): this {
    const kept = entries.map(toEntry).filter((e) => e !== undefined);
    if (kept.length) this.blocks.push({ title, entries: kept });
    return this;
  }

  build(): ResumeData {
    return { name: this.name, headline: this.headline, blocks: [...this.blocks] };
  }
}

function toEntry(input: ResumeEntryInput): Entry | undefined {
  if ('link' in input) {
    const url = resumeUrl(input.link ?? null);
    return url ? { text: url, url } : undefined;
  }
  const url = input.urls?.map((u) => resumeUrl(u ?? null)).find((u) => u !== undefined);
  return { ...(input.title !== undefined && { title: input.title }), text: input.text, url };
}
