/** How a résumé looks: values only, no drawing code. `renderResume` reads one of these. */
export interface ResumeTemplate {
  page: { size: 'A4'; margin: number };
  /** Named after the frontend design system's roles (gradfolio `src/components/theme/tokens.ts`). */
  colors: { heading: string; text: string; textSecondary: string; primary: string };
  name: TextStyle;
  headline: TextStyle;
  sectionTitle: TextStyle;
  entryTitle: TextStyle;
  body: TextStyle;
  link: TextStyle;
  /** Gaps in lines (PDFKit `moveDown`), except `lineGap` and `paragraphGap` in points. */
  spacing: {
    lineGap: number;
    paragraphGap: number;
    afterHeader: number;
    afterSectionTitle: number;
    afterEntry: number;
    afterSection: number;
  };
  /** Start a new page when less than this many points are left before a section or entry. */
  keepWithNext: { section: number; entry: number };
}

export interface TextStyle {
  size: number;
  color: keyof ResumeTemplate['colors'];
}
