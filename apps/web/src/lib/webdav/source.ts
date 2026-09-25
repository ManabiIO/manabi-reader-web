/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { integrationDB, equal, type BookLink } from '$lib/manabi/persistence';
import type { LibrarySource, LibraryEntry, StateCopy } from '$lib/manabi/sources';
import { WebDavClient, davRoot, DavError, strongEtag } from './client';

export interface DavConfiguration {
  id: string;
  name: string;
  url: string;
  username: string;
  password?: string;
  writable: boolean;
}
const prefix = 'webdav-source:';
const sessions = new Map<string, string>();
const lifetimes = new Map<string, AbortController>();
export async function davSources(): Promise<DavConfiguration[]> {
  const db = await integrationDB();
  const keys = (await db.getAllKeys('metadata')).filter((key) => key.startsWith(prefix));
  const values = await Promise.all(keys.map((key) => db.get('metadata', key)));
  return values as DavConfiguration[];
}
export async function configureDav(config: DavConfiguration, password: string, remember = false) {
  if (!/^webdav-[0-9a-f-]{36}$/.test(config.id)) throw new Error('Invalid WebDAV source ID.');
  const value = {
    ...config,
    url: davRoot(config.url).href,
    password: remember ? password : undefined
  };
  if (!config.name.trim() || config.name.length > 240)
    throw new Error('Enter a source name of 1–240 characters.');
  new WebDavClient(value.url, value.username, password);
  lifetimes.get(config.id)?.abort();
  lifetimes.delete(config.id);
  await (await integrationDB()).put('metadata', value, prefix + config.id);
  sessions.set(config.id, password);
}
export async function disconnectDav(id: string) {
  lifetimes.get(id)?.abort();
  lifetimes.delete(id);
  sessions.delete(id);
  const db = await integrationDB();
  const tx = db.transaction(['metadata', 'books'], 'readwrite');
  await tx.objectStore('metadata').delete(prefix + id);
  // Other metadata and imported books are not erased by disconnecting a source.
  for (const link of await tx.objectStore('books').getAll())
    if (link.sourceId === id) await tx.objectStore('books').delete(link.id);
  await tx.done;
}
export class WebDavSource implements LibrarySource {
  readonly owner = null;
  readonly root: string;
  readonly id: string;
  constructor(readonly configuration: DavConfiguration) {
    this.root = davRoot(configuration.url).href;
    this.id = configuration.id;
  }
  private async client(write = false) {
    const latest = (await (await integrationDB()).get('metadata', prefix + this.id)) as
      | DavConfiguration
      | undefined;
    if (!latest || JSON.stringify(latest) !== JSON.stringify(this.configuration))
      throw new DavError(
        'reconnect',
        'This WebDAV connection changed. Reopen it before continuing.'
      );
    if (write && !latest.writable)
      throw new DavError(
        'permission',
        'Enable reading-data write-back for this WebDAV source first.'
      );
    const password = sessions.get(this.id) ?? latest.password;
    if (latest.username && password === undefined)
      throw new DavError('locked', 'Unlock this WebDAV source in Accounts and libraries.');
    let lifetime = lifetimes.get(this.id);
    if (!lifetime) {
      lifetime = new AbortController();
      lifetimes.set(this.id, lifetime);
    }
    return new WebDavClient(latest.url, latest.username, password ?? '', lifetime.signal);
  }
  async list(parent = this.root, cursor = '') {
    if (cursor) throw new Error('WebDAV pagination is not supported.');
    return { items: await (await this.client()).list(parent), cursor: '' };
  }
  async read(item: LibraryEntry) {
    if (item.kind !== 'file' || !/\.(epub|txt|htmlz)$/i.test(item.name))
      throw new Error('Unsupported WebDAV book.');
    if ((item.size ?? 0) > 128 * 1024 * 1024) throw new Error('WebDAV book exceeds 128 MiB.');
    const result = await (
      await this.client()
    ).get(item.id, 128 * 1024 * 1024, (item as { etag?: string }).etag);
    if (result.status === 404) throw new Error('This WebDAV book no longer exists.');
    return new File([new Uint8Array(result.bytes).buffer], item.name, {
      type: item.name.endsWith('.epub') ? 'application/epub+zip' : 'application/octet-stream'
    });
  }
  /** Publish a source link only while the same connection still exists. The
   * metadata read and link write share a transaction with disconnectDav, so a
   * late download or parse cannot resurrect a removed/changed connection. */
  async persistLink(link: BookLink): Promise<BookLink> {
    if (link.sourceId !== this.id || link.root !== this.root || link.owner !== null)
      throw new DavError('reconnect', 'This book belongs to a different WebDAV connection.');
    const db = await integrationDB();
    const tx = db.transaction(['metadata', 'books'], 'readwrite');
    try {
      const latest = await tx.objectStore('metadata').get(prefix + this.id);
      if (!equal(latest, this.configuration))
        throw new DavError(
          'reconnect',
          'This WebDAV connection changed during import. The book was kept locally, but not reconnected.'
        );
      // Do not replace a concurrent per-book sync choice with the import default.
      const existing = await tx.objectStore('books').get(link.id);
      if (
        existing &&
        (existing.bookId !== link.bookId || existing.contentHash !== link.contentHash)
      )
        throw new DavError(
          'conflict',
          'The WebDAV book link changed during import. Refresh before retrying.'
        );
      if (!existing) await tx.objectStore('books').put(link);
      await tx.done;
      return existing ?? link;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* Already committed or aborted. */
      }
      await tx.done.catch(() => undefined);
      throw error;
    }
  }
  private statePath(key: string) {
    if (!/^book_[a-f0-9]{64}$/.test(key)) throw new Error('Invalid WebDAV reading-data identity.');
    return new URL(`.manabi-reader/${key}.json`, this.root).href;
  }
  async state(key: string): Promise<StateCopy> {
    const response = await (await this.client()).get(this.statePath(key), 4 * 1024 * 1024);
    if (response.status === 404) return { value: null, revision: 'missing' };
    if (!strongEtag(response.etag))
      throw new DavError(
        'etag',
        'Expose a strong ETag response header in the WebDAV server’s CORS configuration.'
      );
    const value: unknown = JSON.parse(new TextDecoder().decode(response.bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Invalid WebDAV reading data.');
    return { value: value as Record<string, unknown>, revision: response.etag };
  }
  async write(key: string, value: Record<string, unknown>, revision: string): Promise<StateCopy> {
    const data = JSON.stringify(value);
    if (new TextEncoder().encode(data).length > 4 * 1024 * 1024)
      throw new Error('WebDAV reading data exceeds 4 MiB.');
    const client = await this.client(true);
    await client.mkdir(new URL('.manabi-reader/', this.root).href);
    await client.put(this.statePath(key), data, revision);
    const confirmed = await this.state(key);
    if (!equal(confirmed.value, value))
      throw new DavError(
        'conflict',
        'The WebDAV write could not be verified. Refresh before retrying.'
      );
    return confirmed;
  }
}
export async function davSource(id: string) {
  const config = (await (await integrationDB()).get('metadata', prefix + id)) as
    | DavConfiguration
    | undefined;
  if (!config) throw new Error('This WebDAV source is disconnected.');
  return new WebDavSource(config);
}
