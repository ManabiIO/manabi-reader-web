/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { sanitizeBookStyleSheet } from '../functions/book-security/book-content-security';

/**
 * Map authored document roots to our non-text wrapper elements. Quoted values,
 * attribute selectors and non-selector pseudo arguments are never rewritten.
 * Escapes have already been rejected by the book CSS sanitizer.
 */
export function resourceSelector(selector: string): string {
  let result = '';
  let quote = '';
  let attributeDepth = 0;
  const argumentsAreSelectors: boolean[] = [];
  for (let index = 0; index < selector.length; ) {
    const char = selector[index];
    if (quote) {
      result += char;
      if (char === quote) quote = '';
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      result += char;
      index += 1;
      continue;
    }
    if (char === '[') attributeDepth += 1;
    if (char === ']') attributeDepth = Math.max(0, attributeDepth - 1);
    if (!attributeDepth && char === '(') {
      const pseudo = /:([\w-]+)$/.exec(result)?.[1]?.toLowerCase();
      argumentsAreSelectors.push(['is', 'where', 'not', 'has'].includes(pseudo ?? ''));
    }
    if (!attributeDepth && char === ')') argumentsAreSelectors.pop();
    const canMap = !attributeDepth && argumentsAreSelectors.every(Boolean);
    if (
      canMap &&
      selector.slice(index, index + 5).toLowerCase() === ':root' &&
      !/[\w-]/.test(selector[index + 5] ?? '')
    ) {
      result += '.ttu-book-html-wrapper';
      index += 5;
      continue;
    }
    const word = /^[a-zA-Z_][\w-]*/.exec(selector.slice(index))?.[0];
    if (word) {
      const previous = selector[index - 1] ?? '';
      const typePosition = !previous || /[\s>+~,(]/.test(previous);
      result +=
        canMap && typePosition && /^(html|body)$/i.test(word)
          ? word.toLowerCase() === 'html'
            ? '.ttu-book-html-wrapper'
            : '.ttu-book-body-wrapper'
          : word;
      index += word.length;
    } else {
      result += char;
      index += 1;
    }
  }
  return result;
}

/** The generated resource class is trusted; each chapter's CSS stays inside it. */
export function scopeEpubStyleSheet(css: string, index: number, document: Document): string {
  if (!Number.isSafeInteger(index) || index < 0) throw new Error('Invalid EPUB style scope.');
  const safe = sanitizeBookStyleSheet(css, document);
  const Constructor = (document.defaultView as Window & typeof globalThis)?.CSSStyleSheet;
  if (!Constructor?.prototype.replaceSync || !safe) return '';
  const sheet = new Constructor();
  sheet.replaceSync(safe);
  return Array.from(sheet.cssRules, (entry) => {
    const rule = entry as CSSStyleRule;
    if (rule.type !== 1) return '';
    // Retain the existing primary/secondary reader font preference contract.
    const family = rule.style.getPropertyValue('font-family');
    if (family.includes('sans-serif'))
      rule.style.setProperty(
        'font-family',
        'var(--font-family-sans-serif, Noto Sans JP, sans-serif)'
      );
    else if (family.includes('serif'))
      rule.style.setProperty('font-family', 'var(--font-family-serif, Noto Serif JP, serif)');
    return `.manabi-epub-resource-${index} :is(${resourceSelector(rule.selectorText)}){${rule.style.cssText}}`;
  }).join('\n');
}
