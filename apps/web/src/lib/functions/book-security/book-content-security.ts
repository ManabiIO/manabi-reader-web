/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import createDOMPurify from 'dompurify';
import { normalizeLegacyTextCombine } from './legacy-writing-mode-compat';

const MAX_HTML_CHARACTERS = 32 * 1024 * 1024;
const MAX_CSS_CHARACTERS = 4 * 1024 * 1024;
const MAX_CSS_RULES = 20000;
const HTML_TAGS = [
  'html',
  'head',
  'body',
  'main',
  'article',
  'section',
  'nav',
  'aside',
  'header',
  'footer',
  'div',
  'span',
  'p',
  'br',
  'hr',
  'wbr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'a',
  'ruby',
  'rb',
  'rt',
  'rp',
  'rtc',
  'em',
  'strong',
  'b',
  'i',
  'u',
  's',
  'small',
  'sub',
  'sup',
  'mark',
  'abbr',
  'bdi',
  'bdo',
  'q',
  'blockquote',
  'cite',
  'pre',
  'code',
  'kbd',
  'samp',
  'var',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'table',
  'caption',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'colgroup',
  'col',
  'figure',
  'figcaption',
  'img',
  'time'
];
// Static SVG only. In particular: no foreignObject, use, animation, filters,
// scripts, external paint servers, or embedded documents.
const SVG_TAGS = [
  'svg',
  'g',
  'image',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'title',
  'desc'
];
const ATTRIBUTES = [
  'id',
  'class',
  'style',
  'title',
  'lang',
  'xml:lang',
  'dir',
  'epub:type',
  'href',
  'xlink:href',
  'src',
  'alt',
  'width',
  'height',
  'colspan',
  'rowspan',
  'scope',
  'start',
  'value',
  'type',
  'datetime',
  'aria-label',
  'aria-hidden',
  'hidden',
  'data-ttu-spoiler-img',
  'data-manabi-target-spine-index',
  'data-manabi-target-fragment',
  'viewBox',
  'preserveAspectRatio',
  'xmlns',
  'x',
  'y',
  'x1',
  'x2',
  'y1',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'd',
  'points',
  'fill',
  'fill-rule',
  'stroke',
  'stroke-width',
  'text-anchor'
];
const CSS_PROPERTIES = new Set([
  'color',
  'background-color',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'font-variant',
  'font-variant-east-asian',
  'font-feature-settings',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'text-align',
  'text-align-last',
  'text-indent',
  'text-decoration',
  'text-decoration-line',
  'text-decoration-style',
  'text-decoration-color',
  'text-emphasis',
  'text-emphasis-style',
  'text-emphasis-color',
  'text-emphasis-position',
  'text-orientation',
  'text-combine-upright',
  'text-transform',
  'writing-mode',
  'line-break',
  'word-break',
  'overflow-wrap',
  'white-space',
  'vertical-align',
  'ruby-position',
  'ruby-align',
  'display',
  'visibility',
  'float',
  'clear',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'width',
  'height',
  'min-width',
  'max-width',
  'min-height',
  'max-height',
  'border',
  'border-width',
  'border-style',
  'border-color',
  'border-collapse',
  'border-spacing',
  'table-layout',
  'caption-side',
  'empty-cells',
  'list-style-type',
  'list-style-position',
  'break-before',
  'break-after',
  'break-inside',
  'page-break-before',
  'page-break-after',
  'page-break-inside',
  'orphans',
  'widows',
  'fill',
  'stroke',
  'stroke-width',
  'text-anchor'
]);
const READER_FONT_VALUES = new Set([
  'var(--font-family-sans-serif, Noto Sans JP, sans-serif)',
  'var(--font-family-serif, Noto Serif JP, serif)'
]);

function safeCssValue(value: string): boolean {
  if (value.length > 1024 || /[\\<>@{}]/.test(value)) return false;
  if (READER_FONT_VALUES.has(value)) return true;
  // No resource fetching, variable/attribute indirection, or executable legacy
  // expressions. Backslash escapes are rejected rather than decoded by hand.
  if (/(?:url|image|image-set|cross-fade|var|env|attr|expression|element)\s*\(/i.test(value))
    return false;
  // Avoid pathological layout values. This deliberately excludes negative
  // margins/offset tricks as well as arbitrarily large numeric dimensions.
  const numbers =
    value.match(/-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:px|em|rem|%|vh|vw|vmin|vmax)?/gi) ?? [];
  return numbers.every((token) => {
    const number = Number.parseFloat(token);
    return number >= 0 && Number.isFinite(number) && number <= 4096;
  });
}

function cleanDeclarations(style: CSSStyleDeclaration): string {
  const declarations: string[] = [];
  for (let index = 0; index < style.length; index++) {
    const original = style.item(index);
    const property = original.replace(/^-(?:epub|webkit)-/, '').toLowerCase();
    const value = style.getPropertyValue(original).trim();
    if (CSS_PROPERTIES.has(property) && safeCssValue(value))
      declarations.push(`${property}:${value}`);
  }
  return declarations.join(';');
}

export function sanitizeBookInlineStyle(css: string, document: Document): string {
  if (css.length > 16384) return '';
  const style = document.createElement('span').style;
  style.cssText = normalizeLegacyTextCombine(css);
  return cleanDeclarations(style);
}

/** Parse with the browser's CSS parser, then emit only ordinary safe rules. */
export function sanitizeBookStyleSheet(css: string, document: Document, scope?: string): string {
  if (typeof css !== 'string' || css.length > MAX_CSS_CHARACTERS)
    throw new Error('Book stylesheet exceeds the size limit');
  if (!css) return '';
  // The scope is application-owned, never taken from book content.
  if (scope !== undefined && !/^[.#][a-zA-Z_][\w-]*$/.test(scope))
    throw new Error('Invalid Reader stylesheet scope');
  const view = document.defaultView;
  const constructor = view && (view as Window & typeof globalThis).CSSStyleSheet;
  if (!constructor || typeof constructor.prototype.replaceSync !== 'function') {
    // Unsupported CSS is omitted, never passed through unsanitized.
    return '';
  }
  const sheet = new constructor();
  sheet.replaceSync(normalizeLegacyTextCombine(css));
  if (sheet.cssRules.length > MAX_CSS_RULES) throw new Error('Book stylesheet has too many rules');
  const result: string[] = [];
  for (const rule of Array.from(sheet.cssRules)) {
    if (rule.type !== 1) continue; // No imports, font faces, animations, nesting or at-rules.
    const { selectorText, style } = rule as CSSStyleRule;
    if (selectorText.length > 2048 || /[\\<>@{}]/.test(selectorText)) continue;
    const declarations = cleanDeclarations(style);
    if (!declarations) continue;
    // Wrapping the entire selector list prevents a comma from escaping scope.
    const selector = scope ? `${scope} :is(${selectorText})` : selectorText;
    result.push(`${selector}{${declarations}}`);
  }
  return result.join('\n');
}

export interface BookHtmlPolicy {
  document: Document;
  wholeDocument?: boolean;
  allowRelativeLinks?: boolean;
  /** Preserve validated chapter targets generated by the EPUB importer. */
  preserveReaderLinks?: boolean;
  svgOnly?: boolean;
  /** Only this trusted resolver may introduce an image URL. */
  resolveImage?: (source: string) => string | undefined;
  /** URLs made by this read/import lifetime; arbitrary saved blob URLs are not trusted. */
  imageUrls?: ReadonlySet<string>;
  onEmbeddedStyle?: (css: string) => void;
}

/**
 * The same boundary applies to fresh imports and every persisted/restored read.
 * Returns serialized safe markup; never a partially cleaned live DOM subtree.
 */
export function sanitizeBookHtml(html: string, policy: BookHtmlPolicy): string {
  if (typeof html !== 'string' || html.length > MAX_HTML_CHARACTERS)
    throw new Error('Book HTML exceeds the size limit');
  const view = policy.document.defaultView;
  if (!view) throw new Error('Book rendering requires a browser document');
  const purifier = createDOMPurify(view);
  if (!purifier.isSupported) throw new Error('This browser cannot safely render imported books');
  purifier.addHook('uponSanitizeElement', (node, data) => {
    if (data.tagName === 'style' && policy.onEmbeddedStyle) {
      policy.onEmbeddedStyle(sanitizeBookStyleSheet(node.textContent ?? '', policy.document));
    }
  });
  purifier.addHook('uponSanitizeAttribute', (node, data) => {
    const tag = node.nodeName.toLowerCase();
    const name = data.attrName.toLowerCase();
    if (name === 'style') {
      data.attrValue = sanitizeBookInlineStyle(data.attrValue, policy.document);
      data.keepAttr = data.attrValue.length > 0;
    } else if (name === 'src' || name === 'href' || name === 'xlink:href') {
      const value = data.attrValue.trim();
      if (tag === 'a' && name === 'href') {
        // Reader links are internal. Import-time relative chapter links are
        // retained for the existing TOC flattener, then restricted on reading.
        data.keepAttr =
          // eslint-disable-next-line no-control-regex
          !/[\x00-\x20\x7f]/.test(value) &&
          (value.startsWith('#') ||
            ((policy.wholeDocument === true || policy.allowRelativeLinks === true) &&
              !/^(?:[a-z][\w+.-]*:|[\\/])/i.test(value)));
        data.attrValue = value;
      } else if ((tag === 'img' && name === 'src') || (tag === 'image' && name !== 'src')) {
        let resolved: string | undefined;
        try {
          resolved = policy.imageUrls?.has(value) ? value : policy.resolveImage?.(value);
        } catch {
          /* Invalid or undeclared archive resource: remove the reference. */
        }
        data.keepAttr =
          typeof resolved === 'string' &&
          (resolved.startsWith('blob:') ||
            (resolved.startsWith('data:image/gif;ttu:') &&
              resolved.endsWith(';base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==')));
        if (resolved) data.attrValue = resolved;
      } else {
        data.keepAttr = false;
      }
    } else if (name === 'data-manabi-target-spine-index') {
      data.keepAttr =
        policy.preserveReaderLinks === true &&
        tag === 'a' &&
        /^\d{1,4}$/.test(data.attrValue) &&
        Number(data.attrValue) < 8192;
    } else if (name === 'data-manabi-target-fragment') {
      data.keepAttr =
        policy.preserveReaderLinks === true && tag === 'a' && data.attrValue.length <= 512;
    } else if (['fill', 'stroke'].includes(name)) {
      data.keepAttr = safeCssValue(data.attrValue);
    } else if (name === 'id') {
      data.keepAttr = data.attrValue.length <= 512;
    } else if (name === 'class') {
      data.keepAttr = data.attrValue.length <= 4096;
    } else if (name === 'xmlns') {
      data.keepAttr =
        data.attrValue === 'http://www.w3.org/2000/svg' ||
        data.attrValue === 'http://www.w3.org/1999/xhtml';
    }
  });
  return purifier.sanitize(html, {
    ALLOWED_TAGS: policy.svgOnly ? SVG_TAGS : [...HTML_TAGS, ...SVG_TAGS],
    ALLOWED_ATTR: ATTRIBUTES,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    FORBID_TAGS: [
      'script',
      'style',
      'iframe',
      'object',
      'embed',
      'form',
      'input',
      'button',
      'link',
      'meta',
      'base',
      'template',
      'foreignObject'
    ],
    SANITIZE_DOM: true,
    WHOLE_DOCUMENT: policy.wholeDocument === true,
    // The hook above independently validates all three URL-bearing attributes.
    // This allows only the application-approved local blob/placeholder URLs.
    ADD_URI_SAFE_ATTR: ['src', 'href', 'xlink:href'],
    RETURN_TRUSTED_TYPE: false
  });
}
