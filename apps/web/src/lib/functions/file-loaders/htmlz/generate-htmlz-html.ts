/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import buildDummyBookImage from '../utils/build-dummy-book-image';
import clearAllBadImageRef from '../utils/clear-all-bad-image-ref';
import fixXHtmlHref from '../utils/fix-xhtml-href';
import type { HtmlzContent } from './types';

import { sanitizeBookHtml } from '../../book-security/book-content-security';
import { resolveArchivePath } from '../utils/limited-archive';

export function getFormattedElementHtmlz(
  data: HtmlzContent,
  document: Document,
  embeddedStyles: string[] = []
) {
  const images = new Map(
    Object.entries(data)
      .filter(([, value]) => value instanceof Blob)
      .map(([key]) => [key, buildDummyBookImage(key)])
  );
  const safe = sanitizeBookHtml(data['index.html'], {
    document,
    wholeDocument: true,
    resolveImage: (source) => images.get(resolveArchivePath('index.html', source)),
    onEmbeddedStyle: (css) => embeddedStyles.push(css)
  });
  const parsed = new DOMParser().parseFromString(safe, 'text/html');
  const result = document.createElement('div');
  result.innerHTML = sanitizeBookHtml(parsed.body.innerHTML, {
    document,
    imageUrls: new Set(images.values()),
    allowRelativeLinks: true
  });
  clearAllBadImageRef(result);
  fixXHtmlHref(result);
  for (const anchor of Array.from(result.querySelectorAll('a[href]'))) {
    const href = anchor.getAttribute('href') || '';
    if (href.includes('#')) anchor.setAttribute('href', '#' + href.split('#').pop());
    else anchor.removeAttribute('href');
  }
  return result;
}
