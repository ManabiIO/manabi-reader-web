/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Reader-owned text-selection interaction. No provider scanner or lexical model. */
export interface DictionaryChapterContext {
  bookKey: string;
  chapterID: string;
  signal: AbortSignal;
  analysis?: object | null;
}
interface Owner {
  root: HTMLElement;
  context: DictionaryChapterContext;
}
export interface ReaderDictionarySelection {
  owner: Owner | null;
  query: string;
  open: boolean;
  box: { left: number; top: number; bottom: number } | null;
}
let snapshot: ReaderDictionarySelection | null = null;
const listeners = new Set<() => void>();
const owners = new Set<Owner>();
const rootOwners = new WeakMap<Node, Owner>();
const documents = new Map<Document, { count: number; changed(): void }>();
const publish = (value: ReaderDictionarySelection | null) => {
  snapshot = value;
  for (const listener of listeners) listener();
};
export const readerDictionarySelection = {
  getSnapshot: () => snapshot,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
};
export function closeReaderDictionaryLookup() {
  publish(null);
}
export function dismissReaderDictionaryLookup() {
  if (snapshot?.box && snapshot.owner?.root.isConnected && !snapshot.owner.context.signal.aborted)
    publish({ ...snapshot, open: false });
  else publish(null);
}
export function openReaderDictionaryLookup() {
  if (snapshot && !snapshot.owner?.context.signal.aborted) {
    publish({ ...snapshot, open: true });
    return;
  }
  const owner = [...owners]
    .reverse()
    .find((item) => item.root.isConnected && !item.context.signal.aborted);
  publish({ owner: owner ?? null, query: '', open: true, box: null });
}

function selectionChanged(doc: Document) {
  if (snapshot?.open) return;
  const selection = doc.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  let owner: Owner | undefined;
  for (let node: Node | null = range?.startContainer ?? null; node; node = node.parentNode) {
    owner = rootOwners.get(node);
    if (owner) break;
  }
  const query = selection?.toString().trim() ?? '';
  if (
    !owner ||
    owner.context.signal.aborted ||
    !range ||
    !query ||
    [...query].length > 256 ||
    !owner.root.contains(range.endContainer)
  ) {
    if (snapshot?.owner?.root.ownerDocument === doc) publish(null);
    return;
  }
  const rect = range.getBoundingClientRect();
  publish({
    owner,
    query,
    open: false,
    box: { left: rect.left, top: rect.top, bottom: rect.bottom }
  });
}

/** Selection is an explicit user action. Attaching does not open provider storage,
 * intercept taps/page turns, mutate prose, or install a dictionary. The shared
 * popup acquires the selected provider only when the user asks for a lookup. */
export function attachReaderDictionaryInteraction(
  root: HTMLElement,
  context: DictionaryChapterContext
) {
  context.signal.throwIfAborted();
  const owner: Owner = { root, context };
  if (rootOwners.has(root)) throw new Error('The chapter already owns a dictionary interaction.');
  owners.add(owner);
  rootOwners.set(root, owner);
  root.dataset.readerDictionaryAttached = '';
  const doc = root.ownerDocument;
  let stopped = false;
  let documentOwner = documents.get(doc);
  if (!documentOwner) {
    documentOwner = { count: 0, changed: () => selectionChanged(doc) };
    documents.set(doc, documentOwner);
    doc.addEventListener('selectionchange', documentOwner.changed);
  }
  documentOwner.count++;
  const detach = () => {
    if (stopped) return;
    stopped = true;
    owners.delete(owner);
    rootOwners.delete(root);
    delete root.dataset.readerDictionaryAttached;
    if (--documentOwner.count === 0) {
      doc.removeEventListener('selectionchange', documentOwner.changed);
      documents.delete(doc);
    }
    context.signal.removeEventListener('abort', detach);
    if (snapshot?.owner === owner) publish(null);
  };
  context.signal.addEventListener('abort', detach, { once: true });
  return detach;
}
