/** @license BSD-3-Clause */
import { sanitizeBookHtml, type BookHtmlPolicy } from '../functions/book-security/book-content-security';

export function sanitizeProcessedChapter(html: string, policy: BookHtmlPolicy): string {
  return sanitizeBookHtml(html, {
    ...policy,
    wholeDocument: false,
    svgOnly: false,
    allowReaderAnnotations: true
  });
}
