/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { get } from 'svelte/store';
import { organization, importSnippetCollections } from '../library/organization';
import { getRecord, mutateRecord } from './database';
import {
  canonical,
  encodeSnippet,
  filename,
  parseSnippet,
  retainRemoteAncestor,
  snippetKey,
  type SnippetDocument
} from './document';
import { readerHTML } from './presentation';
import { scope, type SnippetScope } from './scope';
export const MAX_BACKUP_BYTES = 32 * 1024 * 1024;
export function download(name: string, raw: BlobPart, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([raw], { type })),
    anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export async function exportSnippets(
  ids: string[],
  selected = scope(),
  format: 'json' | 'html' | 'markdown' = 'json'
) {
  const unique = [...new Set(ids)];
  if (!unique.length || unique.length > 500) throw new Error('Select between 1 and 500 snippets.');
  const items: SnippetDocument[] = [];
  let total = 0;
  for (const id of unique) {
    const item = await getRecord(selected.owner, id);
    selected.guard();
    if (!item) throw new Error('A selected snippet is missing.');
    if (format === 'json' && item.conflicts.length)
      throw new Error(
        'Resolve this snippet’s conflicting versions, or export each version explicitly, before creating a JSON backup.'
      );
    const raw = encodeSnippet(item.document);
    total += new TextEncoder().encode(raw).length;
    if (total > MAX_BACKUP_BYTES)
      throw new Error('Select fewer snippets for an export under 32 MiB.');
    items.push(item.document);
  }
  selected.guard();
  if (items.length === 1) {
    const doc = items[0],
      name = filename(doc);
    if (format === 'html')
      download(
        name.replace(/\.manabi-snippet\.json$/, '.html'),
        `<!doctype html><meta charset="utf-8"><article lang="ja">${readerHTML(doc.content)}</article>`,
        'text/html'
      );
    else if (format === 'markdown') {
      const { exportMarkdown } = await import('./editor');
      selected.guard();
      download(
        name.replace(/\.manabi-snippet\.json$/, '.md'),
        exportMarkdown(doc.content),
        'text/markdown'
      );
    } else download(name, encodeSnippet(doc));
    return;
  }
  const members = new Set(unique.map(snippetKey));
  const collections = get(organization)
    .collections.map((c) => ({ ...c, members: c.members.filter((id) => members.has(id)) }))
    .filter((c) => c.members.length);
  const raw = canonical({ format: 'manabi-snippets-export', version: 1, items, collections });
  if (new TextEncoder().encode(raw).length > MAX_BACKUP_BYTES)
    throw new Error('Select fewer snippets for an export under 32 MiB.');
  download('Manabi snippets.manabi-snippets.json', raw);
}
export function decodeBackup(raw: string): {
  items: SnippetDocument[];
  collections: { id: string; name: string; members: string[] }[];
} {
  if (new TextEncoder().encode(raw).length > MAX_BACKUP_BYTES)
    throw new Error('Backup exceeds the 32 MiB limit.');
  const value = JSON.parse(raw);
  if (
    !value ||
    value.format !== 'manabi-snippets-export' ||
    value.version !== 1 ||
    !Array.isArray(value.items) ||
    value.items.length > 500 ||
    !Array.isArray(value.collections) ||
    value.collections.length > 1000
  )
    throw new Error('Unsupported snippet backup.');
  const items = value.items.map((d: unknown) => parseSnippet(canonical(d))) as SnippetDocument[];
  const ids = new Set(items.map((d) => snippetKey(d.id)));
  if (ids.size !== items.length) throw new Error('Duplicate document IDs in this backup.');
  const collections = value.collections.map(
    (c: { id: string; name: string; members: string[] }) => {
      if (
        !c ||
        typeof c.id !== 'string' ||
        c.id.length > 128 ||
        typeof c.name !== 'string' ||
        !c.name.trim() ||
        c.name.length > 240 ||
        !Array.isArray(c.members) ||
        c.members.length > 500 ||
        !c.members.every((id) => ids.has(id))
      )
        throw new Error('Invalid collection in snippet backup.');
      return { id: c.id, name: c.name, members: [...new Set(c.members)] };
    }
  );
  if (new Set(collections.map((c: { id: string }) => c.id)).size !== collections.length)
    throw new Error('Duplicate collections in this backup.');
  return { items, collections };
}
/** Restore never overwrites an existing conflicting document or adopts another installation's locators. */
export async function restoreBackup(raw: string, selected: SnippetScope) {
  const backup = decodeBackup(raw);
  for (const document of backup.items) {
    selected.guard();
    await mutateRecord(selected.owner, document.id, selected.guard, (current) => {
      if (!current)
        return {
          key: JSON.stringify([selected.owner, document.id]),
          owner: selected.owner,
          document,
          locations: [],
          dirty: false,
          conflicts: []
        };
      if (
        canonical(current.document) === canonical(document) ||
        current.conflicts.some((conflict) => canonical(conflict) === canonical(document))
      )
        return current;

      // Bounded revision ancestry is part of the portable document. Restoring an
      // older known ancestor is history, not a competing version.
      if (current.document.parents.includes(document.revision)) return current;
      if (current.conflicts.some((conflict) => conflict.parents.includes(document.revision)))
        return current;

      if (current.transfer || current.upload)
        throw new Error('Finish the pending snippet operation before restoring another version.');

      // If the backup advances an existing branch, replace only ancestors on
      // that branch. Unrelated siblings stay explicit conflicts.
      const conflicts = current.conflicts.filter(
        (conflict) => !document.parents.includes(conflict.revision)
      );
      if (document.parents.includes(current.document.revision)) {
        const restored = retainRemoteAncestor(document, current.remoteRevision);
        return {
          ...current,
          document: restored,
          conflicts,
          upload: undefined,
          dirty: !!current.destination,
          issue: conflicts.length ? 'Conflicting versions found. Both have been kept.' : undefined
        };
      }

      if (conflicts.length >= 8)
        throw new Error('Resolve existing document conflicts before restoring more versions.');
      return {
        ...current,
        conflicts: [...conflicts, document],
        issue: 'A different version was restored. Both versions are kept.'
      };
    });
  }
  selected.guard();
  await importSnippetCollections(backup.collections, selected.guard);
  selected.guard();
  return backup.items.length;
}
