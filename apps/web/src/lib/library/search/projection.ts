/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { digest } from './digest.ts';
import { XMLParser } from 'fast-xml-parser';
import { projectionBlockTags, projectionExcluded } from '../../reader-projection.ts';
import type { PublicationManifest, PublicationResource } from '../../reader-location';

interface OrderedNode {
  [tag: string]: unknown;
  ':@'?: Record<string, string>;
  '#text'?: string;
}
export interface SearchResource {
  resource: PublicationResource;
  text: string;
  digest: string;
}
const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
  htmlEntities: true,
  allowBooleanAttributes: true,
  commentPropName: '#comment',
  unpairedTags: [
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr'
  ]
});
const tagFor = (node: OrderedNode) =>
  Object.keys(node).find(
    (key) => key !== ':@' && !key.startsWith('#') && !key.startsWith('?') && !key.startsWith('!')
  );

/** Stored content is already sanitized HTML serialization, not arbitrary XML/EPUB input. */
export async function projectStoredBook(
  html: string,
  manifest?: PublicationManifest
): Promise<SearchResource[]> {
  if (typeof html !== 'string' || html.length > 32_000_000)
    throw new Error('Book content is too large to index.');
  // Never expand a DTD supplied by a corrupt/legacy record.
  if (/<!DOCTYPE|<!ENTITY/i.test(html))
    throw new Error('Unsupported declarations in stored book content.');
  const roots: OrderedNode[] = parser.parse(html);
  const sections = roots.filter((node) => tagFor(node));
  if (manifest && (manifest.version !== 1 || manifest.resources.length !== sections.length))
    throw new Error('The publication manifest does not match its text.');
  let nodes = 0,
    length = 0;
  const result: SearchResource[] = [];
  for (let index = 0; index < sections.length; index++) {
    const section = sections[index],
      tag = tagFor(section)!;
    const resource = manifest?.resources[index] ?? {
      href: `legacy-section-${index}`,
      spineIndex: index,
      sectionId: section[':@']?.id || `section-${index}`
    };
    const parts: string[] = [];
    const separator = () => {
      if (parts.length && parts.at(-1) !== '\n') parts.push('\n');
    };
    type Visit = { node: OrderedNode; depth: number } | { endBlock: true };
    const stack: Visit[] = (section[tag] as OrderedNode[])
      .slice()
      .reverse()
      .map((node) => ({ node, depth: 0 }));
    while (stack.length) {
      const entry = stack.pop()!;
      if ('endBlock' in entry) {
        separator();
        continue;
      }
      if (++nodes > 100_000 || entry.depth > 256)
        throw new Error('Book markup is too complex to index.');
      const node = entry.node;
      if (Object.hasOwn(node, '#text')) {
        const text = String(node['#text'] ?? '');
        length += text.length;
        if (length > 8_000_000) throw new Error('Book text is too large to index.');
        if (text) parts.push(text);
        continue;
      }
      const name = tagFor(node);
      if (!name) continue;
      const upper = name.toUpperCase();
      if (projectionExcluded(upper, node[':@'] ?? {})) continue;
      if (upper === 'BR') {
        separator();
        continue;
      }
      const block = projectionBlockTags.has(upper);
      if (block) {
        separator();
        stack.push({ endBlock: true });
      }
      const children = node[name];
      if (!Array.isArray(children)) continue;
      for (let i = children.length - 1; i >= 0; i--)
        stack.push({ node: children[i], depth: entry.depth + 1 });
    }
    if (parts.at(-1) === '\n') parts.pop();
    const text = parts.join('');
    result.push({ resource, text, digest: await digest(text) });
  }
  return result;
}
