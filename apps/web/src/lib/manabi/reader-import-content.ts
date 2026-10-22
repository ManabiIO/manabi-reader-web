/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { rewriteEpubPublication } from '../foliate-epub/publication-data';
import {
  sanitizeBookHtml,
  sanitizeBookStyleSheet
} from '../functions/book-security/book-content-security';
import buildDummyBookImage from '../functions/file-loaders/utils/build-dummy-book-image';
import type { RestoredContent } from '../functions/file-loaders/utils/restored-book';

/** The exact import projection, shared with local/Drive content comparison.
 * Raw package identity remains separate: import receipts must not change when
 * the safety policy changes. No resource URLs are fetched or instantiated. */
export function prepareReaderImportContent(data: RestoredContent, document: Document) {
  const imageReferences = new Map<string, string>();
  for (const name of Object.keys(data.blobs)) {
    const placeholder = buildDummyBookImage(name);
    imageReferences.set(placeholder, placeholder);
    imageReferences.set(`ttu:${name}`, placeholder);
  }
  const policy = {
    document,
    preserveReaderLinks: true,
    resolveImage: (source: string) => imageReferences.get(source)
  };
  const sanitized = data.epubPublication
    ? rewriteEpubPublication(data.epubPublication, data.elementHtml, (resource) => ({
        ...resource,
        html: sanitizeBookHtml(resource.html, policy),
        styleSheet: sanitizeBookStyleSheet(resource.styleSheet, document)
      }))
    : { elementHtml: sanitizeBookHtml(data.elementHtml, policy) };
  return {
    ...data,
    ...sanitized,
    styleSheet: sanitizeBookStyleSheet(data.styleSheet, document),
    htmlBackup: data.htmlBackup ? sanitizeBookHtml(data.htmlBackup, policy) : undefined
  };
}
