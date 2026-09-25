/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Shared rules for live DOM locators and the worker's inert, stored-HTML index. */
export const projectionExcludedTags = new Set([
  'RT',
  'RP',
  'RTC',
  'SCRIPT',
  'STYLE',
  'TEMPLATE',
  'NOSCRIPT'
]);
export const projectionBlockTags = new Set([
  'P',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LI',
  'BLOCKQUOTE',
  'PRE',
  'DIV',
  'TR',
  'FIGCAPTION'
]);
export function projectionExcluded(tag: string, attributes: Record<string, string>) {
  return (
    projectionExcludedTags.has(tag) ||
    Object.hasOwn(attributes, 'hidden') ||
    attributes['aria-hidden'] === 'true' ||
    /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|content-visibility\s*:\s*hidden)\s*(?:!important\s*)?(?:;|$)/i.test(
      attributes.style ?? ''
    )
  );
}
