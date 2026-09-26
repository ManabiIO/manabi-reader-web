/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export interface EpubImportFixes {
  mode: 'off' | 'basic' | 'extended';
  anchorsOnly: boolean;
}
const selfClosing = [
  'a',
  'body',
  'code',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'ol',
  'ops:default',
  'p',
  'rb',
  'rt',
  'ruby',
  'script',
  'span',
  'td',
  'th',
  'title'
];

export function decodeEpubNumericEntity(value: string, radix: 10 | 16): string {
  const point = Number.parseInt(value, radix);
  if (
    !Number.isSafeInteger(point) ||
    point <= 0 ||
    point > 0x10ffff ||
    (point >= 0xd800 && point <= 0xdfff)
  )
    return '\uFFFD';
  return String.fromCodePoint(point);
}

/** Preserve TTU's explicit malformed-HTML repair settings, without corrupting rare kanji. */
export function repairEpubHtml(source: string, fixes: EpubImportFixes): string {
  let value = source;
  if (fixes.mode !== 'off') {
    for (const tag of fixes.anchorsOnly ? ['a'] : selfClosing)
      value = value.replace(new RegExp(`<${tag}[^>]+?>`, 'gim'), (match) =>
        match.endsWith('/>') ? `${match.slice(0, -2)}></${tag}>` : match
      );
  }
  if (fixes.mode === 'extended')
    value = value
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .replace(/><\/(meta|link)>/gim, '>')
      .replace(/&#x([0-9A-Fa-f]+);/gim, (_, hex) => decodeEpubNumericEntity(hex, 16))
      .replace(/&#(\d+);/gim, (_, decimal) => decodeEpubNumericEntity(decimal, 10))
      .replace('<!DOCTYPE html []>', '<!DOCTYPE html>')
      .trim();
  return value;
}
