/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { IntegrationError, currentUser, request } from './client';
import { integrationDB, exclusive, equal, type LocalLibrary } from './persistence';

export interface LibraryEntry {
  id: string;
  name: string;
  kind: 'file' | 'folder';
  size?: number;
}
export interface StateCopy {
  value: Record<string, unknown> | null;
  revision: string;
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
export const supportedBook = (name: string) => /\.(epub|txt|htmlz)$/i.test(name);
const maxBookBytes = 128 * 1024 * 1024;
const stateDirectory = '.manabi-reader';
const maxStateBytes = 65536;
const maxLocalRevisions = 5000;

export async function sha256(value: ArrayBuffer | Uint8Array | string): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
}
function stateKey(key: string) {
  if (!/^book_[a-f0-9]{64}$/.test(key)) throw new Error('Invalid managed reading-state key');
  return key;
}
function jsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function boundState(value: Record<string, unknown>) {
  const raw = JSON.stringify(value);
  if (new TextEncoder().encode(raw).length > maxStateBytes) throw new IntegrationError('too_large');
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
    if (item.kind !== 'file' || !supportedBook(item.name))
      throw new IntegrationError('unsupported');
    if (item.size !== undefined && item.size > maxBookBytes)
      throw new IntegrationError('too_large');
    const bytes = await request<ArrayBuffer>(this.path('file', { id: item.id }), {
      userId: this.owner,
      binary: true
    });
    return new File([bytes], item.name, {
      type: item.name.toLowerCase().endsWith('.epub')
        ? 'application/epub+zip'
        : 'application/octet-stream'
    });
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
export async function reconnectLocalLibrary(library: LocalLibrary, write = false) {
  const mode = write ? 'readwrite' : 'read';
  // This is an explicit button action; background sync only queries permissions.
  if ((await library.handle.requestPermission({ mode })) !== 'granted')
    throw new IntegrationError('permission_required');
  if (write) library.writable = true;
  await (await integrationDB()).put('localLibraries', library);
}
export async function removeLocalLibrary(id: string) {
  const db = await integrationDB();
  const transaction = db.transaction(['localLibraries', 'books'], 'readwrite');
  await transaction.objectStore('localLibraries').delete(id);
  for (const link of await transaction.objectStore('books').getAll()) {
    if (link.sourceId === id) await transaction.objectStore('books').delete(link.id);
  }
  await transaction.done;
  // Disconnecting never deletes a book, its original file, or its reading history.
}

function segments(path: string) {
  if (!path) return [];
  const parts = path.split('/');
  if (
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
  private async permission(write = false) {
    if (
      (write && !this.library.writable) ||
      (await this.library.handle.queryPermission({ mode: write ? 'readwrite' : 'read' })) !==
        'granted'
    ) {
      throw new IntegrationError('permission_required');
    }
  }
  private async directory(path: string) {
    let result = this.library.handle;
    for (const part of segments(path)) {
      if (part === stateDirectory) throw new IntegrationError('forbidden');
      result = await result.getDirectoryHandle(part);
    }
    return result;
  }
  async list(parent = '', cursor = '') {
    await this.permission();
    const directory = await this.directory(parent);
    const items: LibraryEntry[] = [];
    for await (const [name, handle] of directory.entries()) {
      if (name === stateDirectory || (handle.kind === 'file' && !supportedBook(name))) continue;
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
  }
  async read(item: LibraryEntry) {
    await this.permission();
    const path = segments(item.id);
    const filename = path.pop();
    if (!filename || !supportedBook(filename)) throw new IntegrationError('unsupported');
    const file = await (
      await (await this.directory(path.join('/'))).getFileHandle(filename)
    ).getFile();
    if (file.size > maxBookBytes) throw new IntegrationError('too_large');
    return file;
  }
  private async stateFolder(key: string, create = false) {
    const root = await this.library.handle.getDirectoryHandle(stateDirectory, { create });
    return root.getDirectoryHandle(stateKey(key), { create });
  }
  private async revisions(key: string): Promise<RevisionDocument[]> {
    let directory: FileSystemDirectoryHandle;
    try {
      directory = await this.stateFolder(key);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') return [];
      throw error;
    }
    const documents: RevisionDocument[] = [];
    for await (const [name, handle] of directory.entries()) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name) || handle.kind !== 'file') continue;
      if (documents.length >= maxLocalRevisions) throw new IntegrationError('too_large');
      const file = await handle.getFile();
      if (file.size > maxStateBytes + 16384) throw new IntegrationError('invalid_response');
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
      ) {
        throw new IntegrationError('invalid_response');
      }
      boundState(value.value);
      documents.push(value);
    }
    return documents;
  }
  async state(key: string): Promise<StateCopy> {
    await this.permission();
    const documents = await this.revisions(key);
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
    if (!heads.length) return { value: null, revision };
    if (heads.every((head) => equal(head.value, heads[0].value)))
      return { value: heads[0].value, revision };
    return {
      value: null,
      revision,
      branches: heads.map(({ id, value, createdAt }) => ({ id, value, createdAt }))
    };
  }
  async write(key: string, value: Record<string, unknown>, revision: string): Promise<StateCopy> {
    await this.permission(true);
    boundState(value);
    return exclusive(`local-state/${this.id}/${key}`, async () => {
      const current = await this.state(key);
      if (current.revision !== revision) throw new IntegrationError('conflict', 412);
      const documents = await this.revisions(key);
      const superseded = new Set(documents.flatMap((doc) => doc.parents));
      const parents = documents.filter((doc) => !superseded.has(doc.id)).map((doc) => doc.id);
      if (parents.length > 100) throw new IntegrationError('too_large');
      const document: RevisionDocument = {
        version: 1,
        id: crypto.randomUUID(),
        parents,
        createdAt: new Date().toISOString(),
        value
      };
      const directory = await this.stateFolder(key, true);
      const file = await directory.getFileHandle(`${document.id}.json`, { create: true });
      const writer = await file.createWritable();
      try {
        await writer.write(JSON.stringify(document));
        await writer.close();
      } catch (error) {
        await writer.abort().catch(() => undefined);
        throw error;
      }
      const result = await this.state(key);
      if (result.branches) throw new IntegrationError('conflict', 412);
      return result;
    });
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
