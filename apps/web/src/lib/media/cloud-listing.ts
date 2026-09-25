/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { SyncTransport } from './sync.js';

export interface CloudEntry {
  id: string;
  name: string;
  kind: 'file' | 'folder';
  size?: number;
}
export interface CloudConnection {
  id: string;
  provider: string;
  roots: string[];
  needs_reconnect: boolean;
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, limit: number): v is string =>
  // eslint-disable-next-line no-control-regex -- Reject control characters in untrusted text.
  typeof v === 'string' && v.length > 0 && v.length <= limit && !/[\x00-\x1f\x7f]/.test(v);

/** Match the existing /connections/ endpoint, not the TTU compatibility API. */
export function connectionsFrom(value: unknown): CloudConnection[] {
  if (!object(value) || !Array.isArray(value.items) || value.items.length > 1000)
    throw new Error('Invalid cloud connections');
  const seen = new Set<string>();
  return value.items.map((item) => {
    if (
      !object(item) ||
      !text(item.id, 36) ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(item.id) ||
      !text(item.provider, 32) ||
      !/^[a-z][a-z0-9-]*$/.test(item.provider) ||
      !Array.isArray(item.roots) ||
      item.roots.length > 16 ||
      !item.roots.every((root) => text(root, 256)) ||
      new Set(item.roots).size !== item.roots.length ||
      typeof item.needs_reconnect !== 'boolean' ||
      seen.has(item.id)
    ) {
      throw new Error('Invalid cloud connection');
    }
    seen.add(item.id);
    return {
      id: item.id,
      provider: item.provider,
      roots: [...item.roots] as string[],
      needs_reconnect: item.needs_reconnect
    };
  });
}

export function listingFrom(value: unknown): { items: CloudEntry[]; cursor: string } {
  if (
    !object(value) ||
    !Array.isArray(value.items) ||
    value.items.length > 10000 ||
    typeof value.cursor !== 'string' ||
    value.cursor.length > 12288 ||
    // eslint-disable-next-line no-control-regex -- Reject control characters in untrusted text.
    /[\x00-\x1f\x7f]/.test(value.cursor)
  )
    throw new Error('Invalid cloud listing');
  const items = value.items.map((item) => {
    if (
      !object(item) ||
      !text(item.id, 256) ||
      !text(item.name, 1024) ||
      !['file', 'folder'].includes(String(item.kind)) ||
      (item.size !== undefined && (!Number.isSafeInteger(item.size) || (item.size as number) < 0))
    )
      throw new Error('Invalid cloud entry');
    return {
      id: item.id,
      name: item.name,
      kind: item.kind as 'file' | 'folder',
      ...(item.size === undefined ? {} : { size: item.size as number })
    };
  });
  return { items, cursor: value.cursor };
}

/** Account authority is checked after every await as well as before admission. */
export async function cloudRequest<T>(
  transport: SyncTransport,
  path: string,
  signal: AbortSignal
): Promise<T> {
  const guard = () => {
    signal.throwIfAborted();
    if (!transport.isCurrent()) throw new Error('Account changed');
  };
  guard();
  const result = await transport.request<T>(path, { userId: transport.userId });
  guard();
  return result;
}

export async function listCloudFolder(
  transport: SyncTransport,
  connection: CloudConnection,
  root: string,
  parent: string,
  signal: AbortSignal
): Promise<CloudEntry[]> {
  if (!connection.roots.includes(root) || connection.needs_reconnect)
    throw new Error('Reconnect this selected folder first');
  const cursors = new Set<string>(),
    ids = new Set<string>(),
    items: CloudEntry[] = [];
  let cursor = '';
  for (let pageNumber = 0; pageNumber < 200; pageNumber++) {
    const page = listingFrom(
      await cloudRequest(
        transport,
        `connections/${encodeURIComponent(connection.id)}/media-files/?${new URLSearchParams({ root, parent, cursor })}`,
        signal
      )
    );
    for (const item of page.items) {
      if (ids.has(item.id))
        throw new Error('Cloud folder changed while listing. Reopen it to retry.');
      ids.add(item.id);
      items.push(item);
      if (items.length > 10000) throw new Error('Folder exceeds 10,000 visible entries');
    }
    if (!page.cursor) return items;
    if (cursors.has(page.cursor)) throw new Error('Cloud listing repeated a cursor');
    cursors.add(page.cursor);
    cursor = page.cursor;
  }
  throw new Error('Cloud listing exceeds the page limit');
}
