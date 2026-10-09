import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { sanitizeDescription } from './html.js';
import { CORPUS, KEEP } from './html.corpus.js';

const TAGS = new Set([
  'h2',
  'h3',
  'h4',
  'p',
  'br',
  'strong',
  'em',
  'u',
  's',
  'code',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'a',
  'hr',
]);
const XHTML = 'http://www.w3.org/1999/xhtml';

/** Parses with a second parser (parse5) and lists everything the allow-list forbids. */
function violations(out: string): string[] {
  const body = new JSDOM(`<!doctype html><body>${out}`).window.document.body;
  const bad: string[] = [];
  for (const el of body.querySelectorAll('*')) {
    if (!TAGS.has(el.localName) || el.namespaceURI !== XHTML) bad.push(`tag ${el.localName}`);
    for (const at of el.attributes) {
      const ok =
        (el.localName === 'a' && at.name === 'href' && /^https?:\/\//i.test(at.value)) ||
        (el.localName === 'a' &&
          at.name === 'rel' &&
          at.value === 'noopener noreferrer nofollow') ||
        (el.localName === 'a' && at.name === 'target' && at.value === '_blank') ||
        (el.localName === 'code' &&
          at.name === 'class' &&
          /^language-[a-z0-9+#-]{1,20}$/.test(at.value));
      if (!ok) bad.push(`${el.localName}[${at.name}=${at.value}]`);
    }
  }
  // Mutation XSS: output must be a fixpoint of serialise-then-parse.
  const again = new JSDOM(`<!doctype html><body>${body.innerHTML}`).window.document.body.innerHTML;
  if (again !== body.innerHTML) bad.push('not stable under re-parse');
  return bad;
}

/** Puts the output in a scripting document; true if any script, handler or load ran. */
async function executes(out: string): Promise<boolean> {
  let ran = false;
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'dangerously' });
  Object.assign(dom.window, { alert: () => (ran = true) });
  dom.window.document.body.innerHTML = out;
  await new Promise((r) => setTimeout(r, 20));
  dom.window.close();
  return ran;
}

describe('sanitizeDescription: the XSS corpus', () => {
  it.each(CORPUS)('neutralizes %s (%s)', async (_name, _kind, html) => {
    const out = sanitizeDescription(html);
    expect(violations(out), out).toEqual([]);
    expect(await executes(out), out).toBe(false);
    expect(out).not.toMatch(/javascript:|onerror|onload|<script|<svg|<img/i);
  });

  it.each(CORPUS)('is idempotent on %s (%s)', (_name, _kind, html) => {
    const once = sanitizeDescription(html);
    expect(sanitizeDescription(once)).toBe(once);
  });

  it('has the vectors the plan promises (a floor, so the corpus cannot be thinned silently)', () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(70);
    const kinds = new Set(CORPUS.map((c) => c[1]));
    for (const k of ['script', 'handler', 'svg', 'mathml', 'url', 'embed', 'style', 'mxss'])
      expect(kinds, k).toContain(k);
  });
});

describe('sanitizeDescription: what the editor emits survives', () => {
  it.each(KEEP)('keeps %s', (html) => {
    const out = new JSDOM(sanitizeDescription(html)).window.document.body.innerHTML;
    const normalized = (h: string) =>
      new JSDOM(h).window.document.body.innerHTML.replaceAll(
        / rel="noopener noreferrer nofollow" target="_blank"/g,
        '',
      );
    expect(normalized(out)).toBe(normalized(html));
  });
});

describe('sanitizeDescription: rules', () => {
  it('rewrites every link and drops everything but http(s)', () => {
    expect(
      sanitizeDescription('<a href="https://a.example/x" onclick="x()" target="_self">t</a>'),
    ).toBe(
      '<a href="https://a.example/x" rel="noopener noreferrer nofollow" target="_blank">t</a>',
    );
    // a link that fails the check keeps its text and loses everything that made it a link
    expect(sanitizeDescription('<a href="mailto:a@b.co">mail</a>')).toBe('<a>mail</a>');
    expect(sanitizeDescription('<a>no href</a>')).toBe('<a>no href</a>');
  });

  it('keeps every tag balanced when good and bad links are mixed', () => {
    const good = (t: string) =>
      `<a href="https://a.example" rel="noopener noreferrer nofollow" target="_blank">${t}</a>`;
    const html = (...hrefs: string[]) => hrefs.map((h, i) => `<a href="${h}">l${i}</a>`).join(' ');
    expect(sanitizeDescription(html('javascript:x', 'https://a.example'))).toBe(
      `<a>l0</a> ${good('l1')}`,
    );
    expect(sanitizeDescription(html('https://a.example', 'javascript:x'))).toBe(
      `${good('l0')} <a>l1</a>`,
    );
    expect(
      sanitizeDescription(html('mailto:a@b', 'https://a.example', '/x', 'https://a.example')),
    ).toBe(`<a>l0</a> ${good('l1')} <a>l2</a> ${good('l3')}`);
    expect(
      sanitizeDescription(
        '<p><a href="//evil.example">m</a> and <a href="https://a.example">l</a></p>',
      ),
    ).toBe(`<p><a>m</a> and ${good('l')}</p>`);
  });

  it('maps legacy tags and keeps only language classes on code', () => {
    expect(sanitizeDescription('<h1>a</h1><h5>b</h5><b>c</b><i>d</i>')).toBe(
      '<h2>a</h2><h4>b</h4><strong>c</strong><em>d</em>',
    );
    // class names are filtered one by one: only the language one stays
    expect(sanitizeDescription('<code class="language-ts evil">x</code>')).toBe(
      '<code class="language-ts">x</code>',
    );
    expect(sanitizeDescription('<code class="evil">x</code>')).toBe('<code>x</code>');
    expect(sanitizeDescription('<p class="language-ts">x</p>')).toBe('<p>x</p>');
    expect(sanitizeDescription('<code class="language-ts">x</code>')).toBe(
      '<code class="language-ts">x</code>',
    );
  });

  it('drops images, tables and styles, keeping the text of unknown wrappers', () => {
    expect(
      sanitizeDescription('<img src="https://a.example/i.png"><p style="color:red">t</p>'),
    ).toBe('<p>t</p>');
    expect(sanitizeDescription('<table><tr><td>cell</td></tr></table>')).toBe('cell');
    expect(sanitizeDescription('<div><span>inner</span></div>')).toBe('inner');
  });

  it('keeps text, entities and non-Latin scripts intact', () => {
    const text = '<p>Ադամ — Привет — 日本語 😀 &amp; &lt;tag&gt;</p>';
    expect(sanitizeDescription(text)).toBe(text);
  });
});
