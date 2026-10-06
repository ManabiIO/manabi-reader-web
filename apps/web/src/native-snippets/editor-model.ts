/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  editSnippet,
  identifyBlocks,
  safeLink,
  validateContent,
  type SnippetDocument,
  type TextNode
} from '../lib/snippets/document';
import type { NativeSnippetPatch, NativeSnippetRun } from './contract';
export const MAX_NATIVE_EDITOR_BYTES = 320 * 1024;
export const MAX_NATIVE_RUNS = 400;
interface Run {
  node: TextNode;
  parent?: TextNode;
  index?: number;
  empty?: boolean;
  block: string;
  key: string;
}
function runs(content: TextNode) {
  const result: Run[] = [];
  function visit(node: TextNode, path: string, block: string, parent?: TextNode, index?: number) {
    const label = ['paragraph', 'heading', 'codeBlock'].includes(node.type)
      ? `${node.type === 'heading' ? `Heading ${node.attrs?.level ?? 1}` : node.type === 'codeBlock' ? 'Code' : 'Paragraph'} ${result.length + 1}`
      : block;
    if (node.type === 'text') result.push({ node, parent, index, key: path, block: label });
    else if (['paragraph', 'heading', 'codeBlock'].includes(node.type) && !node.content?.length)
      result.push({ node, key: path, block: label, empty: true });
    node.content?.forEach((child, i) => visit(child, `${path}.${i}`, label, node, i));
  }
  visit(content, '0', 'Text');
  return result;
}
/** Paths identify runs only within an admitted draft revision; they never address storage. */
export function nativeRuns(document: SnippetDocument): NativeSnippetRun[] {
  if (new TextEncoder().encode(JSON.stringify(document)).length > MAX_NATIVE_EDITOR_BYTES)
    throw new Error(
      'This document exceeds the native editor’s 320 KiB limit. Its original is unchanged; use the web editor.'
    );
  const entries = runs(document.content);
  if (entries.length > MAX_NATIVE_RUNS)
    throw new Error(
      'This document has more than 400 text runs. Its original is unchanged; use the web editor.'
    );
  return entries.map(({ node, key, block, empty }) => ({
    key,
    block,
    text: node.text ?? '',
    ...(node.marks?.some((mark) => mark.type === 'rubyText')
      ? { ruby: String(node.marks.find((mark) => mark.type === 'rubyText')?.attrs?.rt ?? '') }
      : {}),
    marks: node.marks?.filter((mark) => mark.type !== 'rubyText').map((mark) => mark.type) ?? [],
    ...(empty ? { empty: true } : {})
  }));
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export function parsePatch(value: unknown): NativeSnippetPatch {
  if (
    !object(value) ||
    Object.keys(value).some(
      (key) => !['title', 'runs', 'source', 'append', 'destinationKey'].includes(key)
    ) ||
    typeof value.title !== 'string' ||
    value.title.length > 1000 ||
    !Array.isArray(value.runs) ||
    value.runs.length > MAX_NATIVE_RUNS ||
    !object(value.source) ||
    Object.keys(value.source).some((key) => !['title', 'url'].includes(key)) ||
    typeof value.source.title !== 'string' ||
    value.source.title.length > 1000 ||
    typeof value.source.url !== 'string' ||
    value.source.url.length > 4096 ||
    (value.source.url !== '' && !safeLink(value.source.url)) ||
    (value.append !== undefined &&
      (typeof value.append !== 'string' || value.append.length > 100000)) ||
    (value.destinationKey !== undefined &&
      value.destinationKey !== null &&
      (typeof value.destinationKey !== 'string' || value.destinationKey.length > 128))
  )
    throw new Error('Invalid native snippet edit. Use a safe source link and bounded text.');
  const seen = new Set();
  for (const run of value.runs) {
    if (
      !object(run) ||
      Object.keys(run).some((key) => !['key', 'text', 'ruby'].includes(key)) ||
      typeof run.key !== 'string' ||
      run.key.length > 128 ||
      seen.has(run.key) ||
      typeof run.text !== 'string' ||
      run.text.length > 100000 ||
      (run.ruby !== undefined && (typeof run.ruby !== 'string' || run.ruby.length > 1000))
    )
      throw new Error('Invalid text or furigana edit.');
    seen.add(run.key);
  }
  if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_NATIVE_EDITOR_BYTES)
    throw new Error('This native edit is too large.');
  return structuredClone(value) as unknown as NativeSnippetPatch;
}
export function applyNativePatch(document: SnippetDocument, patch: NativeSnippetPatch) {
  const content = structuredClone(document.content);
  const entries = runs(content);
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  if (patch.runs.length !== entries.length || patch.runs.some((run) => !byKey.has(run.key)))
    throw new Error('The draft structure changed. Reopen the saved draft before editing.');
  // Process removals backwards so every admitted index still identifies the original node.
  for (const value of [...patch.runs].sort(
    (a, b) => (byKey.get(b.key)?.index ?? 0) - (byKey.get(a.key)?.index ?? 0)
  )) {
    const entry = byKey.get(value.key)!;
    const node = entry.node;
    if (entry.empty) {
      if (value.ruby) throw new Error('Add the paragraph text before adding furigana.');
      if (value.text) node.content = [{ type: 'text', text: value.text }];
      continue;
    }
    if (!value.text) {
      entry.parent!.content!.splice(entry.index!, 1);
      continue;
    }
    node.text = value.text;
    if (value.ruby !== undefined) {
      if (entry.parent?.type === 'codeBlock' && value.ruby)
        throw new Error('Code blocks cannot contain furigana.');
      const marks = node.marks?.filter((mark) => mark.type !== 'rubyText') ?? [];
      if (value.ruby) marks.push({ type: 'rubyText', attrs: { rt: value.ruby } });
      if (marks.length) node.marks = marks;
      else delete node.marks;
    }
  }
  if (patch.append?.length)
    content.content!.push(
      ...identifyBlocks({
        type: 'doc',
        content: patch.append
          .replace(/\r\n?/g, '\n')
          .split('\n')
          .map((text) => ({
            type: 'paragraph',
            ...(text ? { content: [{ type: 'text', text }] } : {})
          }))
      }).content!
    );
  validateContent(content);
  const next = editSnippet(document, content, patch.title);
  if (patch.source.title || patch.source.url || document.source?.item || document.source?.quote)
    next.source = {
      ...document.source,
      title: patch.source.title,
      ...(patch.source.url ? { url: patch.source.url } : {})
    };
  else delete next.source;
  if (next.source && !patch.source.url) delete next.source.url;
  nativeRuns(next);
  return next;
}
