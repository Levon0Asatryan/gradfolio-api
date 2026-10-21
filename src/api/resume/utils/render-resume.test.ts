import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it, vi } from 'vitest';
import { testConfig } from '../../../testing/database.js';
import { renderResume } from './render-resume.js';
import { resumeRequestSchema } from '../dto/resume.dto.js';
import { resumeUrl } from './resume-data.js';

describe('resume PDF', () => {
  it('also rejects a single text operation that finishes beyond the render budget', async () => {
    const clock = vi
      .spyOn(performance, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(10_000);
    try {
      await expect(
        renderResume({ name: 'Ani', headline: '', blocks: [] }, testConfig()),
      ).rejects.toMatchObject({ code: 'RESUME_TOO_LARGE' });
    } finally {
      clock.mockRestore();
    }
  });
  it('prints a contact URL only once, as a link', async () => {
    const url = 'https://example.com/portfolio';
    const bytes = await renderResume(
      { name: 'Ani', headline: '', blocks: [{ title: 'Contact', entries: [{ text: url, url }] }] },
      testConfig(),
    );
    const task = getDocument({ data: new Uint8Array(bytes) });
    try {
      const document = await task.promise;
      const page = await document.getPage(1);
      const text = (await page.getTextContent()).items
        .map((v) => ('str' in v ? v.str : ''))
        .join(' ');
      expect(text.split(url)).toHaveLength(2);
      const annotations = (await page.getAnnotations()) as { url?: string }[];
      expect(annotations.some((a) => a.url === url)).toBe(true);
    } finally {
      await task.destroy();
    }
  });
  it('refuses rendering that exceeds its time budget', async () => {
    let elapsed = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => {
      elapsed += 10_000;
      return elapsed;
    });
    try {
      await expect(
        renderResume({ name: 'Ani', headline: '', blocks: [] }, testConfig()),
      ).rejects.toMatchObject({ code: 'RESUME_TOO_LARGE' });
    } finally {
      clock.mockRestore();
    }
  });
  it('embeds readable Latin, Cyrillic and Armenian text across pages', async () => {
    const pdf = await renderResume(
      {
        name: 'Անի Պետրոսյան',
        headline: 'Разработчик · Developer',
        blocks: [
          {
            title: 'Կրթություն',
            entries: Array.from({ length: 35 }, (_, i) => ({
              title: `Project ${i}`,
              text: 'Երևան, համալսարան. Программирование. TypeScript. '.repeat(3),
            })),
          },
        ],
      },
      testConfig(),
    );
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const task = getDocument({ data: new Uint8Array(pdf), useSystemFonts: false });
    const document = await task.promise;
    try {
      expect(document.numPages).toBeGreaterThan(1);
      let text = '';
      for (let i = 1; i <= document.numPages; i++) {
        const page = await document.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map((v) => ('str' in v ? v.str : '')).join(' ');
      }
      expect(text).toContain('Անի Պետրոսյան');
      expect(text).toContain('Разработчик');
      expect(text).toContain('Երևան');
      expect(text).toContain('Project 34');
    } finally {
      await task.destroy();
    }
  });

  it('refuses content over its character, byte and page bounds', async () => {
    const data = {
      name: 'Ani',
      headline: '',
      blocks: [{ title: 'Bio', entries: [{ text: 'long text '.repeat(3000) }] }],
    };
    await expect(
      renderResume(data, { ...testConfig(), RESUME_MAX_CHARS: 1000 }),
    ).rejects.toMatchObject({ code: 'RESUME_TOO_LARGE' });
    await expect(
      renderResume(data, { ...testConfig(), RESUME_MAX_PAGES: 1 }),
    ).rejects.toMatchObject({ code: 'RESUME_TOO_LARGE' });
    await expect(
      renderResume(
        { name: 'Անի', headline: '', blocks: [] },
        { ...testConfig(), RESUME_MAX_BYTES: 1000 },
      ),
    ).rejects.toMatchObject({ code: 'RESUME_TOO_LARGE' });
  });

  it('rejects forged fields, duplicate sections, unknown sections and unsafe links', () => {
    for (const input of [
      { sections: ['phone'] },
      { sections: ['bio', 'bio'] },
      { sections: [], userId: 'other' },
      { sections: [], projectIds: ['../p'] },
    ]) {
      expect(resumeRequestSchema.safeParse(input).success).toBe(false);
    }
    expect(resumeUrl('javascript:alert(1)')).toBeUndefined();
    expect(resumeUrl(null)).toBeUndefined();
    expect(resumeUrl('not a URL')).toBeUndefined();
    expect(resumeUrl('https://user:password@example.com')).toBeUndefined();
    expect(resumeUrl('https://user@example.com')).toBeUndefined();
    expect(resumeUrl('https://a.example/path')).toBe('https://a.example/path');
  });
});
