/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Map document roots without changing type-selector specificity. */
export function epubRootSelector(selector: string): string {
  let result = '';
  let brackets = 0;
  let quote = '';
  let index = 0;
  while (index < selector.length) {
    const character = selector[index];
    if (quote) {
      result += character;
      if (character === quote && selector[index - 1] !== '\\') quote = '';
      index++;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    if (character === '[') brackets++;
    if (character === ']') brackets--;
    if (!brackets && !quote) {
      // :root may follow a type, universal selector or another simple selector.
      const root = /^:root(?![\w-])/i.exec(selector.slice(index));
      if (root) {
        result += '.ttu-book-html-wrapper';
        index += root[0].length;
        continue;
      }
      const previous = selector[index - 1] ?? '';
      const typePosition = !previous || /[\s>+~,(]/.test(previous);
      const tag = typePosition && /^(html|body)(?![\w|-])/i.exec(selector.slice(index));
      if (tag) {
        // div contributes the original element specificity; :where contributes zero.
        const kind = tag[1].toLowerCase();
        result += `div:where(.ttu-book-${kind}-wrapper)`;
        index += tag[0].length;
        continue;
      }
    }
    result += character;
    index++;
  }
  return result;
}

/** Prefix each top-level selector, without raising list members' specificity. */
export function scopedEpubSelector(selector: string, scope: string): string {
  const selectors: string[] = [];
  let parentheses = 0;
  let brackets = 0;
  let quote = '';
  let start = 0;
  for (let index = 0; index < selector.length; index++) {
    const character = selector[index];
    if (quote) {
      if (character === quote && selector[index - 1] !== '\\') quote = '';
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '[') brackets++;
    else if (character === ']') brackets--;
    else if (!brackets && character === '(') parentheses++;
    else if (!brackets && character === ')') parentheses--;
    else if (!brackets && !parentheses && character === ',') {
      selectors.push(selector.slice(start, index).trim());
      start = index + 1;
    }
  }
  selectors.push(selector.slice(start).trim());
  return selectors.map((value) => `${scope} ${epubRootSelector(value)}`).join(',');
}
