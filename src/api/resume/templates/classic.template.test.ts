import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { testConfig } from '../../../testing/database.js';
import { renderResume } from '../utils/render-resume.js';
import { classicTemplate } from './classic.template.js';

/** WCAG 2.x contrast of a `#RRGGBB` colour on white paper. */
function contrastOnWhite(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05);
}

describe('classic template', () => {
  it('uses palette C light colours', () => {
    expect(classicTemplate.colors).toEqual({
      heading: '#1E293B',
      text: '#1E293B',
      textSecondary: '#516072',
      primary: '#2D4E8A',
    });
  });

  it('keeps every text colour at 4.5:1 or more on white', () => {
    for (const color of Object.values(classicTemplate.colors)) {
      expect(contrastOnWhite(color)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('draws text only in the template colours', async () => {
    const pdf = await renderResume(
      {
        name: 'Ani',
        headline: 'Developer',
        blocks: [
          { title: 'Projects', entries: [{ title: 'A', text: 'a', url: 'https://a.example/' }] },
        ],
      },
      testConfig(),
    );
    const task = getDocument({ data: new Uint8Array(pdf) });
    try {
      const page = await (await task.promise).getPage(1);
      const ops = await page.getOperatorList();
      const fills = new Set(
        ops.fnArray.flatMap((fn, i) =>
          fn === OPS.setFillRGBColor ? [String((ops.argsArray[i] as unknown[])[0])] : [],
        ),
      );
      const expected = Object.values(classicTemplate.colors).map((c) => c.toLowerCase());
      expect([...fills].sort()).toEqual([...new Set(expected)].sort());
    } finally {
      await task.destroy();
    }
  });
});
