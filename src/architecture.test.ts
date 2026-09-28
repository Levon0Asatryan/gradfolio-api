import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The dependency rule, checked rather than documented:
 *
 *   core     depends on nothing else in src/ (shared, framework-light)
 *   api      may depend on core
 *   testing  may depend on anything; nothing shipped depends on testing
 *
 * An unenforced convention decays. Keeping core free of api is what lets a
 * second process (a worker for imports or PDFs, say) be added without an
 * untangling exercise first.
 */
const SRC = dirname(fileURLToPath(import.meta.url));

// Every relative specifier: `from '…'`, bare `import '…'`, dynamic `import('…')`
// and `require('…')`.
const SPECIFIER = /(?:from\s+|import\s*\(?\s*|require\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g;

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.ts'))
    .map((e) => join(e.parentPath, e.name));
}

function layerOf(file: string): string {
  return relative(SRC, file).split('/')[0] ?? '';
}

const isTest = (file: string) => file.endsWith('.test.ts');

export function violations(
  imports: { file: string; target: string }[],
): { file: string; target: string }[] {
  return imports.filter(({ file, target }) => {
    const from = layerOf(file);
    const to = layerOf(target);
    if (from === to) return false;
    if (from === 'testing') return false;
    if (to === 'testing') return !isTest(file);
    if (from === 'core') return true;
    return false;
  });
}

describe('architecture', () => {
  it('no shipped layer breaks the dependency rule', async () => {
    const files = await sourceFiles(SRC);
    const imports: { file: string; target: string }[] = [];

    for (const file of files) {
      const text = await readFile(file, 'utf8');
      for (const match of text.matchAll(SPECIFIER)) {
        const spec = match[1];
        if (spec) imports.push({ file, target: resolve(dirname(file), spec) });
      }
    }

    expect(imports.length).toBeGreaterThan(0);
    expect(
      violations(imports).map((v) => `${relative(SRC, v.file)} -> ${relative(SRC, v.target)}`),
    ).toEqual([]);
  });

  it('flags core importing api, and shipped code importing testing', () => {
    const at = (p: string) => join(SRC, p);
    expect(
      violations([
        { file: at('core/db/pool.ts'), target: at('api/bootstrap.js') },
        { file: at('api/main.ts'), target: at('testing/app.js') },
        { file: at('api/main.ts'), target: at('core/config/index.js') },
        { file: at('api/x.test.ts'), target: at('testing/app.js') },
      ]),
    ).toHaveLength(2);
  });
});
