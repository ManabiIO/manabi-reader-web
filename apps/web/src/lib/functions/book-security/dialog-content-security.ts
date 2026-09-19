/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import createDOMPurify from 'dompurify';

/** String dialogs can contain filenames or external error messages. */
export function sanitizeDialogHtml(value: string, document: Document): string {
  if (value.length > 1024 * 1024) throw new Error('Dialog content exceeds the size limit');
  const view = document.defaultView;
  if (!view) return '';
  const purifier = createDOMPurify(view);
  if (!purifier.isSupported) return '';
  return purifier.sanitize(value, {
    ALLOWED_TAGS: [
      'p',
      'div',
      'span',
      'br',
      'hr',
      'em',
      'strong',
      'b',
      'i',
      'code',
      'pre',
      'kbd',
      'ul',
      'ol',
      'li',
      'a'
    ],
    ALLOWED_ATTR: ['href', 'title'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    ALLOWED_URI_REGEXP: /^(?:https?:\/\/[^\s]+|#[^\s]*)$/i,
    // No style, event handlers, images, embedded documents, form controls,
    // privileged schemes or new-window targets in messages.
    RETURN_TRUSTED_TYPE: false
  });
}
