/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import createDOMPurify from 'dompurify';

// Book content is untrusted even when it came from the user's own cloud folder.
// Imported HTML shares an origin with Manabi's session API; it must never become
// an executable document or a source of authenticated subresource requests.
const safeProperties = new Set([
  'color',
  'background-color',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'font-variant',
  'font-variant-east-asian',
  'font-kerning',
  'font-feature-settings',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'text-align',
  'text-indent',
  'text-decoration',
  'text-decoration-line',
  'text-decoration-style',
  'text-decoration-color',
  'text-transform',
  'text-emphasis',
  'text-emphasis-style',
  'text-emphasis-position',
  'text-orientation',
  'text-combine-upright',
  'writing-mode',
  'vertical-align',
  'white-space',
  'word-break',
  'overflow-wrap',
  'line-break',
  'hyphens',
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
  'border',
  'border-width',
  'border-style',
  'border-color',
  'border-radius',
  'border-top',
  'border-bottom',
  'border-left',
  'border-right',
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'display',
  'float',
  'clear',
  'box-sizing',
  'list-style-type',
  'list-style-position',
  'break-before',
  'break-after',
  'break-inside',
  'page-break-before',
  'page-break-after',
  'page-break-inside',
  'ruby-align',
  'ruby-position',
  'opacity'
]);
const forbiddenTags = [
  'script',
  'style',
  'link',
  'meta',
  'base',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'audio',
  'video',
  'source',
  'track',
  'portal',
  'foreignobject',
  'animate',
  'animatemotion',
  'animatetransform',
  'set',
  'discard'
];

function cleanDeclaration(style: CSSStyleDeclaration) {
  const output: string[] = [];
  for (const property of Array.from(style)) {
    const name = property.toLowerCase();
    const normalized = name.replace(/^-(?:webkit|epub)-/, '');
    const value = style.getPropertyValue(property);
    if (
      !safeProperties.has(normalized) ||
      /[\\<>@]|url\s*\(|image-set\s*\(|expression\s*\(|var\s*\(/i.test(value)
    )
      continue;
    output.push(`${name}:${value}${style.getPropertyPriority(property) ? '!important' : ''}`);
  }
  return output.join(';');
}
function inlineStyle(value: string) {
  const style = document.createElement('span').style;
  style.cssText = value;
  return cleanDeclaration(style);
}
export function sanitizeBookCss(value: string | undefined): string {
  if (!value || value.length > 4 * 1024 * 1024) return '';
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(value);
    return Array.from(sheet.cssRules)
      .flatMap((rule) => {
        if (!(rule instanceof CSSStyleRule) || /[<>@\\]/.test(rule.selectorText)) return [];
        const declarations = cleanDeclaration(rule.style);
        return declarations ? [`${rule.selectorText}{${declarations}}`] : [];
      })
      .join('\n');
  } catch {
    // Unsupported or malformed book styling is not permission to inject it.
    return '';
  }
}

function allowedImage(value: string) {
  if (
    value.startsWith('data:image/gif;ttu:') &&
    value.endsWith(';base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==')
  )
    return true;
  if (value.startsWith('ttu:') && value.length <= 4096) return true;
  if (
    /^data:image\/(?:png|jpeg|gif|webp|avif);(?:[A-Za-z0-9_.:/;-]+;)?base64,[A-Za-z0-9+/=\s]+$/i.test(
      value
    )
  )
    return true;
  if (value.startsWith('blob:')) {
    try {
      return new URL(value).origin === location.origin;
    } catch {
      return false;
    }
  }
  return false;
}
function hasControlsOrSpace(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 32 || code === 127) return true;
  }
  return false;
}
function archiveReference(value: string) {
  // Archive-relative paths survive only the inert import pass. The second pass
  // permits images only after they have been resolved to actual archive blobs.
  return value.length <= 4096 && !hasControlsOrSpace(value) && !/^[\s/\\]|[:\\]/.test(value);
}

export function sanitizeBookHtml(html: string, importing = false, wholeDocument = false): string {
  const purifier = createDOMPurify(window);
  purifier.addHook('uponSanitizeAttribute', (node, data) => {
    const attribute = data.attrName.toLowerCase();
    const tag = node.nodeName.toLowerCase();
    if (attribute === 'style') {
      data.attrValue = inlineStyle(data.attrValue);
      data.keepAttr = Boolean(data.attrValue);
    }
    if (['src', 'href', 'xlink:href'].includes(attribute)) {
      const value = data.attrValue;
      const fragment =
        ['a', 'use'].includes(tag) && value.startsWith('#') && !hasControlsOrSpace(value);
      const image = ['img', 'image'].includes(tag) && allowedImage(value);
      data.keepAttr = fragment || image || (importing && archiveReference(value));
    }
  });
  return purifier.sanitize(html, {
    WHOLE_DOCUMENT: wholeDocument,
    FORBID_TAGS: forbiddenTags,
    FORBID_ATTR: [
      'background',
      'poster',
      'srcdoc',
      'srcset',
      'ping',
      'target',
      'download',
      'formaction',
      'action',
      'is',
      'autofocus'
    ],
    // These attributes are validated by the stricter hook above. In particular,
    // same-origin blob image URLs are legitimate after book-image substitution.
    ALLOWED_URI_REGEXP:
      /^(?:#[\s\S]*|blob:https?:\/\/[\s\S]*|data:image\/(?:png|jpeg|gif|bmp|webp|avif);[\s\S]*|ttu:[\s\S]*|[^:]+)$/i,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    SANITIZE_DOM: true,
    RETURN_TRUSTED_TYPE: false
  }) as string;
}

export function sanitizeArchiveMarkup<T extends Record<string, string | Blob>>(data: T): T {
  for (const [name, value] of Object.entries(data)) {
    if (typeof value !== 'string') continue;
    if (/\.(?:xhtml|html|htm)$/i.test(name) || /<body(?:\s|>)/i.test(value)) {
      data[name as keyof T] = sanitizeBookHtml(value, true, true) as T[keyof T];
    } else if (/\.css$/i.test(name)) data[name as keyof T] = sanitizeBookCss(value) as T[keyof T];
  }
  return data;
}
