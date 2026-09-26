/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Read only legal leading imports; never interpret @import text inside a rule/string. */
export function localCssImports(css: string): string[] {
  const imports: string[] = [];
  let offset = 0;
  const skip = () => {
    while (offset < css.length) {
      if (/\s/.test(css[offset])) {
        offset += 1;
        continue;
      }
      if (css.slice(offset, offset + 2) === '/*') {
        const end = css.indexOf('*/', offset + 2);
        offset = end < 0 ? css.length : end + 2;
        continue;
      }
      break;
    }
  };
  while (offset < css.length) {
    skip();
    const keyword = /^@(import|charset)\b/i.exec(css.slice(offset));
    if (!keyword) break;
    offset += keyword[0].length;
    const start = offset;
    let quote = '';
    let parentheses = 0;
    while (offset < css.length) {
      const character = css[offset++];
      if (character === '\\') {
        offset += 1;
        continue;
      }
      if (quote) {
        if (character === quote) quote = '';
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
        continue;
      }
      if (character === '(') parentheses += 1;
      if (character === ')') parentheses -= 1;
      if (character === ';' && !parentheses) break;
    }
    if (quote || parentheses || css[offset - 1] !== ';') break;
    if (keyword[1].toLowerCase() === 'charset') continue;
    const value = css.slice(start, offset - 1).trim();
    // Escaped paths are not reinterpreted. The archive resolver also rejects
    // protocols, rooted references and paths that escape the publication.
    if (value.includes('\\')) continue;
    const source =
      /^(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)'";]+))\s*\)|"([^"]*)"|'([^']*)')\s*(.*)$/i.exec(
        value
      );
    if (!source || !['', 'all', 'screen'].includes(source[6].trim().toLowerCase())) continue;
    const href = source.slice(1, 6).find((item) => item !== undefined);
    if (href) imports.push(href);
    if (imports.length > 64) throw new Error('EPUB stylesheet has too many imports.');
  }
  return imports;
}
