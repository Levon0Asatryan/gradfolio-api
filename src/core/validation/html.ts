import sanitizeHtml from 'sanitize-html';

/**
 * Sanitized project-description HTML (docs/m4-plan.md §4). The only way to get
 * a value of this type is `sanitizeDescription`, and the project repository
 * accepts nothing else, so no write path can skip the sanitizer.
 */
declare const sanitized: unique symbol;
export type SanitizedHtml = string & { readonly [sanitized]: true };

/**
 * One regex for every link: `http(s)://` and then no whitespace, control or
 * zero-width characters. `mailto:`, relative, protocol-relative, `data:` and
 * `javascript:` all fail it, however they are encoded: entities are decoded by
 * the parser before this sees the value.
 */
const HREF = new RegExp(
  String.raw`^https?:\/\/[^\s\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]+$`,
  'i',
);

const LINK_REL = 'noopener noreferrer nofollow';
const CODE_CLASS = /^language-[a-z0-9+#-]{1,20}$/;

const ALLOWED_TAGS = [
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
];

/**
 * Elements whose *content* goes too, not just the tag: raw-text and embedded
 * content is where the mutation-XSS advisories against this library sit
 * (textarea, xmp, svg, style, noscript).
 */
const DROP_WITH_CONTENT = [
  'script',
  'style',
  'textarea',
  'xmp',
  'noscript',
  'template',
  'svg',
  'math',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'select',
  'option',
  'title',
  'head',
  'frameset',
  'plaintext',
  'listing',
];

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: { a: ['href', 'rel', 'target'], code: ['class'] },
  allowedClasses: { code: [CODE_CLASS] },
  allowedSchemes: ['http', 'https'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  nonTextTags: DROP_WITH_CONTENT,
  transformTags: {
    b: 'strong',
    i: 'em',
    h1: 'h2',
    h5: 'h4',
    h6: 'h4',
    // A link keeps only a checked href, plus our rel and target. One whose href
    // fails stays as a bare `<a>` (no attributes, so not a link): renaming it to
    // drop the tag made sanitize-html close the *next* link with the wrong tag
    // (`<a …>y</span>`, found by a real run; see the mixed-links test).
    a: (_tag, attribs): sanitizeHtml.Tag => {
      const href = attribs.href?.trim();
      return href !== undefined && HREF.test(href)
        ? { tagName: 'a', attribs: { href, rel: LINK_REL, target: '_blank' } }
        : { tagName: 'a', attribs: {} };
    },
  },
};

/** Sanitizes on write. Idempotent: sanitizing the result changes nothing. */
export function sanitizeDescription(html: string): SanitizedHtml {
  return sanitizeHtml(html, OPTIONS) as SanitizedHtml;
}
