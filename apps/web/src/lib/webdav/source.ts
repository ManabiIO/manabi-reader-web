/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { integrationDB, exclusive, equal, type BookLink } from '$lib/manabi/persistence';
import type { LibrarySource, LibraryEntry, StateCopy } from '$lib/manabi/sources';
import { WebDavClient, davRoot, davChild, DavError, strongEtag, decodeDavText } from './client';

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
/** Order connection/consent changes with the whole sync, including its final
 * books-DB commit. Checking the integration DB alone cannot fence another DB's
 * subsequent transaction. Completion of a disconnect now means no sync remains. */
export function withDavSourceLock<T>(
  id: string,
  work: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  return exclusive(`webdav-source:${id}`, work, signal);
}
export async function davSources(): Promise<DavConfiguration[]> {
  const db = await integrationDB();
  return (await db.getAll(
    'metadata',
    IDBKeyRange.bound(prefix, prefix + '\uffff')
  )) as DavConfiguration[];
}
export async function configureDav(
  config: DavConfiguration,
  password: string,
  options: { remember: boolean; expected: DavConfiguration | null; signal?: AbortSignal }
) {
  const { remember, expected, signal } = options;
  signal?.throwIfAborted();
  if (!/^webdav-[0-9a-f-]{36}$/.test(config.id)) throw new Error('Invalid WebDAV source ID.');
  const value = {
    ...config,
    url: davRoot(config.url).href,
    password: remember ? password : undefined
  };
  if (!config.name.trim() || config.name.length > 240)
    throw new Error('Enter a source name of 1–240 characters.');
  new WebDavClient(value.url, value.username, password);
  await withDavSourceLock(
    config.id,
    async () => {
      signal?.throwIfAborted();
      const db = await integrationDB();
      signal?.throwIfAborted();
      const tx = db.transaction(['metadata', 'books'], 'readwrite');
      const cancel = () => {
        try {
          tx.abort();
        } catch {
          /* Already settled. */
        }
      };
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        const previous = (await tx.objectStore('metadata').get(prefix + config.id)) as
          | DavConfiguration
          | undefined;
        // Compare the editor's original snapshot, not a fresh read taken after its
        // network test. A stale editor must not recreate or reauthorize a source.
        if (!equal(previous ?? null, expected))
          throw new DavError(
            'conflict',
            'This WebDAV connection changed or was disconnected. Reload WebDAV connections before saving again.'
          );
        if (previous && (previous.url !== value.url || previous.username !== value.username))
          throw new DavError(
            'reconnect',
            'Add a new WebDAV connection to change the folder or username. Existing books and sync settings were kept.'
          );
        await tx.objectStore('metadata').put(value, prefix + config.id);
        if (!value.writable) {
          for (const link of await tx.objectStore('books').getAll())
            if (link.sourceId === config.id && link.syncEnabled)
              await tx.objectStore('books').put({ ...link, syncEnabled: false });
        }
        signal?.throwIfAborted();
        await tx.done;
      } catch (error) {
        try {
          tx.abort();
        } catch {
          /* Already settled. */
        }
        await tx.done.catch(() => undefined);
        throw error;
      } finally {
        signal?.removeEventListener('abort', cancel);
      }
      // Publish memory-only credentials only after the configuration committed.
      lifetimes.get(config.id)?.abort();
      lifetimes.delete(config.id);
      sessions.set(config.id, password);
    },
    signal
  );
}
export async function disconnectDav(id: string) {
  lifetimes.get(id)?.abort();
  lifetimes.delete(id);
  sessions.delete(id);
  await withDavSourceLock(id, async () => {
    const db = await integrationDB();
    const tx = db.transaction(['metadata', 'books'], 'readwrite');
    try {
      await tx.objectStore('metadata').delete(prefix + id);
      // Other metadata and imported books are not erased by disconnecting a source.
      for (const link of await tx.objectStore('books').getAll())
        if (link.sourceId === id) await tx.objectStore('books').delete(link.id);
      await tx.done;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* Already settled. */
      }
      await tx.done.catch(() => undefined);
      throw error;
    }
    // A preceding queued configuration may have installed new session state
    // while this disconnect waited. Clear it under the same source lock too.
    lifetimes.get(id)?.abort();
    lifetimes.delete(id);
    sessions.delete(id);
  });
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
  /** Explicit file selection authorizes only creation; existing files are never replaced. */
  async uploadNew(file: File, parent = this.root) {
    if (
      !/\.(epub|txt|htmlz|zip)$/i.test(file.name) ||
      /[\\/]/.test(file.name) ||
      file.name.startsWith('.') ||
      file.name.length > 240
    )
      throw new DavError('file', 'Select an EPUB, TXT, HTMLZ or ZIP backup with a plain filename.');
    if (file.size > 128 * 1024 * 1024)
      throw new DavError('size', 'WebDAV uploads are limited to 128 MiB.');
    const folder = davChild(new URL(this.root), parent);
    if (!folder.pathname.endsWith('/')) throw new DavError('path', 'Select a WebDAV folder.');
    const target = davChild(
      new URL(this.root),
      new URL(encodeURIComponent(file.name), folder).href
    );
    await withDavSourceLock(this.id, async () => {
      const client = await this.client();
      await client.put(target.href, file, 'missing');
      const confirmed = await client.get(target.href, 128 * 1024 * 1024);
      const original = new Uint8Array(await file.arrayBuffer());
      if (
        confirmed.status !== 200 ||
        confirmed.bytes.length !== original.length ||
        !confirmed.bytes.every((value, index) => value === original[index])
      )
        throw new DavError(
          'conflict',
          'The uploaded file could not be verified. Refresh the folder before retrying.'
        );
    });
  }
  async downloadBackup(item: LibraryEntry) {
    if (!/\.zip$/i.test(item.name)) throw new DavError('file', 'Select a ZIP backup.');
    return this.download(item);
  }
  async read(item: LibraryEntry) {
    if (!/\.(epub|txt|htmlz)$/i.test(item.name)) throw new Error('Unsupported WebDAV book.');
    return this.download(item);
  }
  private async download(item: LibraryEntry) {
    if (item.kind !== 'file' || !/\.(epub|txt|htmlz|zip)$/i.test(item.name))
      throw new Error('Unsupported WebDAV book.');
    if ((item.size ?? 0) > 128 * 1024 * 1024) throw new Error('WebDAV book exceeds 128 MiB.');
    const result = await (
      await this.client()
    ).get(item.id, 128 * 1024 * 1024, (item as { etag?: string }).etag);
    if (result.status === 404) throw new Error('This WebDAV book no longer exists.');
    // A TXT prefix is a perfectly parseable file. Do not import a short HTTP 200
    // response as a whole book when the listing supplied the selected size.
    if (item.size !== undefined && result.bytes.byteLength !== item.size)
      throw new DavError(
        'size',
        'The WebDAV book download does not match the selected file size. Refresh the folder and try again.'
      );
    const selectedEtag = (item as { etag?: string }).etag;
    if (strongEtag(selectedEtag) && result.etag && result.etag !== selectedEtag)
      throw new DavError(
        'conflict',
        'The WebDAV book changed during download. Refresh the folder and try again.'
      );
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
    const value: unknown = JSON.parse(decodeDavText(response.bytes, 'WebDAV reading data'));
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
