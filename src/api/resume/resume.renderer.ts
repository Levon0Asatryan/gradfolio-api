import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import type { AppConfig } from '../../core/config/schema.js';
import { AppError } from '../../core/errors/app-error.js';
import type { ResumeData } from './resume.dto.js';

type Limits = Pick<
  AppConfig,
  'RESUME_MAX_CHARS' | 'RESUME_MAX_PAGES' | 'RESUME_MAX_BYTES' | 'RESUME_RENDER_TIMEOUT_MS'
>;
const font = fileURLToPath(new URL('./fonts/DejaVuSans.ttf', import.meta.url));

/** One font covers all three UI scripts; no remote assets or HTML are processed. */
export async function renderResume(data: ResumeData, limits: Limits): Promise<Buffer> {
  if ([...JSON.stringify(data)].length > limits.RESUME_MAX_CHARS) throw tooLarge();
  const started = performance.now();
  const doc = new PDFDocument({
    size: 'A4',
    margin: 48,
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
    const text = (value: string, size = 10, color = '#253348', url?: string) => {
      checkTime();
      doc.fontSize(size).fillColor(color).text(value, { lineGap: 3, paragraphGap: 4, link: url });
      checkTime();
    };
    text(data.name, 23, '#14334a');
    if (data.headline) text(data.headline, 12, '#536475');
    doc.moveDown(0.6);
    for (const block of data.blocks) {
      if (doc.y > doc.page.height - doc.page.margins.bottom - 70) doc.addPage();
      text(block.title, 13, '#126677');
      doc.moveDown(0.25);
      for (const entry of block.entries) {
        if (doc.y > doc.page.height - doc.page.margins.bottom - 55) doc.addPage();
        if (entry.title) text(entry.title, 11, '#14334a');
        if (entry.text)
          text(entry.text, 10, '#253348', entry.text === entry.url ? entry.url : undefined);
        if (entry.url && entry.url !== entry.text) text(entry.url, 9, '#126677', entry.url);
        doc.moveDown(0.35);
      }
      doc.moveDown(0.5);
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
