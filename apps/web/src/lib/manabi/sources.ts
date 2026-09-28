/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  decodeSeriesMetadata,
  isSeriesMetadataFilename,
  legacySeriesMetadataFilename,
  seriesMetadataFilename
} from '$lib/library/series-metadata';
import { IntegrationError, currentUser, request } from './client';
import { validateBookDownloadSize, verifySelectedBook } from '../library/book-download.ts';
import { commitTransaction } from '../data/database/books-db/commit-transaction.mjs';
import { withLibraryOperation } from './operation-scope';
import { maxManagedStateBytes } from './auth-contract';
import { integrationDB, exclusive, equal, type LocalLibrary } from './persistence';

export interface LibraryEntry {
  id: string;
  name: string;
  kind: 'file' | 'folder';
  size?: number;
  /** A verified shelf observation, checked by source reads as well as imports. */
  expectedContentHash?: string;
}
export interface StateCopy {
  value: Record<string, unknown> | null;
  revision: string;
  headIds?: string[];
  branches?: { id: string; value: Record<string, unknown>; createdAt: string }[];
}
export interface LibrarySource {
  id: string;
  owner: string | null;
  root: string;
  list(parent?: string, cursor?: string): Promise<{ items: LibraryEntry[]; cursor: string }>;
  read(item: LibraryEntry): Promise<File>;
  state(key: string): Promise<StateCopy>;
  write(key: string, value: Record<string, unknown>, revision: string): Promise<StateCopy>;
}
export interface CloudConnection {
  id: string;
  provider: string;
  roots: string[];
  needs_reconnect: boolean;
}
export const supportedLibraryFile = (name: string) =>
  supportedBook(name) || name.toLowerCase().endsWith('.manabi-snippet.json');
export const supportedBook = (name: string) => /\.(epub|txt|htmlz)$/i.test(name);
const maxBookBytes = 128 * 1024 * 1024;
const stateDirectory = '.manabi-reader';
const maxLocalRevisions = 5000;

export async function sha256(value: ArrayBuffer | Uint8Array | string): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
}
function stateKey(key: string) {
  if (!/^(?:book_[a-f0-9]{64}|snippet_[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/.test(key))
    throw new Error('Invalid managed reading-state key');
  return key;
}
function jsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function boundState(value: Record<string, unknown>) {
  const raw = JSON.stringify(value);
  if (new TextEncoder().encode(raw).length > maxManagedStateBytes)
    throw new IntegrationError('too_large');
  return raw;
}

export class CloudLibrary implements LibrarySource {
  constructor(
    public readonly id: string,
    public readonly owner: string,
    public readonly root: string
  ) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid connection ID');
  }
  private path(operation: string, values: Record<string, string> = {}) {
    return `connections/${this.id}/${operation}/?${new URLSearchParams({ root: this.root, ...values })}`;
  }
  async list(parent = this.root, cursor = '') {
    return request<{ items: LibraryEntry[]; cursor: string }>(
      this.path('files', { parent, ...(cursor ? { cursor } : {}) }),
      { userId: this.owner }
    );
  }
  async read(item: LibraryEntry) {
    const selected = { ...item };
    return withLibraryOperation(this.owner, async () => {
      if (selected.kind !== 'file' || !supportedBook(selected.name))
        throw new IntegrationError('unsupported');
      validateBookDownloadSize(selected.size);
      const bytes = await request<ArrayBuffer>(this.path('file', { id: selected.id }), {
        userId: this.owner,
        binary: true,
        maximumBytes: maxBookBytes
      });
      validateBookDownloadSize(selected.size, bytes.byteLength);
      const file = new File([bytes], selected.name, {
        type: selected.name.toLowerCase().endsWith('.epub')
          ? 'application/epub+zip'
          : 'application/octet-stream'
      });
      return verifySelectedBook(file, selected.expectedContentHash);
    });
  }
  async readSeriesName(item: LibraryEntry) {
    if (
      item.kind !== 'file' ||
      !isSeriesMetadataFilename(item.name) ||
      (item.size !== undefined && item.size > 4096)
    )
      throw new Error('Invalid or oversized series metadata.');
    const bytes = await request<ArrayBuffer>(this.path('file', { id: item.id }), {
      userId: this.owner,
      binary: true,
      maximumBytes: 4096
    });
    return decodeSeriesMetadata(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  }
  async state(key: string) {
    return request<StateCopy>(this.path('state', { key: stateKey(key) }), { userId: this.owner });
  }
  async write(key: string, value: Record<string, unknown>, revision: string) {
    boundState(value);
    return request<StateCopy>(this.path('state', { key: stateKey(key) }), {
      method: 'PUT',
      value,
      revision,
      userId: this.owner
    });
  }
}

export function supportsLocalLibraries() {
  return typeof window !== 'undefined' && window.isSecureContext && 'showDirectoryPicker' in window;
}
export async function addLocalLibrary(): Promise<LocalLibrary | null> {
  if (!supportsLocalLibraries()) throw new IntegrationError('unsupported');
  let handle: FileSystemDirectoryHandle;
  try {
    // Invoke directly from the click handler, before any asynchronous storage work.
    handle = await window.showDirectoryPicker({ mode: 'read', id: 'manabi-reader-books' });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    throw error;
  }
  const db = await integrationDB();
  for (const library of await db.getAll('localLibraries')) {
    if (await library.handle.isSameEntry(handle)) return library;
  }
  const library: LocalLibrary = {
    id: `local-${crypto.randomUUID()}`,
    name: handle.name,
    handle,
    writable: false
  };
  await db.put('localLibraries', library);
  return library;
}
const localLibraryLock = <T>(id: string, work: () => Promise<T>) =>
  exclusive(`local-library-source:${id}`, work);
export async function reconnectLocalLibrary(library: LocalLibrary, write = false) {
  const selected = { ...library };
  const mode = write ? 'readwrite' : 'read';
  // Start permission UI in the initiating click, before any storage work.
  if ((await selected.handle.requestPermission({ mode })) !== 'granted')
    throw new IntegrationError('permission_required');
  const writable = await localLibraryLock(selected.id, async () => {
    const db = await integrationDB();
    const tx = db.transaction('localLibraries', 'readwrite');
    return commitTransaction(tx, async () => {
      const current = await tx.store.get(selected.id);
      // A late permission result is not permission to recreate a disconnected source.
      if (!current) throw new IntegrationError('not_found');
      const next = { ...current, writable: write || current.writable };
      await tx.store.put(next);
      return next.writable;
    });
  });
  // Callers use this snapshot for the next file operation. Publish only on commit.
  library.writable = writable;
}
export async function removeLocalLibrary(id: string) {
  await localLibraryLock(id, async () => {
    const db = await integrationDB();
    const tx = db.transaction(['localLibraries', 'books'], 'readwrite');
    await commitTransaction(tx, async () => {
      await tx.objectStore('localLibraries').delete(id);
      for (const link of await tx.objectStore('books').getAll()) {
        if (link.sourceId === id) await tx.objectStore('books').delete(link.id);
      }
    });
  });
  // Disconnecting waits for admitted source work, then prevents later work from
  // using a retained FileSystem handle. It never deletes original files/history.
}

function segments(path: string) {
  if (!path) return [];
  const parts = path.split('/');
  if (
    // eslint-disable-next-line no-control-regex
    parts.some((p) => !p || p === '.' || p === '..' || p.includes('\\') || /[\x00-\x1f]/.test(p))
  ) {
    throw new IntegrationError('forbidden');
  }
  return parts;
}
interface RevisionDocument {
  version: 1;
  id: string;
  parents: string[];
  createdAt: string;
  value: Record<string, unknown>;
}

export class LocalLibrarySource implements LibrarySource {
  readonly owner = null;
  readonly root = '';
  readonly id: string;
  constructor(public readonly library: LocalLibrary) {
    this.id = library.id;
  }
  private async withConnection<T>(
    write: boolean,
    work: (library: LocalLibrary) => Promise<T>
  ): Promise<T> {
    return localLibraryLock(this.id, async () => {
      const current = await (await integrationDB()).get('localLibraries', this.id);
      if (!current) throw new IntegrationError('not_found');
      if (
        (write && !current.writable) ||
        (await current.handle.queryPermission({ mode: write ? 'readwrite' : 'read' })) !== 'granted'
      )
        throw new IntegrationError('permission_required');
      return work(current);
    });
  }
  private async directory(root: FileSystemDirectoryHandle, path: string) {
    let result = root;
    for (const part of segments(path)) {
      if (part === stateDirectory) throw new IntegrationError('forbidden');
      result = await result.getDirectoryHandle(part);
    }
    return result;
  }
  async seriesName(parent: string): Promise<string | undefined> {
    if (!parent) return undefined;
    return this.withConnection(false, async (library) => {
      const directory = await this.directory(library.handle, parent);
      let handle: FileSystemFileHandle | undefined;
      for (const filename of [seriesMetadataFilename, legacySeriesMetadataFilename]) {
        try {
          handle = await directory.getFileHandle(filename);
          break;
        } catch (error) {
          if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
        }
      }
      if (!handle) return undefined;
      const file = await handle.getFile();
      if (file.size > 4096) throw new Error('Series metadata is too large.');
      return decodeSeriesMetadata(await file.text());
    });
  }
  async list(parent = '', cursor = '') {
    return this.withConnection(false, async (library) => {
      const directory = await this.directory(library.handle, parent);
      const items: LibraryEntry[] = [];
      for await (const [name, handle] of directory.entries()) {
        if (name === stateDirectory || (handle.kind === 'file' && !supportedLibraryFile(name)))
          continue;
        items.push({
          id: parent ? `${parent}/${name}` : name,
          name,
          kind: handle.kind === 'directory' ? 'folder' : 'file'
        });
        if (items.length > 20000) throw new IntegrationError('too_large');
      }
      items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const remaining = cursor ? items.filter((item) => item.id > cursor) : items;
      const page = remaining.slice(0, 200);
      return { items: page, cursor: remaining.length > 200 ? page[page.length - 1].id : '' };
    });
  }
  async read(item: LibraryEntry) {
    const selected = { ...item };
    return withLibraryOperation(this.owner, () =>
      this.withConnection(false, async (library) => {
        const path = segments(selected.id);
        const filename = path.pop();
        if (selected.kind !== 'file' || !filename || !supportedBook(filename))
          throw new IntegrationError('unsupported');
        const file = await (
          await (await this.directory(library.handle, path.join('/'))).getFileHandle(filename)
        ).getFile();
        if (file.size > maxBookBytes) throw new IntegrationError('too_large');
        return verifySelectedBook(file, selected.expectedContentHash);
      })
    );
  }
  private async stateFolder(root: FileSystemDirectoryHandle, key: string, create = false) {
    const state = await root.getDirectoryHandle(stateDirectory, { create });
    return state.getDirectoryHandle(stateKey(key), { create });
  }
  private async revisions(root: FileSystemDirectoryHandle, key: string): Promise<RevisionDocument[]> {
    let directory: FileSystemDirectoryHandle;
    try {
      directory = await this.stateFolder(root, key);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') return [];
      throw error;
    }
    const documents: RevisionDocument[] = [];
    for await (const [name, handle] of directory.entries()) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name) || handle.kind !== 'file') continue;
      if (documents.length >= maxLocalRevisions) throw new IntegrationError('too_large');
      const file = await handle.getFile();
      if (file.size > maxManagedStateBytes + 16384) throw new IntegrationError('invalid_response');
      let value: RevisionDocument;
      try {
        value = JSON.parse(await file.text());
      } catch {
        throw new IntegrationError('invalid_response');
      }
      if (
        value.version !== 1 ||
        `${value.id}.json` !== name ||
        !Array.isArray(value.parents) ||
        value.parents.length > 100 ||
        !value.parents.every((p) => typeof p === 'string' && /^[a-f0-9-]{36}$/.test(p)) ||
        typeof value.createdAt !== 'string' ||
        !Number.isFinite(Date.parse(value.createdAt)) ||
        !jsonObject(value.value)
      )
        throw new IntegrationError('invalid_response');
      boundState(value.value);
      documents.push(value);
    }
    return documents;
  }
  private async stateFor(root: FileSystemDirectoryHandle, key: string): Promise<StateCopy> {
    const documents = await this.revisions(root, key);
    const ids = new Set(documents.map((doc) => doc.id));
    const superseded = new Set(documents.flatMap((doc) => doc.parents));
    // A cloud client may deliver the newest file before its parents. Do not apply
    // an incomplete history, nor overwrite it with a new disconnected branch.
    if ([...superseded].some((id) => !ids.has(id))) throw new IntegrationError('unavailable');
    const heads = documents
      .filter((doc) => !superseded.has(doc.id))
      .sort((a, b) => a.id.localeCompare(b.id));
    if (documents.length && !heads.length) throw new IntegrationError('invalid_response');
    const revision = `"${await sha256(heads.map((doc) => doc.id).join('\n'))}"`;
    const headIds = heads.map((head) => head.id);
    if (!heads.length) return { value: null, revision, headIds };
    if (heads.every((head) => equal(head.value, heads[0].value)))
      return { value: heads[0].value, revision, headIds };
    return {
      value: null,
      revision,
      headIds,
      branches: heads.map(({ id, value, createdAt }) => ({ id, value, createdAt }))
    };
  }
  async state(key: string): Promise<StateCopy> {
    return this.withConnection(false, (library) => this.stateFor(library.handle, key));
  }
  async write(key: string, value: Record<string, unknown>, revision: string): Promise<StateCopy> {
    boundState(value);
    return this.withConnection(true, (library) =>
      exclusive(`local-state/${this.id}/${key}`, async () => {
        const current = await this.stateFor(library.handle, key);
        if (current.revision !== revision) throw new IntegrationError('conflict', 412);
        const parents = current.headIds;
        if (!parents) throw new IntegrationError('invalid_response');
        if (parents.length > 100) throw new IntegrationError('too_large');
        const document: RevisionDocument = {
          version: 1,
          id: crypto.randomUUID(),
          parents,
          createdAt: new Date().toISOString(),
          value
        };
        const directory = await this.stateFolder(library.handle, key, true);
        const file = await directory.getFileHandle(`${document.id}.json`, { create: true });
        const writer = await file.createWritable();
        try {
          await writer.write(JSON.stringify(document));
          await writer.close();
        } catch (error) {
          await writer.abort().catch(() => undefined);
          throw error;
        }
        const result = await this.stateFor(library.handle, key);
        if (result.branches) throw new IntegrationError('conflict', 412);
        return result;
      })
    );
  }
}

export async function sourceFor(
  sourceId: string,
  root: string,
  owner: string | null
): Promise<LibrarySource> {
  if (owner !== null) {
    if (currentUser()?.id !== owner) throw new IntegrationError('account_changed');
    return new CloudLibrary(sourceId, owner, root);
  }
  const library = await (await integrationDB()).get('localLibraries', sourceId);
  if (!library) throw new IntegrationError('not_found');
  return new LocalLibrarySource(library);
}
