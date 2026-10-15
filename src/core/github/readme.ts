import sanitizeHtml from 'sanitize-html';
import { sanitizeDescription, type SanitizedHtml } from '../validation/html.js';

/**
 * A GitHub-rendered README to a project description (docs/m7-plan.md §3.4, D3).
 *
 * Two passes. The first only rewrites what GitHub leaves relative; the second
 * is `sanitizeDescription`, the same allow-list every description goes
 * through, which is what makes the result safe. A README is never fetched from
 * a URL: it arrives from the GitHub API as HTML and is only transformed here.
 *
 * - Links: a relative or root-relative `href` is resolved against the
 *   repository on github.com (`…/blob/<ref>/…`). One that escapes the
 *   repository (`../../x`), a fragment, a protocol-relative link and any
 *   scheme but http(s) is dropped to bare text. Absolute http(s) stays.
 * - Images: all of them go, `<picture>`/`<source>`/`<svg>` with them. The alt
 *   text stays as text (D3 option 1): no hot-linking, no change to the
 *   allow-list, and a private repository's images would not load anyway.
 */

export interface ReadmeContext {
  /** GitHub login of the owner, and the repository's name: both pattern-checked upstream. */
  owner: string;
  repo: string;
  /** The default branch: what relative links resolve against. */
  ref: string;
  /** Where the README lives, e.g. `README.md` or `docs/README.md`. */
  path: string;
}

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

const encodePath = (path: string) =>
  path
    .split('/')
    .filter((s) => s !== '')
    .map(encodeURIComponent)
    .join('/');

/** `https://github.com/<owner>/<repo>/blob/<ref>/<dir of the README>/` and the repository root form. */
function bases(ctx: ReadmeContext): { page: URL; root: URL; prefix: string } {
  const repoBase = `https://github.com/${encodeURIComponent(ctx.owner)}/${encodeURIComponent(ctx.repo)}`;
  const blob = `${repoBase}/blob/${encodePath(ctx.ref)}/`;
  const dir = ctx.path.includes('/') ? ctx.path.slice(0, ctx.path.lastIndexOf('/')) : '';
  const root = new URL(blob);
  return {
    page: new URL(dir === '' ? blob : `${blob}${encodePath(dir)}/`),
    root,
    // The tree of this ref only: `../../other` stays on github.com but is not this README's tree.
    prefix: root.pathname,
  };
}

/** The href to keep, or undefined to drop the link. */
export function rewriteHref(raw: string | undefined, ctx: ReadmeContext): string | undefined {
  const href = raw?.trim();
  if (href === undefined || href === '' || href.startsWith('#')) return undefined;
  if (href.startsWith('//')) return undefined;
  if (HAS_SCHEME.test(href)) return /^https?:\/\//i.test(href) ? href : undefined;

  const { page, root, prefix } = bases(ctx);
  let resolved: URL;
  try {
    resolved = href.startsWith('/') ? new URL(href.slice(1), root) : new URL(href, page);
  } catch {
    return undefined;
  }
  // Still inside this ref's tree on github.com: `../../other` is not.
  return resolved.origin === 'https://github.com' && resolved.pathname.startsWith(prefix)
    ? resolved.toString()
    : undefined;
}

export function readmeToDescription(html: string, ctx: ReadmeContext): SanitizedHtml {
  const rewritten = sanitizeHtml(html, {
    allowedTags: false,
    allowedAttributes: false,
    // `<picture>` and `<svg>` carry no text worth keeping.
    nonTextTags: ['script', 'style', 'textarea', 'option', 'picture', 'svg', 'noscript'],
    transformTags: {
      img: (_tag, attribs): sanitizeHtml.Tag => ({
        tagName: 'span',
        attribs: {},
        text: (attribs.alt ?? '').slice(0, 300),
      }),
      a: (_tag, attribs): sanitizeHtml.Tag => {
        const href = rewriteHref(attribs.href, ctx);
        return { tagName: 'a', attribs: href === undefined ? {} : { href } };
      },
    },
  });
  return sanitizeDescription(rewritten);
}
