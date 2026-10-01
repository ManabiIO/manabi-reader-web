/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** The file is the document. Provider IDs, paths and hashes are only locations/revisions. */
export const SNIPPET_SUFFIX = '.manabi-snippet.json';
export const MAX_SNIPPET_BYTES = 2 * 1024 * 1024;
export const MAX_SNIPPET_SEARCH_CODEPOINTS = 512;
export function snippetSearchTooLong(value: string) {
  let count = 0;
  for (const _ of value) if (++count > MAX_SNIPPET_SEARCH_CODEPOINTS) return true;
  return false;
}
export const isSnippetFile = (name: string) => name.toLowerCase().endsWith(SNIPPET_SUFFIX);
/** Apply schema UTF-16 bounds without manufacturing an unpaired surrogate. */
export function truncateValidText(value: string, maximum: number): string {
  if (!Number.isSafeInteger(maximum) || maximum < 0) throw new Error('Invalid text limit.');
  if (value.length <= maximum) return value;
  let end = maximum;
  if (
    end > 0 &&
    end < value.length &&
    value.charCodeAt(end - 1) >= 0xd800 &&
    value.charCodeAt(end - 1) <= 0xdbff &&
    value.charCodeAt(end) >= 0xdc00 &&
    value.charCodeAt(end) <= 0xdfff
  )
    end--;
  return value.slice(0, end);
}
export const isUUID = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
export interface TextMark {
  type: string;
  attrs?: Record<string, unknown>;
}
export interface TextNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: TextMark[];
  content?: TextNode[];
}
export interface SnippetDocument {
  format: 'manabi-snippet';
  version: 1;
  id: string;
  revision: string;
  parents: string[];
  title: { mode: 'automatic' | 'custom'; text: string };
  createdAt: number;
  modifiedAt: number;
  content: TextNode;
  /** Applied capture receipts survive retries; never silently evict and replay an old operation. */
  captures: string[];
  trashedAt?: number;
  source?: { title: string; url?: string; item?: string; quote?: string };
}
export interface Passage {
  blockId: string;
  text: string;
  readings: { text: string; start: number; end: number }[];
}
export interface SnippetLocator {
  blockId: string;
  quote: string;
  before: string;
  offset: number;
  revision: string;
}
export interface SnippetHit {
  locator: SnippetLocator;
  excerpt: string;
  /** UTF-16 boundaries in the original excerpt. */
  excerptMatch: { start: number; end: number };
  reading: boolean;
}
export class SnippetError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'SnippetError';
    this.code = code;
  }
}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
function fail(
  message = 'This snippet has an unsupported or invalid document format. The original was not changed.'
): never {
  throw new SnippetError('invalid_document', message);
}
export function safeLink(value: unknown): value is string {
  // eslint-disable-next-line no-control-regex -- reject unsafe control characters
  if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u0020\u007f]/.test(value))
    return false;
  try {
    return ['https:', 'http:', 'mailto:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
const validText = (value: unknown, length: number): value is string =>
  typeof value === 'string' &&
  value.length <= length &&
  // eslint-disable-next-line no-control-regex -- reject unsafe control characters
  !/[\u0000\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(value);
const blockTypes = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
  'codeBlock',
  'horizontalRule'
]);
/** Reject, rather than strip, unknown authored content. Reader HTML is never parsed back on save. */
export function validateContent(value: unknown): asserts value is TextNode {
  let nodes = 0;
  const ids = new Set<string>();
  function visit(node: unknown, parent: string | null, depth: number) {
    if (
      ++nodes > 50000 ||
      depth > 32 ||
      !object(node) ||
      !exact(node, ['type', 'text', 'attrs', 'marks', 'content'])
    )
      fail();
    const type = node.type;
    if (typeof type !== 'string' || !['doc', 'text', 'hardBreak', ...blockTypes].includes(type))
      fail();
    if (parent === null && type !== 'doc') fail();
    if (parent !== null && type === 'doc') fail();
    if (parent === 'doc' || parent === 'blockquote' || parent === 'listItem') {
      if (!blockTypes.has(type) || type === 'listItem') fail();
    } else if (parent === 'bulletList' || parent === 'orderedList') {
      if (type !== 'listItem') fail();
    } else if (parent === 'paragraph' || parent === 'heading') {
      if (type !== 'text' && type !== 'hardBreak') fail();
    } else if (parent === 'codeBlock' && type !== 'text') fail();
    if (node.attrs !== undefined) {
      if (
        !object(node.attrs) ||
        !exact(node.attrs, [
          'id',
          ...(type === 'heading'
            ? ['level']
            : type === 'orderedList'
              ? ['start', 'type']
              : type === 'codeBlock'
                ? ['language']
                : [])
        ])
      )
        fail();
      const attrs = node.attrs;
      if (attrs.id != null) {
        if (!blockTypes.has(type) || !isUUID(attrs.id) || ids.has(attrs.id)) fail();
        ids.add(attrs.id);
      }
      if (
        type === 'heading' &&
        (!Number.isInteger(attrs.level) || Number(attrs.level) < 1 || Number(attrs.level) > 6)
      )
        fail();
      if (
        attrs.start !== undefined &&
        (!Number.isInteger(attrs.start) || Number(attrs.start) < 1 || Number(attrs.start) > 1000000)
      )
        fail();
      if (attrs.type != null && !['1', 'a', 'A', 'i', 'I'].includes(String(attrs.type))) fail();
      if (attrs.language != null && !validText(attrs.language, 80)) fail();
    }
    if (node.marks !== undefined) {
      if (
        !Array.isArray(node.marks) ||
        node.marks.length > 8 ||
        type !== 'text' ||
        parent === 'codeBlock'
      )
        fail();
      const names = new Set<string>();
      for (const mark of node.marks) {
        if (
          !object(mark) ||
          !exact(mark, ['type', 'attrs']) ||
          typeof mark.type !== 'string' ||
          names.has(mark.type)
        )
          fail();
        names.add(mark.type);
        if (
          !['bold', 'italic', 'strike', 'underline', 'code', 'link', 'rubyText'].includes(mark.type)
        )
          fail();
        if (mark.type === 'link') {
          if (
            !object(mark.attrs) ||
            !exact(mark.attrs, ['href', 'target', 'rel', 'class', 'title']) ||
            !safeLink(mark.attrs.href)
          )
            fail();
          if (mark.attrs.target != null && !['_blank', '_self'].includes(String(mark.attrs.target)))
            fail();
          if (mark.attrs.rel != null && !validText(mark.attrs.rel, 120)) fail();
          if (
            mark.attrs.class != null ||
            (mark.attrs.title != null && !validText(mark.attrs.title, 1000))
          )
            fail();
        } else if (mark.type === 'rubyText') {
          if (
            !object(mark.attrs) ||
            !exact(mark.attrs, ['rt']) ||
            (mark.attrs.rt !== null && !validText(mark.attrs.rt, 1000))
          )
            fail();
        } else if (
          mark.attrs !== undefined &&
          (!object(mark.attrs) || Object.keys(mark.attrs).length)
        )
          fail();
      }
    }
    if (type === 'text') {
      if (
        !validText(node.text, MAX_SNIPPET_BYTES) ||
        !node.text.length ||
        node.content !== undefined ||
        node.attrs !== undefined
      )
        fail();
    } else {
      if (node.text !== undefined) fail();
      const children = node.content ?? [];
      if (
        !Array.isArray(children) ||
        (['hardBreak', 'horizontalRule'].includes(type) && children.length)
      )
        fail();
      if (
        ['doc', 'blockquote', 'bulletList', 'orderedList', 'listItem'].includes(type) &&
        children.length === 0
      )
        fail();
      if (type === 'listItem' && children[0]?.type !== 'paragraph') fail();
      for (const child of children) visit(child, type, depth + 1);
    }
  }
  visit(value, null, 0);
}
export function parseSnippet(raw: string): SnippetDocument {
  if (new TextEncoder().encode(raw).length > MAX_SNIPPET_BYTES)
    throw new SnippetError('too_large', 'Snippets are limited to 2 MiB.');
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return fail();
  }
  if (
    !object(value) ||
    !exact(value, [
      'format',
      'version',
      'id',
      'revision',
      'parents',
      'title',
      'createdAt',
      'modifiedAt',
      'content',
      'captures',
      'source',
      'trashedAt'
    ]) ||
    value.format !== 'manabi-snippet' ||
    value.version !== 1 ||
    !isUUID(value.id) ||
    !isUUID(value.revision) ||
    !Array.isArray(value.parents) ||
    value.parents.length > 16 ||
    !value.parents.every(isUUID) ||
    new Set(value.parents).size !== value.parents.length ||
    value.parents.includes(value.revision) ||
    !object(value.title) ||
    !exact(value.title, ['mode', 'text']) ||
    !['automatic', 'custom'].includes(String(value.title.mode)) ||
    !validText(value.title.text, 1000) ||
    (value.title.mode === 'custom' && !value.title.text.trim()) ||
    !Number.isSafeInteger(value.createdAt) ||
    Number(value.createdAt) < 0 ||
    !Number.isSafeInteger(value.modifiedAt) ||
    Number(value.modifiedAt) < Number(value.createdAt) ||
    !Array.isArray(value.captures) ||
    value.captures.length > 10000 ||
    !value.captures.every(isUUID) ||
    new Set(value.captures).size !== value.captures.length
  )
    fail();
  if (
    value.trashedAt !== undefined &&
    (!Number.isSafeInteger(value.trashedAt) || Number(value.trashedAt) < 0)
  )
    fail();
  if (value.source !== undefined) {
    if (
      !object(value.source) ||
      !exact(value.source, ['title', 'url', 'item', 'quote']) ||
      !validText(value.source.title, 1000) ||
      (value.source.url !== undefined && !safeLink(value.source.url)) ||
      (value.source.item !== undefined && !validText(value.source.item, 1000)) ||
      (value.source.quote !== undefined && !validText(value.source.quote, 4000))
    )
      fail();
  }
  validateContent(value.content);
  return value as unknown as SnippetDocument;
}
/** Deterministic object ordering makes retry verification independent of JSON key ordering. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value))
    return (
      '{' +
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + canonical(value[key]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value) ?? 'null';
}
export function encodeSnippet(document: SnippetDocument): string {
  const raw = canonical(document);
  parseSnippet(raw + '\n');
  return raw + '\n';
}
export function identifyBlocks(content: TextNode, replace = false): TextNode {
  const copy = structuredClone(content),
    seen = new Set<string>();
  function walk(node: TextNode) {
    if (blockTypes.has(node.type)) {
      let id = node.attrs?.id;
      if (replace || !isUUID(id) || seen.has(id)) id = crypto.randomUUID();
      node.attrs = { ...node.attrs, id };
      seen.add(id as string);
    }
    node.content?.forEach(walk);
  }
  walk(copy);
  return copy;
}
export function plainContent(text: string): TextNode {
  return identifyBlocks({
    type: 'doc',
    content: text
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => ({
        type: 'paragraph',
        ...(line ? { content: [{ type: 'text', text: line }] } : {})
      }))
  });
}
export function createSnippet(content = plainContent(''), title = ''): SnippetDocument {
  const now = Date.now();
  return parseSnippet(
    JSON.stringify({
      format: 'manabi-snippet',
      version: 1,
      id: crypto.randomUUID(),
      revision: crypto.randomUUID(),
      parents: [],
      title: { mode: title.trim() ? 'custom' : 'automatic', text: title.trim() },
      createdAt: now,
      modifiedAt: now,
      content: identifyBlocks(content),
      captures: []
    })
  );
}
export function editSnippet(
  document: SnippetDocument,
  content: TextNode,
  title: string
): SnippetDocument {
  return parseSnippet(
    JSON.stringify({
      ...document,
      revision: crypto.randomUUID(),
      parents: [...new Set([document.revision, ...document.parents])].slice(0, 16),
      modifiedAt: Math.max(Date.now(), document.modifiedAt),
      title: { mode: title.trim() ? 'custom' : 'automatic', text: title.trim() },
      content: identifyBlocks(content)
    })
  );
}
/** Keep the acknowledged provider revision in bounded local history until its successor is saved.
 * Apply only to local edits, never to a document received from a provider. */
export function retainRemoteAncestor(
  document: SnippetDocument,
  remoteRevision: string | undefined
): SnippetDocument {
  if (
    !remoteRevision ||
    document.revision === remoteRevision ||
    document.parents.includes(remoteRevision)
  )
    return document;
  return { ...document, parents: [remoteRevision, ...document.parents].slice(0, 16) };
}
export function appendSnippet(
  document: SnippetDocument,
  content: TextNode,
  operation: string
): SnippetDocument {
  if (!isUUID(operation)) fail('Invalid capture receipt.');
  if (document.captures.includes(operation)) return document;
  validateContent(content);
  if (!passages(content).some((block) => block.text.trim())) return document;
  const next = editSnippet(
    document,
    {
      type: 'doc',
      content: [
        ...(document.content.content ?? []),
        ...(identifyBlocks(content, true).content ?? [])
      ]
    },
    document.title.mode === 'custom' ? document.title.text : ''
  );
  next.captures = [...document.captures, operation];
  return parseSnippet(encodeSnippet(next));
}
export function passages(content: TextNode): Passage[] {
  const result: Passage[] = [];
  function walk(node: TextNode, path: string) {
    if (['paragraph', 'heading', 'codeBlock'].includes(node.type)) {
      const block: Passage = { blockId: String(node.attrs?.id ?? path), text: '', readings: [] };
      for (const child of node.content ?? []) {
        const start = block.text.length;
        block.text += child.text ?? (child.type === 'hardBreak' ? '\n' : '');
        const rt = child.marks?.find((mark) => mark.type === 'rubyText')?.attrs?.rt;
        if (typeof rt === 'string' && rt)
          block.readings.push({ text: rt, start, end: block.text.length });
      }
      result.push(block);
    } else node.content?.forEach((child, index) => walk(child, `${path}.${index}`));
  }
  walk(content, '0');
  return result;
}
export function displayTitle(document: SnippetDocument): string {
  if (document.title.mode === 'custom') return document.title.text;
  const blocks = passages(document.content);
  const heading = (node: TextNode): TextNode | undefined =>
    node.type === 'heading' && passages(node).some((block) => block.text.trim())
      ? node
      : node.content?.map(heading).find(Boolean);
  const preferred = heading(document.content);
  const text =
    (preferred ? passages(preferred)[0]?.text : blocks.find((block) => block.text.trim())?.text)
      ?.replace(/\s+/g, ' ')
      .trim() ?? '';
  const units = [...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(text)].map(
    (part) => part.segment
  );
  return units.length
    ? units.slice(0, 36).join('') + (units.length > 36 ? '…' : '')
    : 'Untitled snippet';
}
export function filename(document: SnippetDocument): string {
  const title =
    [...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(displayTitle(document))]
      .slice(0, 70)
      .map((part) => part.segment)
      .join('')
      // eslint-disable-next-line no-control-regex -- reject unsafe control characters
      .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, ' ')
      .replace(/^[. ]+|[. ]+$/g, '') || 'Snippet';
  const suffix = ` — ${document.id}${SNIPPET_SUFFIX}`;
  const budget = 240 - new TextEncoder().encode(suffix).length;
  let safe = '';
  for (const part of new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(title)) {
    if (new TextEncoder().encode(safe + part.segment).length > budget) break;
    safe += part.segment;
  }
  return `${safe.replace(/[. ]+$/g, '') || 'Snippet'}${suffix}`;
}
export const snippetKey = (id: string) => `snippet:${id}`;
export const isSnippetKey = (value: string) =>
  value.startsWith('snippet:') && isUUID(value.slice(8));
export function fold(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ja')
    .replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60));
}
export function searchSnippet(document: SnippetDocument, query: string, limit = 20): SnippetHit[] {
  if (snippetSearchTooLong(query)) return [];
  const needle = fold(query.trim());
  if (!needle) return [];
  const hits: SnippetHit[] = [];
  for (const block of passages(document.content)) {
    // Normalize per grapheme and retain original UTF-16 offsets, including width expansion.
    let normalized = '';
    const offsets: number[] = [],
      ends: number[] = [];
    for (const part of new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(block.text)) {
      const unit = fold(part.segment);
      normalized += unit;
      for (let i = 0; i < unit.length; i++) {
        offsets.push(part.index);
        ends.push(part.index + part.segment.length);
      }
    }
    const index = normalized.indexOf(needle);
    const ruby = block.readings.find((reading) => fold(reading.text).includes(needle));
    if (index < 0 && !ruby) continue;
    const start = index >= 0 ? offsets[index] : ruby!.start;
    const end = index >= 0 ? (ends[index + needle.length - 1] ?? block.text.length) : ruby!.end;
    const excerptStart = Math.max(0, start - 40);
    hits.push({
      locator: {
        blockId: block.blockId,
        quote: block.text.slice(start, Math.max(start + 1, end)),
        before: block.text.slice(Math.max(0, start - 24), start),
        offset: start,
        revision: document.revision
      },
      excerpt: block.text.slice(excerptStart, Math.max(end, start + 100)),
      excerptMatch: { start: start - excerptStart, end: end - excerptStart },
      reading: index < 0
    });
    if (hits.length >= limit) break;
  }
  return hits;
}
export function resolveLocator(
  document: SnippetDocument,
  locator: SnippetLocator
): { blockId: string; offset: number } | null {
  const blocks = passages(document.content);
  const same = blocks.find((block) => block.blockId === locator.blockId);
  if (
    same &&
    same.text.slice(locator.offset, locator.offset + locator.quote.length) === locator.quote
  )
    return { blockId: same.blockId, offset: locator.offset };
  if (!locator.quote) return same ? { blockId: same.blockId, offset: 0 } : null;
  const candidates = blocks.flatMap((block) => {
    const found: { blockId: string; offset: number }[] = [];
    for (
      let index = block.text.indexOf(locator.quote);
      index >= 0;
      index = block.text.indexOf(locator.quote, index + 1)
    ) {
      if (
        !locator.before ||
        block.text.slice(Math.max(0, index - locator.before.length), index) === locator.before
      )
        found.push({ blockId: block.blockId, offset: index });
      if (found.length > 1) break;
    }
    return found;
  });
  return candidates.length === 1 ? candidates[0] : null;
}
