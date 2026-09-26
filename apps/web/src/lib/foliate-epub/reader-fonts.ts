/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Forward only app-owned font faces; publisher font loading is not enabled here. */
export function readerFontStyleSheet(document: Document): string {
  const origin = new URL(document.baseURI).origin;
  const rules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    const owner = sheet.ownerNode as Element | null;
    let base = document.baseURI;
    if (sheet.href) {
      const url = new URL(sheet.href, base);
      if (url.origin !== origin || !url.pathname.includes('/_app/immutable/assets/')) continue;
      base = url.href;
    } else if (
      owner?.id !== 'ttu-userfonts' &&
      !/\/src\/app\.(?:s?css)$/.test(owner?.getAttribute('data-vite-dev-id') ?? '')
    )
      continue;
    let entries: CSSRuleList;
    try {
      entries = sheet.cssRules;
    } catch {
      continue;
    }
    for (const entry of Array.from(entries)) {
      if (entry.type !== 5 || rules.length >= 256) continue;
      const face = entry as CSSFontFaceRule;
      let invalid = false;
      const source = face.style
        .getPropertyValue('src')
        .replace(
          /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi,
          (_, double: string, single: string, bare: string) => {
            try {
              const url = new URL((double ?? single ?? bare).trim(), base);
              if (url.origin !== origin || !/^https?:$/.test(url.protocol)) {
                invalid = true;
                return '';
              }
              return `url("${url.href.replaceAll('"', '%22')}")`;
            } catch {
              invalid = true;
              return '';
            }
          }
        );
      if (invalid || !source) continue;
      // CSSOM serialization preserves validated app/user-font descriptors.
      const descriptors = Array.from(face.style)
        .filter((name) => name !== 'src')
        .map((name) => `${name}:${face.style.getPropertyValue(name)};`)
        .join('');
      rules.push(`@font-face{${descriptors}src:${source};}`);
    }
  }
  return rules.join('\n');
}
