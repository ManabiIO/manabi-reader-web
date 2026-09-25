/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  sanitizeBookHtml,
  type BookHtmlPolicy
} from '../functions/book-security/book-content-security';

export function sanitizeProcessedChapter(html: string, policy: BookHtmlPolicy): string {
  return sanitizeBookHtml(html, {
    ...policy,
    wholeDocument: false,
    svgOnly: false,
    allowReaderAnnotations: true
  });
}
