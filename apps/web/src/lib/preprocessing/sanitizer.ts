/** @license BSD-3-Clause */
import { sanitizeBookHtml, type BookHtmlPolicy } from '../functions/book-security/book-content-security';

/** Reuse the same URL/CSS/static-SVG policy as every imported/restored book.
 * The host supplies its current placeholder or Blob URL allowlist. This helper
 * does not trust arbitrary saved blob: URLs, external images, CSS fetches or
 * runtime lookup attributes merely because the input came from a processor.
 * Sidecar data stays out-of-band and is bound only after DOM validation.
 * Requires the scoped BookHtmlPolicy edit in integration/web.json.
 */
export function sanitizeProcessedChapter(html: string, policy: BookHtmlPolicy): string {
  return sanitizeBookHtml(html, {
    ...policy,
    wholeDocument: false,
    svgOnly: false,
    allowReaderAnnotations: true
  });
}
