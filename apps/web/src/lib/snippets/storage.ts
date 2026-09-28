/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { currentUser, IntegrationError, request } from '../manabi/client';
import { integrationDB, exclusive } from '../manabi/persistence';
import { librarySource, type SourceDescriptor } from '../library/catalog';
import { openDirectory, safePath } from '../library/file-operations';
import { sha256, type LibraryEntry } from '../manabi/sources';
import { davSource, withDavSourceLock } from '../webdav/source';
import { davChild, davRoot, strongEtag, decodeDavText } from '../webdav/client';
import type { Destination, Guard, Location } from './database';
import {
  canonical,
  encodeSnippet,
  filename,
  isSnippetFile,
  MAX_SNIPPET_BYTES,
  parseSnippet,
  SnippetError,
  type SnippetDocument
} from './document';

export interface StorageCapability {
  write: boolean;
  allocate?: boolean;
  reason?: string;
}
interface DocumentReply {
  document: unknown;
  location: { fileId: string; name: string; parent: string; token: string };
}
const nothing = () => undefined;
export const sameSource = (a: SourceDescriptor, b: SourceDescriptor) =>
  a.owner === b.owner && a.id === b.id && a.root === b.root && a.provider === b.provider;
function sourceGuard(source: SourceDescriptor, guard: Guard) {
  guard();
  if (source.owner !== null && source.owner !== currentUser()?.id)
    throw new IntegrationError('account_changed', 409);
}
function path(source: SourceDescriptor, action: string, values: Record<string, string> = {}) {
  if (!source.owner || !/^[0-9a-f-]{36}$/i.test(source.id))
    throw new Error('Invalid cloud source.');
  return `connections/${source.id}/documents/?${new URLSearchParams({ root: source.root, action, ...values })}`;
}
async function cloud<T>(
  source: SourceDescriptor,
  action: string,
  guard: Guard,
  value?: unknown,
  values: Record<string, string> = {}
): Promise<T> {
  sourceGuard(source, guard);
  const result = await request<T>(path(source, action, values), {
    userId: source.owner!,
    ...(value === undefined ? {} : { method: 'POST', value })
  });
  sourceGuard(source, guard);
  return result;
}
function text(value: unknown, maximum = 4096): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximum &&
    // eslint-disable-next-line no-control-regex -- Reject protocol control characters.
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}
function reply(value: DocumentReply, source: SourceDescriptor, expected?: string) {
  if (
    !value ||
    typeof value !== 'object' ||
    !value.location ||
    !text(value.location.fileId) ||
    (expected && value.location.fileId !== expected) ||
    !text(value.location.name, 1024) ||
    !isSnippetFile(value.location.name) ||
    typeof value.location.parent !== 'string' ||
    !text(value.location.token)
  )
    throw new IntegrationError('invalid_response');
  const document = parseSnippet(canonical(value.document));
  return { document, location: { ...value.location, source } as Location };
}
async function local(source: SourceDescriptor, guard: Guard, write = false) {
  sourceGuard(source, guard);
  if (source.provider !== 'local' || source.owner !== null || source.root !== '')
    throw new Error('Invalid local folder source.');
  const item = await (await integrationDB()).get('localLibraries', source.id);
  guard();
  if (!item) throw new Error('This folder is no longer connected.');
  if (
    (write && !item.writable) ||
    (await item.handle.queryPermission({ mode: write ? 'readwrite' : 'read' })) !== 'granted'
  )
    throw new IntegrationError('permission_required');
  guard();
  return item;
}
function childName(name: string, folder = false) {
  // Keep all providers within one portable filename contract.

  if (
    !name ||
    name !== name.trim() ||
    name.startsWith('.') ||
    name.endsWith('.') ||
    // eslint-disable-next-line no-control-regex -- Portable filenames must exclude control characters.
    /[\\/:*?"<>|\u0000-\u001f\u007f]/.test(name) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ||
    new TextEncoder().encode(name).length > 240 ||
    (!folder && !isSnippetFile(name))
  )
    throw new Error('Choose a valid portable filename.');
  return name;
}
const join = (parent: string, name: string) => [...safePath(parent), name].join('/');
function parts(fileId: string) {
  const items = safePath(fileId);
  const name = items.pop();
  if (!name || !isSnippetFile(name)) throw new Error('Not a snippet document.');
  return { parent: items.join('/'), name };
}
async function optionalFile(directory: FileSystemDirectoryHandle, name: string) {
  try {
    return await directory.getFileHandle(name);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return undefined;
    throw error;
  }
}
async function localRead(source: SourceDescriptor, fileId: string, guard: Guard) {
  const origin = await local(source, guard),
    { parent, name } = parts(fileId);
  const handle = await (await openDirectory(origin.handle, parent)).getFileHandle(name),
    file = await handle.getFile();
  guard();
  if (file.size > MAX_SNIPPET_BYTES) throw new IntegrationError('too_large');
  const bytes = new Uint8Array(await file.arrayBuffer());
  guard();
  const document = parseSnippet(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const token = await sha256(bytes);
  guard();
  return { document, location: { source, fileId, parent, name, token } as Location };
}
async function davRead(source: SourceDescriptor, fileId: string, guard: Guard) {
  const adapter = await davSource(source.id);
  guard();
  if (adapter.root !== source.root) throw new Error('The WebDAV root changed.');
  const url = davChild(davRoot(source.root), fileId),
    name = decodeURIComponent(url.pathname.split('/').at(-1) ?? '');
  childName(name);
  const result = await (await adapter.documentClient()).get(url.href, MAX_SNIPPET_BYTES);
  guard();
  if (result.status === 404) throw new IntegrationError('not_found', 404);
  if (!strongEtag(result.etag))
    throw new Error('Expose a strong ETag header before using editable WebDAV snippets.');
  return {
    document: parseSnippet(decodeDavText(result.bytes, 'Snippet')),
    location: {
      source,
      fileId: url.href,
      parent: new URL('.', url).href,
      name,
      token: result.etag
    } as Location
  };
}
export async function capability(
  source: SourceDescriptor,
  guard: Guard = nothing
): Promise<StorageCapability> {
  sourceGuard(source, guard);
  if (source.owner !== null) {
    const result = await cloud<StorageCapability>(source, 'capabilities', guard);
    if (!result || typeof result.write !== 'boolean')
      throw new IntegrationError('invalid_response');
    return result;
  }
  if (source.provider === 'webdav') {
    const adapter = await davSource(source.id);
    guard();
    return {
      write: adapter.configuration.writable,
      reason: adapter.configuration.writable
        ? ''
        : 'Enable write-back in WebDAV connection settings to save snippet documents here.'
    };
  }
  const entry = await local(source, guard);
  return {
    write:
      entry.writable && (await entry.handle.queryPermission({ mode: 'readwrite' })) === 'granted'
  };
}
export async function folders(source: SourceDescriptor, parent: string, guard: Guard) {
  sourceGuard(source, guard);
  const adapter = await librarySource(source),
    found: { id: string; name: string }[] = [],
    seen = new Set<string>(),
    cursors = new Set<string>();
  let cursor = '';
  do {
    guard();
    if (cursors.has(cursor) || cursors.size >= 1000) throw new Error('Invalid folder pagination.');
    cursors.add(cursor);
    const page = await adapter.list(parent, cursor);
    sourceGuard(source, guard);
    for (const item of page.items)
      if (item.kind === 'folder' && item.name !== '.manabi-reader') {
        if (!text(item.id) || !text(item.name) || seen.has(item.id) || item.id === parent)
          throw new Error('Invalid folder listing.');
        seen.add(item.id);
        found.push(item);
        if (found.length > 10000) throw new Error('Too many folders.');
      }
    cursor = page.cursor;
  } while (cursor);
  return found.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}
/** Allocation precedes the durable outbox write. Its returned ID must be persisted before any upload. */
export async function prepareDestination(
  destination: Destination,
  document: SnippetDocument,
  guard: Guard
): Promise<Destination> {
  sourceGuard(destination.source, guard);
  const next = { ...destination, name: destination.name ?? filename(document) };
  childName(next.name);
  if (next.source.provider === 'google' && !next.createId) {
    const result = await cloud<{ id: string }>(next.source, 'allocate', guard);
    if (!text(result.id, 256)) throw new IntegrationError('invalid_response');
    next.createId = result.id;
  }
  return next;
}
export async function makeFolder(
  destination: Destination,
  name: string,
  guard: Guard
): Promise<string> {
  childName(name, true);
  const { source, parent } = destination;
  sourceGuard(source, guard);
  if (source.owner !== null) {
    const created =
      source.provider === 'google'
        ? await cloud<{ id: string }>(source, 'allocate', guard)
        : undefined;
    const value = await cloud<{ id: string; kind: string; name: string }>(source, 'mkdir', guard, {
      parent,
      name,
      ...(created ? { createId: created.id } : {})
    });
    if (!text(value.id) || value.kind !== 'folder' || value.name !== name)
      throw new IntegrationError('invalid_response');
    return value.id;
  }
  if (source.provider === 'webdav')
    return withDavSourceLock(source.id, async () => {
      const adapter = await davSource(source.id);
      guard();
      const id = davChild(
        davRoot(source.root),
        new URL(encodeURIComponent(name) + '/', parent.endsWith('/') ? parent : parent + '/').href
      ).href;
      await (await adapter.documentClient(true)).mkdir(id);
      guard();
      return id;
    });
  const entry = await local(source, guard, true),
    directory = await openDirectory(entry.handle, parent);
  guard();
  await directory.getDirectoryHandle(name, { create: true });
  guard();
  return join(parent, name);
}
export async function readDocument(
  source: SourceDescriptor,
  item: string | LibraryEntry,
  guard: Guard
) {
  sourceGuard(source, guard);
  const id = typeof item === 'string' ? item : item.id;
  if (
    typeof item !== 'string' &&
    (item.kind !== 'file' || !isSnippetFile(item.name) || (item.size ?? 0) > MAX_SNIPPET_BYTES)
  )
    throw new IntegrationError('unsupported');
  if (source.owner !== null)
    return reply(await cloud<DocumentReply>(source, 'read', guard, undefined, { id }), source, id);
  return source.provider === 'webdav' ? davRead(source, id, guard) : localRead(source, id, guard);
}
function permitUpdate(
  before: SnippetDocument,
  value: SnippetDocument,
  expected: Location | undefined,
  actual: Location
) {
  if (canonical(before) === canonical(value)) return false;
  if (
    !expected ||
    actual.fileId !== expected.fileId ||
    actual.token !== expected.token ||
    actual.parent !== expected.parent ||
    before.id !== value.id ||
    !value.parents.includes(before.revision)
  )
    throw new SnippetError(
      'conflict',
      'The stored document changed. Both versions have been kept.'
    );
  return true;
}
export async function writeDocument(
  destination: Destination,
  document: SnippetDocument,
  expected: Location | undefined,
  guard: Guard
): Promise<Location> {
  const { source, parent } = destination,
    name = childName(destination.name ?? filename(document));
  const raw = encodeSnippet(document);
  sourceGuard(source, guard);
  if (expected && (!sameSource(source, expected.source) || expected.parent !== parent))
    throw new Error('An update cannot switch storage locations.');
  if (source.owner !== null) {
    const result = reply(
      await cloud<DocumentReply>(source, 'write', guard, {
        parent,
        name,
        document,
        ...(expected ? { id: expected.fileId, expected: expected.token } : {}),
        ...(destination.createId ? { createId: destination.createId } : {})
      }),
      source,
      expected?.fileId
    );
    if (canonical(result.document) !== canonical(document) || result.location.parent !== parent)
      throw new IntegrationError('invalid_response');
    return result.location;
  }
  if (source.provider === 'webdav')
    return withDavSourceLock(source.id, async () => {
      const adapter = await davSource(source.id);
      guard();
      const id =
        expected?.fileId ??
        davChild(
          davRoot(source.root),
          new URL(encodeURIComponent(name), parent.endsWith('/') ? parent : parent + '/').href
        ).href;
      let before: Awaited<ReturnType<typeof davRead>> | undefined;
      try {
        before = await davRead(source, id, guard);
      } catch (error) {
        if (!(error instanceof IntegrationError && error.code === 'not_found')) throw error;
      }
      if (before && !permitUpdate(before.document, document, expected, before.location))
        return before.location;
      if (!before && expected) throw new IntegrationError('not_found', 404);
      await (await adapter.documentClient(true)).put(id, raw, expected?.token ?? 'missing');
      guard();
      const confirmed = await davRead(source, id, guard);
      if (canonical(confirmed.document) !== canonical(document))
        throw new IntegrationError('conflict');
      return confirmed.location;
    });
  return exclusive(`snippet-file:${source.id}:${join(parent, name)}`, async () => {
    const entry = await local(source, guard, true),
      directory = await openDirectory(entry.handle, parent);
    let handle = await optionalFile(directory, name);
    guard();
    let before: Awaited<ReturnType<typeof localRead>> | undefined;
    const id = join(parent, name);
    if (handle) {
      before = await localRead(source, id, guard);
      if (!permitUpdate(before.document, document, expected, before.location))
        return before.location;
    } else if (expected) throw new IntegrationError('not_found', 404);
    handle ??= await directory.getFileHandle(name, { create: true });
    guard();
    const stream = await handle.createWritable();
    try {
      await stream.write(raw);
      guard();
      // A browser cannot exclude external editors. Recheck immediately before committing.
      const latest = await handle.getFile();
      guard();
      if (
        before
          ? (await sha256(await latest.arrayBuffer())) !== before.location.token
          : latest.size !== 0
      )
        throw new IntegrationError('conflict');
      await local(source, guard, true);
      await stream.close();
    } catch (error) {
      await stream.abort().catch(() => undefined);
      throw error;
    }
    const confirmed = await localRead(source, id, guard);
    if (canonical(confirmed.document) !== canonical(document))
      throw new IntegrationError('conflict');
    return confirmed.location;
  });
}
/** Only cloud providers expose a qualified native move here; other sources use the transfer journal. */
export async function moveWithinSource(
  from: Location,
  destination: Destination,
  document: SnippetDocument,
  guard: Guard
): Promise<Location | undefined> {
  if (!sameSource(from.source, destination.source)) return;
  if (from.parent === destination.parent)
    return (await readDocument(from.source, from.fileId, guard)).location;
  if (from.source.owner === null) return;
  const result = reply(
    await cloud<DocumentReply>(from.source, 'move', guard, {
      id: from.fileId,
      parent: destination.parent,
      expected: from.token,
      revision: document.revision
    }),
    from.source,
    from.fileId
  );
  if (
    canonical(result.document) !== canonical(document) ||
    result.location.parent !== destination.parent
  )
    throw new IntegrationError('conflict');
  return result.location;
}
export async function removeDocument(location: Location, document: SnippetDocument, guard: Guard) {
  const { source, fileId, token } = location;
  sourceGuard(source, guard);
  if (source.owner !== null) {
    const value = await cloud<{ removed: boolean }>(source, 'remove', guard, {
      id: fileId,
      expected: token,
      revision: document.revision
    });
    if (value.removed !== true) throw new IntegrationError('invalid_response');
    return;
  }
  const remove = async () => {
    const current = await readDocument(source, fileId, guard);
    if (current.location.token !== token || canonical(current.document) !== canonical(document))
      throw new IntegrationError('conflict');
    if (source.provider === 'webdav') {
      const adapter = await davSource(source.id);
      guard();
      await (await adapter.documentClient(true)).remove(fileId, token);
      guard();
    } else {
      const entry = await local(source, guard, true),
        { parent, name } = parts(fileId),
        directory = await openDirectory(entry.handle, parent);
      const again = await localRead(source, fileId, guard);
      if (again.location.token !== token) throw new IntegrationError('conflict');
      await directory.removeEntry(name);
      guard();
    }
  };
  return source.provider === 'webdav'
    ? withDavSourceLock(source.id, remove)
    : exclusive(`snippet-file:${source.id}:${fileId}`, remove);
}
