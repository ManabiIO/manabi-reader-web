/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

const predefined: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'"
};

/**
 * Decode attribute references after XML parsing, without enabling DTD entities.
 * One pass is deliberate: &amp;lt; denotes the literal text &lt;, not <.
 * Unknown named entities remain inert; XML-invalid numeric characters reject.
 */
export function decodeXmlAttributeReferences(value: string): string {
  return value.replace(
    /&(amp|lt|gt|quot|apos|#(?:[0-9]+|x[0-9a-fA-F]+));/g,
    (match, name: string) => {
      if (!name.startsWith('#')) return predefined[name];

      const hex = name.startsWith('#x');
      const point = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (
        point !== 0x9 &&
        point !== 0xa &&
        point !== 0xd &&
        !(point >= 0x20 && point <= 0xd7ff) &&
        !(point >= 0xe000 && point <= 0xfffd) &&
        !(point >= 0x10000 && point <= 0x10ffff)
      ) {
        throw new Error(`Invalid XML character reference: ${match}`);
      }
      return String.fromCodePoint(point);
    }
  );
}
