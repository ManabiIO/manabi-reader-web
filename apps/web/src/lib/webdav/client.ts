/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export interface DavEntry {
  id: string;
  name: string;
  kind: 'file' | 'folder';
  size?: number;
  etag?: string;
}
export class DavError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'DavError';
  }
}
export const strongEtag = (value: string | null | undefined): value is string =>
  // RFC 9110 section 8.8.3: opaque tag octets, not arbitrary quoted text.
  !!value && /^"[\x21\x23-\x7e\x80-\xff]*"$/.test(value);
function segments(path: string): string[] {
  const parts = path.split('/').filter(Boolean);
  for (const part of parts) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(part);
    } catch {
      throw new DavError('path', 'Invalid WebDAV path.');
    }
    if (
      decoded === '.' ||
      decoded === '..' ||
      /[\\/]/.test(decoded) ||
      [...decoded].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
      /%(?:2e|2f|5c|00)/i.test(decoded)
    )
      throw new DavError('path', 'Unsafe WebDAV path.');
  }
  return parts;
}
export function davRoot(value: string): URL {
  // Check dot segments BEFORE URL normalizes them away.
  if (/\\|(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)/i.test(value))
    throw new DavError('path', 'Use the exact WebDAV folder URL.');
  let root: URL;
  try {
    root = new URL(value);
  } catch {
    throw new DavError('url', 'Enter a complete HTTPS WebDAV folder URL.');
  }
  if (
    root.username ||
    root.password ||
    root.search ||
    root.hash ||
    !(
      root.protocol === 'https:' ||
      (root.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(root.hostname))
    )
  )
    throw new DavError(
      'url',
      'Use HTTPS without a username, password, query or fragment in the URL. HTTP is supported only for loopback development.'
    );
  segments(root.pathname);
  if (!root.pathname.endsWith('/')) root.pathname += '/';
  return root;
}
export function davChild(root: URL, value: string): URL {
  if (/\\|(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)/i.test(value))
    throw new DavError('path', 'Unsafe WebDAV path.');
  const url = new URL(value, root);
  segments(url.pathname);
  if (
    url.origin !== root.origin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !(url.pathname === root.pathname.slice(0, -1) || url.pathname.startsWith(root.pathname))
  )
    throw new DavError('path', 'WebDAV returned a path outside the selected folder.');
  return url;
}
export async function limitedBytes(response: Response, limit: number): Promise<Uint8Array> {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new DavError('size', 'WebDAV response is too large.');
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > limit) throw new DavError('size', 'WebDAV response is too large.');
    return bytes;
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > limit) throw new DavError('size', 'WebDAV response is too large.');
      chunks.push(result.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}
const child = (element: Element, name: string) =>
  [...element.children].find((item) => item.namespaceURI === 'DAV:' && item.localName === name);
export function parseListing(xml: string, root: URL, parent: URL, depth: 0 | 1): DavEntry[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new DavError('xml', 'Unsafe WebDAV XML.');
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  const top = document.documentElement;
  if (
    top.localName !== 'multistatus' ||
    top.namespaceURI !== 'DAV:' ||
    document.querySelector('parsererror')
  )
    throw new DavError('xml', 'The server did not return a WebDAV listing.');
  const responses = [...top.children].filter(
    (item) => item.namespaceURI === 'DAV:' && item.localName === 'response'
  );
  if (responses.length > 10001)
    throw new DavError('size', 'This WebDAV folder has too many entries.');
  const result: DavEntry[] = [],
    seen = new Set<string>();
  let selfCount = 0;
  for (const item of responses) {
    const href = child(item, 'href')?.textContent;
    if (!href) throw new DavError('xml', 'A WebDAV entry has no path.');
    if (/\\|(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)/i.test(href))
      throw new DavError('path', 'Unsafe WebDAV response path.');
    const url = davChild(root, new URL(href, parent).href);
    const path = url.pathname.replace(/\/$/, '');
    const parentPath = parent.pathname.replace(/\/$/, '');
    const isSelf = path === parentPath;
    if (isSelf && ++selfCount > 1) throw new DavError('xml', 'Duplicate WebDAV parent response.');
    if (!isSelf && (depth === 0 || path.slice(0, path.lastIndexOf('/')) !== parentPath))
      throw new DavError('xml', 'WebDAV returned an unexpected nested path.');
    const props = [...item.children]
      .filter(
        (el) =>
          el.namespaceURI === 'DAV:' &&
          el.localName === 'propstat' &&
          /^HTTP\/\S+ 200(?: |$)/.test(child(el, 'status')?.textContent?.trim() ?? '')
      )
      .map((el) => child(el, 'prop'))
      .filter((el): el is Element => !!el);
    if (!props.length) {
      if (isSelf) throw new DavError('permission', 'WebDAV folder properties are not readable.');
      continue;
    }
    const property = (name: string) => props.map((prop) => child(prop, name)).find(Boolean);
    if (!property('resourcetype'))
      throw new DavError('xml', 'WebDAV omitted the requested resource type.');
    const collection = !!property('resourcetype')?.getElementsByTagNameNS('DAV:', 'collection')
      .length;
    if (isSelf && depth === 1) {
      if (!collection) throw new DavError('folder', 'Choose a WebDAV folder, not a file.');
      continue;
    }
    const length = property('getcontentlength')?.textContent?.trim();
    if (length && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length))))
      throw new DavError('xml', 'Invalid WebDAV file size.');
    const id = url.href.replace(/\/$/, '') + (collection ? '/' : '');
    if (seen.has(id)) throw new DavError('xml', 'WebDAV returned duplicate paths.');
    seen.add(id);
    const name = decodeURIComponent(path.slice(path.lastIndexOf('/') + 1));
    result.push({
      id,
      name,
      kind: collection ? 'folder' : 'file',
      size: length ? Number(length) : undefined,
      etag: property('getetag')?.textContent?.trim()
    });
  }
  if (selfCount !== 1) throw new DavError('xml', 'WebDAV omitted the requested parent resource.');
  return result;
}
export class WebDavClient {
  readonly root: URL;
  constructor(
    url: string,
    private username = '',
    private password = '',
    private signal?: AbortSignal
  ) {
    this.root = davRoot(url);
    if (username.includes(':') || /[\r\n]/.test(username + password))
      throw new DavError('auth', 'Invalid WebDAV credentials.');
  }
  private async request(
    path: string,
    method: string,
    body?: BodyInit,
    headers: Record<string, string> = {},
    limit = 4 * 1024 * 1024,
    accepted: number[] = [200]
  ) {
    const url = davChild(this.root, path);
    this.signal?.throwIfAborted();
    const controller = new AbortController(),
      abort = () => controller.abort();
    this.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 30000);
    try {
      if (this.username || this.password) {
        const bytes = new TextEncoder().encode(`${this.username}:${this.password}`);
        headers.Authorization = `Basic ${btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))}`;
      }
      const response = await fetch(url, {
        method,
        body,
        headers,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        signal: controller.signal
      });
      if (!accepted.includes(response.status)) {
        await response.body?.cancel();
        const message =
          response.status === 401 || response.status === 403
            ? 'WebDAV authentication or folder access was denied.'
            : response.status === 412
              ? 'The WebDAV copy changed. Refresh and review before writing again.'
              : `Unexpected WebDAV ${method} response: HTTP ${response.status}. No complete result was accepted.`;
        throw new DavError(response.status === 412 ? 'conflict' : 'http', message);
      }
      const bytes = await limitedBytes(response, limit);
      this.signal?.throwIfAborted();
      return { bytes, etag: response.headers.get('etag'), status: response.status };
    } catch (error) {
      if (error instanceof DavError || this.signal?.aborted) throw error;
      if (controller.signal.aborted)
        throw new DavError(
          'timeout',
          'The WebDAV request timed out. The last write may have succeeded; refresh before retrying.'
        );
      throw new DavError(
        'network',
        'Cannot reach WebDAV. Check HTTPS, credentials, network access and the server’s CORS settings. Redirects are not followed.'
      );
    } finally {
      clearTimeout(timer);
      this.signal?.removeEventListener('abort', abort);
    }
  }
  async list(parent = this.root.href, depth: 0 | 1 = 1): Promise<DavEntry[]> {
    const url = davChild(this.root, parent);
    const response = await this.request(
      url.href,
      'PROPFIND',
      '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getetag/></d:prop></d:propfind>',
      { Depth: String(depth), 'Content-Type': 'application/xml; charset=utf-8' },
      4 * 1024 * 1024,
      [207]
    );
    if (response.status !== 207)
      throw new DavError('xml', 'The server did not return a WebDAV multistatus response.');
    return parseListing(new TextDecoder().decode(response.bytes), this.root, url, depth);
  }
  get(path: string, limit: number, etag?: string) {
    return this.request(
      path,
      'GET',
      undefined,
      etag && strongEtag(etag) ? { 'If-Match': etag } : {},
      limit,
      [200, 404]
    );
  }
  async mkdir(path: string) {
    const response = await this.request(path, 'MKCOL', undefined, {}, 65536, [201, 405]);
    if (response.status === 405) {
      const entries = await this.list(path, 0);
      if (entries.length !== 1 || entries[0].kind !== 'folder')
        throw new DavError('folder', 'The WebDAV metadata path is not a directory.');
    }
  }
  async put(path: string, body: string | Blob, revision: string) {
    if (revision !== 'missing' && !strongEtag(revision))
      throw new DavError(
        'etag',
        'This server must expose a strong ETag before an existing file can be changed.'
      );
    return this.request(
      path,
      'PUT',
      body,
      {
        'Content-Type':
          typeof body === 'string' ? 'application/json; charset=utf-8' : 'application/octet-stream',
        [revision === 'missing' ? 'If-None-Match' : 'If-Match']:
          revision === 'missing' ? '*' : revision
      },
      65536,
      [200, 201, 204]
    );
  }
}
