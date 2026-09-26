/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { sanitizeBookStyleSheet } from '../functions/book-security/book-content-security';
import { scopedEpubSelector } from './epub-root-selectors';
import { EpubStyleBudget } from './style-budget';
import type { EpubResourceData } from './publication-data';

function scopedStyles(
  css: string,
  ids: readonly string[],
  document: Document,
  parentSelector = ''
): string {
  if (parentSelector && !/^[.#][a-zA-Z_][\w-]*$/.test(parentSelector))
    throw new Error('Invalid Reader stylesheet scope.');
  if (ids.some((id) => !/^ttu-[a-zA-Z0-9_-]{1,128}$/.test(id)))
    throw new Error('Invalid EPUB stylesheet scope.');
  const Sheet = (document.defaultView as (Window & typeof globalThis) | null)?.CSSStyleSheet;
  if (!Sheet || !Sheet.prototype.replaceSync) return '';
  const sheet = new Sheet();
  sheet.replaceSync(sanitizeBookStyleSheet(css, document));
  const output = new EpubStyleBudget();
  // Share identical CSS across chapters, without an unbounded selector list.
  for (let index = 0; index < ids.length; index += 32) {
    const scopeIds = ids
      .slice(index, index + 32)
      .map((id) => `#${id}`)
      .join(',');
    const scope = `${parentSelector ? `${parentSelector} ` : ''}:is(${scopeIds})`;
    for (const rule of Array.from(sheet.cssRules)) {
      if (rule.type !== 1) continue;
      const style = rule as CSSStyleRule;
      // Retain the existing Reader typography contract, without discarding
      // chapter-local selectors or root metadata. Raw publisher CSS stays stored.
      style.style.removeProperty('line-height');
      style.style.removeProperty('text-indent');
      const family = style.style.getPropertyValue('font-family');
      if (family.includes('sans-serif'))
        style.style.setProperty(
          'font-family',
          'var(--font-family-sans-serif, Noto Sans JP, sans-serif)'
        );
      else if (family.includes('serif'))
        style.style.setProperty('font-family', 'var(--font-family-serif, Noto Serif JP, serif)');
      if (
        style.style.getPropertyValue('word-break') === 'break-all' &&
        !style.style.getPropertyValue('line-break')
      )
        style.style.setProperty('line-break', 'loose');
      output.append(`${scopedEpubSelector(style.selectorText, scope)}{${style.style.cssText}}`);
    }
    output.append(`${scope} br{display:inline!important}`);
    // The reader's selected layout axis remains authoritative, as in TTU.
    // Preserve interior mixed-writing islands; only synthetic roots inherit it.
    output.append(
      `${scope}>.ttu-book-html-wrapper,${scope}>.ttu-book-html-wrapper>.ttu-book-body-wrapper{writing-mode:inherit!important}`
    );
  }
  return output.toString();
}

export function epubResourceStyles(resource: EpubResourceData, document: Document): string {
  return scopedStyles(resource.styleSheet, [resource.sectionId], document);
}

export function epubCompatibilityStyles(
  resources: readonly EpubResourceData[],
  document: Document,
  parentSelector = ''
): string {
  const groups = new Map<string, string[]>();
  for (const resource of resources) {
    const ids = groups.get(resource.styleSheet) ?? [];
    ids.push(resource.sectionId);
    groups.set(resource.styleSheet, ids);
  }
  const output = new EpubStyleBudget();
  for (const [css, ids] of groups) output.append(scopedStyles(css, ids, document, parentSelector));
  return output.toString();
}
