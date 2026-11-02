import type { ResumeTemplate } from './resume-template.js';

/**
 * Single column, A4. Colours are palette C, light (gradfolio `tokens.ts`): `heading` and `text`
 * are its `text`, `textSecondary` and `primary` are the same-named tokens.
 */
export const classicTemplate: ResumeTemplate = {
  page: { size: 'A4', margin: 48 },
  colors: { heading: '#1E293B', text: '#1E293B', textSecondary: '#516072', primary: '#2D4E8A' },
  name: { size: 23, color: 'heading' },
  headline: { size: 12, color: 'textSecondary' },
  sectionTitle: { size: 13, color: 'primary' },
  entryTitle: { size: 11, color: 'heading' },
  body: { size: 10, color: 'text' },
  link: { size: 9, color: 'primary' },
  spacing: {
    lineGap: 3,
    paragraphGap: 4,
    afterHeader: 0.6,
    afterSectionTitle: 0.25,
    afterEntry: 0.35,
    afterSection: 0.5,
  },
  keepWithNext: { section: 70, entry: 55 },
};
