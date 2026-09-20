/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** A source ID is opaque. Parentage is recorded by traversal, never inferred from slashes. */
export interface DirectoryEntry {
  id: string;
  parent: string;
  name: string;
  kind: 'file' | 'folder';
}
export interface LibraryBook<T> {
  kind: 'book';
  id: string;
  book: T;
}
export interface LibrarySeries<T> {
  kind: 'series';
  id: string;
  name: string;
  children: LibraryNode<T>[];
  books: T[];
}
export type LibraryNode<T> = LibraryBook<T> | LibrarySeries<T>;
const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
export function directoryTree<T>(
  entries: DirectoryEntry[],
  root: string,
  bookFor: (entry: DirectoryEntry) => T | undefined,
  names: Record<string, string> = {}
): LibraryNode<T>[] {
  const byParent = new Map<string, DirectoryEntry[]>(),
    seen = new Set<string>();
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const ordered = (nodes: LibraryNode<T>[]) =>
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'series' ? -1 : 1;
      const name = (node: LibraryNode<T>) =>
        node.kind === 'series' ? node.name : byId.get(node.id)!.name;
      return natural.compare(name(a), name(b)) || a.id.localeCompare(b.id);
    });
  for (const entry of entries) {
    if (entry.id === root || seen.has(entry.id))
      throw new Error('Duplicate or cyclic source entry.');
    seen.add(entry.id);
    let siblings = byParent.get(entry.parent);
    if (!siblings) {
      siblings = [];
      byParent.set(entry.parent, siblings);
    }
    siblings.push(entry);
  }
  function visit(parent: string, ancestors: Set<string>): LibraryNode<T>[] {
    if (ancestors.has(parent) || ancestors.size > 64)
      throw new Error('Cyclic or too deeply nested library.');
    const next = new Set([...ancestors, parent]);
    const children: LibraryNode<T>[] = [];
    for (const entry of (byParent.get(parent) ?? []).sort(
      (a, b) => natural.compare(a.name, b.name) || a.id.localeCompare(b.id)
    )) {
      if (entry.kind === 'file') {
        const book = bookFor(entry);
        if (book !== undefined) children.push({ kind: 'book', id: entry.id, book });
      } else {
        const nodes = visit(entry.id, next);
        // Flatten empty/singleton wrappers recursively. This is visual only: never move files.
        if (nodes.length <= 1) children.push(...nodes);
        else
          children.push({
            kind: 'series',
            id: entry.id,
            name: Object.hasOwn(names, entry.id) ? names[entry.id] : entry.name,
            children: directoriesFirst(nodes),
            books: nodes.flatMap((n) => (n.kind === 'book' ? [n.book] : n.books))
          });
      }
    }
    return ordered(children);
  }
  return visit(root, new Set());
}
export function directoriesFirst<T>(nodes: LibraryNode<T>[]) {
  return [...nodes.filter((n) => n.kind === 'series'), ...nodes.filter((n) => n.kind === 'book')];
}
/** Filter a built tree without changing directory identity or flattening it based on a filter. */
export function filterTree<T>(
  nodes: LibraryNode<T>[],
  include: (book: T) => boolean
): LibraryNode<T>[] {
  return nodes.flatMap((node): LibraryNode<T>[] => {
    if (node.kind === 'book') return include(node.book) ? [node] : [];
    const children = filterTree(node.children, include),
      books = node.books.filter(include);
    return books.length ? [{ ...node, children, books }] : [];
  });
}
