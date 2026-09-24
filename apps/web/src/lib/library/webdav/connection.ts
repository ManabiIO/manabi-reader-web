/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { integrationDB } from '../../manabi/persistence';
import { WebDAVClient, WebDAVError, normalizeWebDAVRoot } from './client';
import type { LibraryEntry, LibrarySource, StateCopy } from '../../manabi/sources';
export interface WebDAVConnection {
  version: 1;
  id: string;
  name: string;
  url: string;
  username: string;
  writable: boolean;
}
const prefix = 'webdav:v1:';
const sessions = new Map<string, { connection: WebDAVConnection; client: WebDAVClient }>();
const key = (id: string) => prefix + id;
function validated(value: unknown): WebDAVConnection {
  const c = value as WebDAVConnection;
  if (
    !c ||
    c.version !== 1 ||
    !/^webdav-[\da-f-]{36}$/.test(c.id) ||
    typeof c.name !== 'string' ||
    c.name.length > 240 ||
    !c.name.trim() ||
    typeof c.username !== 'string' ||
    c.username.length > 512 ||
    typeof c.writable !== 'boolean' ||
    normalizeWebDAVRoot(c.url) !== c.url
  )
    throw new WebDAVError('The saved WebDAV configuration is invalid.');
  return c;
}
export async function webdavConnections(): Promise<WebDAVConnection[]> {
  const db = await integrationDB();
  const values = await db.getAll('metadata', IDBKeyRange.bound(prefix, prefix + '\uffff'), 101);
  if (values.length > 100) throw new WebDAVError('At most 100 WebDAV connections are supported.');
  return values.map(validated);
}
export function webdavUnlocked(id: string) {
  return sessions.has(id);
}
export function lockWebDAV(id: string) {
  sessions.get(id)?.client.close();
  sessions.delete(id);
}
export async function connectWebDAV(
  input: Omit<WebDAVConnection, 'version' | 'id'>,
  password: string,
  existingId?: string,
  signal?: AbortSignal
) {
  const connection = validated({
    ...input,
    name: input.name.trim(),
    url: normalizeWebDAVRoot(input.url),
    version: 1,
    id: existingId ?? `webdav-${crypto.randomUUID()}`
  });
  const client = new WebDAVClient(connection.url, connection.username, password);
  const abort = () => client.close();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    signal?.throwIfAborted();
    await client.list(); // Validate access without uploading a probe file or creating a folder.
    signal?.throwIfAborted();
    const db = await integrationDB();
    if (!existingId && (await webdavConnections()).length >= 100)
      throw new WebDAVError('At most 100 WebDAV connections are supported.');
    await db.put('metadata', connection, key(connection.id));
    lockWebDAV(connection.id);
    sessions.set(connection.id, { connection, client });
    return connection;
  } catch (error) {
    client.close();
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}
export async function disconnectWebDAV(id: string) {
  lockWebDAV(id);
  // Keep downloaded books and their links/history. Only the connection is removed.
  await (await integrationDB()).delete('metadata', key(id));
}
export class WebDAVSource implements LibrarySource {
  readonly owner = null;
  readonly root: string;
  readonly id: string;
  private listing?: { parent: string; entries: LibraryEntry[] };
  constructor(public readonly connection: WebDAVConnection) {
    this.id = connection.id;
    this.root = connection.url;
  }
  private async session(write = false) {
    const session = sessions.get(this.id);
    const stored = await (await integrationDB()).get('metadata', key(this.id));
    if (
      !session ||
      JSON.stringify(stored) !== JSON.stringify(this.connection) ||
      session.connection.url !== this.connection.url
    )
      throw new WebDAVError(
        'Unlock this WebDAV connection in Accounts and libraries. Passwords are kept only in this tab.'
      );
    if (write && !this.connection.writable)
      throw new WebDAVError('Enable uploads for this connection first.');
    return session;
  }
  private async run<T>(work: (client: WebDAVClient) => Promise<T>, write = false) {
    const active = await this.session(write);
    const result = await work(active.client);
    if ((await this.session(write)) !== active)
      throw new WebDAVError('The WebDAV connection changed during the operation.');
    return result;
  }
  async list(parent = this.root, cursor = '') {
    await this.session();
    if (!cursor)
      this.listing = {
        parent,
        entries: (await this.run((client) => client.list(parent))).filter(
          (entry) => entry.name !== '.manabi-reader'
        )
      };
    if (!this.listing || this.listing.parent !== parent || (cursor && !/^\d+$/.test(cursor)))
      throw new WebDAVError('The folder listing expired. Refresh it.');
    const offset = cursor ? Number(cursor) : 0;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > this.listing.entries.length)
      throw new WebDAVError('Invalid WebDAV listing cursor.');
    return {
      items: this.listing.entries.slice(offset, offset + 200),
      cursor: offset + 200 < this.listing.entries.length ? String(offset + 200) : ''
    };
  }
  async read(item: LibraryEntry) {
    if (!/\.(epub|txt|htmlz)$/i.test(item.name))
      throw new WebDAVError('This is not a supported ebook.');
    return this.run((client) => client.read(item));
  }
  async upload(file: File, parent = this.root) {
    await this.run((client) => client.upload(file, parent), true);
    this.listing = undefined;
  }
  async downloadBackup(item: LibraryEntry) {
    if (!/\.zip$/i.test(item.name)) throw new WebDAVError('Choose a backup ZIP.');
    return this.run((client) => client.read(item));
  }
  async state(_key: string): Promise<StateCopy> {
    throw new WebDAVError(
      'Personal reading data stays in IndexedDB, with optional Manabi sync. WebDAV is a file source, not its authority.'
    );
  }
  async write(
    _key: string,
    _value: Record<string, unknown>,
    _revision: string
  ): Promise<StateCopy> {
    throw new WebDAVError(
      'Use an explicit backup export. Reading data is not automatically written into WebDAV book folders.'
    );
  }
}
export async function webdavSource(id: string) {
  const value = await (await integrationDB()).get('metadata', key(id));
  if (!value) throw new WebDAVError('This WebDAV library is no longer connected.');
  return new WebDAVSource(validated(value));
}
