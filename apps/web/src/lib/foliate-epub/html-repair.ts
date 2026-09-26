/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { epubNumericReference } from './numeric-reference';

/** Preserve the existing explicit import-repair preferences before sanitization. */
export function repairEpubHtml(source: string, mode: string, anchorsOnly: boolean): string {
  if (mode === 'Off') return source;
  const tags = anchorsOnly
    ? ['a']
    : [
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
  let result = source;
  for (const tag of tags) {
    result = result.replace(new RegExp(`<${tag}[^>]+?>`, 'gim'), (match) =>
      match.endsWith('/>') ? `${match.slice(0, -2)}></${tag}>` : match
    );
  }
  if (mode === 'Extended') {
    result = result
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .replace(/><\/(meta|link)>/gi, '>')
      .replace(/&#x([0-9a-f]+);/gi, (_, value) => epubNumericReference(value, 16))
      .replace(/&#(\d+);/g, (_, value) => epubNumericReference(value, 10))
      .replace('<!DOCTYPE html []>', '<!DOCTYPE html>')
      .trim();
  }
  return result;
}
