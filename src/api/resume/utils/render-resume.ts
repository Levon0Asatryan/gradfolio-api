import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import type { AppConfig } from '../../../core/config/schema.js';
import { AppError } from '../../../core/errors/app-error.js';
import { classicTemplate } from '../templates/classic.template.js';
import type { ResumeTemplate, TextStyle } from '../templates/resume-template.js';
import type { ResumeData } from './resume-data.js';

type Limits = Pick<
  AppConfig,
  'RESUME_MAX_CHARS' | 'RESUME_MAX_PAGES' | 'RESUME_MAX_BYTES' | 'RESUME_RENDER_TIMEOUT_MS'
>;
const font = fileURLToPath(new URL('./fonts/DejaVuSans.ttf', import.meta.url));

/**
 * Draws `data` with `template` and enforces the size, page, byte and time limits.
 * One font covers all three UI scripts; no remote assets or HTML are processed.
 */
export async function renderResume(
  data: ResumeData,
  limits: Limits,
  template: ResumeTemplate = classicTemplate,
): Promise<Buffer> {
  if ([...JSON.stringify(data)].length > limits.RESUME_MAX_CHARS) throw tooLarge();
  const started = performance.now();
  const doc = new PDFDocument({
    size: template.page.size,
    margin: template.page.margin,
    font,
    bufferPages: true,
    info: { Title: `${data.name} - Resume`, Author: data.name, Creator: 'Gradfolio' },
  });
  let pages = 1;
  doc.on('pageAdded', () => {
    if (++pages > limits.RESUME_MAX_PAGES) throw tooLarge();
  });
  const result = new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    doc.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > limits.RESUME_MAX_BYTES) {
        reject(tooLarge());
        doc.destroy();
      } else chunks.push(chunk);
    });
    doc.once('error', reject);
    doc.once('end', () => resolve(Buffer.concat(chunks)));
  });
  try {
    const checkTime = () => {
      if (performance.now() - started > limits.RESUME_RENDER_TIMEOUT_MS) throw tooLarge();
    };
    const { spacing, keepWithNext } = template;
    const text = (value: string, style: TextStyle, url?: string) => {
      checkTime();
      doc
        .fontSize(style.size)
        .fillColor(template.colors[style.color])
        .text(value, { lineGap: spacing.lineGap, paragraphGap: spacing.paragraphGap, link: url });
      checkTime();
    };
    const keep = (points: number) => {
      if (doc.y > doc.page.height - doc.page.margins.bottom - points) doc.addPage();
    };
    text(data.name, template.name);
    if (data.headline) text(data.headline, template.headline);
    doc.moveDown(spacing.afterHeader);
    for (const block of data.blocks) {
      keep(keepWithNext.section);
      text(block.title, template.sectionTitle);
      doc.moveDown(spacing.afterSectionTitle);
      for (const entry of block.entries) {
        keep(keepWithNext.entry);
        if (entry.title) text(entry.title, template.entryTitle);
        // A URL that is the whole entry prints once, as a link; otherwise on its own line.
        if (entry.text)
          text(entry.text, template.body, entry.text === entry.url ? entry.url : undefined);
        if (entry.url && entry.url !== entry.text) text(entry.url, template.link, entry.url);
        doc.moveDown(spacing.afterEntry);
      }
      doc.moveDown(spacing.afterSection);
    }
    checkTime();
    doc.end();
  } catch (error) {
    doc.destroy(error instanceof Error ? error : new Error('render failed'));
  }
  return result;
}

function tooLarge() {
  return new AppError('RESUME_TOO_LARGE', 'select fewer sections or shorten their text', 422);
}
