import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readmeToDescription, rewriteHref, type ReadmeContext } from './readme.js';

const ctx: ReadmeContext = { owner: 'ani-p', repo: 'tracker', ref: 'main', path: 'README.md' };
const run = (html: string, c: ReadmeContext = ctx) => readmeToDescription(html, c);
const BLOB = 'https://github.com/ani-p/tracker/blob/main/';

describe('README to description (D3)', () => {
  it('drops every image and keeps its alt text, whatever the source', () => {
    const out = run(
      [
        '<p><img src="assets/banner.png" alt="Banner"></p>',
        '<p><img src="https://camo.githubusercontent.com/abc/def" alt="Build"></p>',
        '<p><img src="data:image/svg+xml;base64,PHN2Zz4=" alt="inline"></p>',
        '<picture><source srcset="dark.png"><img src="light.png" alt="themed"></picture>',
        '<svg><path d="M0"/></svg>',
      ].join(''),
    );
    expect(out).not.toMatch(/<img|<picture|<source|<svg|src=|srcset/i);
    expect(out).toContain('Banner');
    expect(out).toContain('Build');
    expect(out).toContain('inline');
    // An image inside <picture> is an image like any other: its alt text stays.
    expect(out).toContain('themed');
  });

  it('resolves relative and root-relative links to the repository on github.com', () => {
    const out = run(
      '<p><a href="LICENSE.md">l</a> <a href="./docs/guide.md">g</a> ' +
        '<a href="/CONTRIBUTING.md">c</a> <a href="packages/svelte">p</a></p>',
    );
    expect(out).toContain(`href="${BLOB}LICENSE.md"`);
    expect(out).toContain(`href="${BLOB}docs/guide.md"`);
    expect(out).toContain(`href="${BLOB}CONTRIBUTING.md"`);
    expect(out).toContain(`href="${BLOB}packages/svelte"`);
  });

  it('resolves against the README’s directory, and never leaves the repository', () => {
    const nested: ReadmeContext = { ...ctx, path: 'docs/README.md' };
    expect(rewriteHref('guide.md', nested)).toBe(`${BLOB}docs/guide.md`);
    expect(rewriteHref('../LICENSE', nested)).toBe(`${BLOB}LICENSE`);
    expect(rewriteHref('../../other/repo', nested)).toBeUndefined();
    expect(rewriteHref('../../../x', ctx)).toBeUndefined();
  });

  it('drops fragments, protocol-relative links and every scheme but http(s)', () => {
    for (const href of [
      '#install',
      '//evil.example/x',
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<script>1</script>',
      'mailto:a@b.c',
      'file:///etc/passwd',
      'vbscript:x',
    ]) {
      expect(rewriteHref(href, ctx), href).toBeUndefined();
    }
    const out = run('<p><a href="javascript:alert(1)">x</a></p>');
    expect(out).not.toMatch(/javascript/i);
    expect(out).not.toContain('href');
  });

  it('keeps an absolute http(s) link (the sanitizer adds rel)', () => {
    const out = run('<a href="https://example.com/a?b=1">x</a>');
    expect(out).toContain('href="https://example.com/a?b=1"');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
  });

  it('encodes a branch name with slashes and spaces as path segments', () => {
    const c: ReadmeContext = { ...ctx, ref: 'feature/x y' };
    expect(rewriteHref('a.md', c)).toBe('https://github.com/ani-p/tracker/blob/feature/x%20y/a.md');
  });

  it('is the M4 allow-list at the end: scripts, handlers and tables do not survive', () => {
    const out = run(
      '<div id="readme"><h1>T</h1><script>alert(1)</script><p onclick="x()">p</p>' +
        '<table><tr><td>c</td></tr></table><iframe src="https://x"></iframe></div>',
    );
    expect(out).not.toMatch(/<script|onclick|<table|<iframe|alert/i);
    expect(out).toContain('<h2>T</h2>');
    expect(out).toContain('c');
  });

  it('is idempotent', () => {
    const once = run('<p><a href="a.md">a</a><img alt="i" src="x.png"></p>');
    expect(readmeToDescription(once, ctx)).toBe(once);
  });

  it('handles a README as GitHub really rendered it (sveltejs/svelte, fetched 2026-10-15)', () => {
    const html = readFileSync(
      new URL('../../testing/fixtures/github-readme-svelte.html', import.meta.url),
      'utf8',
    );
    expect(html).toContain('data-path="README.md"');
    const out = readmeToDescription(html, {
      owner: 'sveltejs',
      repo: 'svelte',
      ref: 'main',
      path: 'README.md',
    });
    expect(out).not.toMatch(/<img|<picture|<source|srcset|src=|<themed|<script|<svg/i);
    expect(out).toContain('href="https://github.com/sveltejs/svelte/blob/main/CONTRIBUTING.md"');
    expect(out).toContain('href="https://github.com/sveltejs/svelte/blob/main/packages/svelte"');
    expect(out).toContain('href="https://svelte.dev"');
    // Everything left is the allow-list, and a second pass changes nothing.
    expect(
      readmeToDescription(out, {
        owner: 'sveltejs',
        repo: 'svelte',
        ref: 'main',
        path: 'README.md',
      }),
    ).toBe(out);
  });
});
