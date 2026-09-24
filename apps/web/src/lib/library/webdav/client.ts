/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

// Reject control characters in credentials and resource paths before URL normalization.
/* eslint-disable no-control-regex */
import { boundedBytes } from '../bounded-response.ts';
import type { LibraryEntry } from '../../manabi/sources';

export class WebDAVError extends Error {
  constructor(
    message: string,
    public readonly status = 0
  ) {
    super(message);
    this.name = 'WebDAVError';
  }
}
const dav = 'DAV:';
const children = (element: Element, name: string) =>
  [...element.children].filter((item) => item.localName === name && item.namespaceURI === dav);
function one(element: Element, name: string) {
  const matches = children(element, name);
  if (matches.length > 1) throw new WebDAVError('The WebDAV server returned ambiguous properties.');
  return matches[0];
}
function safePath(raw: string) {
  const path = raw.replace(/^[a-z][a-z\d+.-]*:\/\/[^/?#]*/i, '').split(/[?#]/, 1)[0];
  for (const segment of path.split('/')) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new WebDAVError('Invalid escaping in a WebDAV path.');
    }
    if (decoded === '.' || decoded === '..' || /[\\/\u0000-\u001f\u007f]/.test(decoded))
      throw new WebDAVError('Unsafe WebDAV path.');
  }
}
export function normalizeWebDAVRoot(input: string): string {
  if (typeof input !== 'string' || input.length > 8192 || /[\\\u0000-\u0020\u007f]/.test(input))
    throw new WebDAVError('Enter an HTTPS folder URL without embedded credentials.');
  safePath(input);
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new WebDAVError('Enter a complete HTTPS WebDAV folder URL.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new WebDAVError(
      'WebDAV requires HTTPS and a URL without credentials, query parameters, or fragments.'
    );
  url.pathname = url.pathname.replace(/\/+$/, '') + '/';
  return url.href;
}
export function resolveWebDAVPath(root: string, href: string, parent = root): string {
  if (!href || href.length > 16384 || /[\\\u0000-\u0020\u007f]/.test(href))
    throw new WebDAVError('Unsafe WebDAV resource URL.');
  safePath(href);
  const base = new URL(root),
    url = new URL(href, parent);
  if (url.origin !== base.origin || url.username || url.password || url.search || url.hash)
    throw new WebDAVError('The WebDAV server returned a resource outside the selected folder.');
  // Compare decoded segments too: equivalent percent-escaped root paths must work.
  const baseParts = base.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (baseParts.some((part, index) => parts[index] !== part))
    throw new WebDAVError('The WebDAV server returned a resource outside the selected folder.');
  url.pathname =
    '/' +
    parts.map(encodeURIComponent).join('/') +
    (url.pathname.endsWith('/') && parts.length ? '/' : '');
  return url.href;
}
export function strongETag(value: string | null): value is string {
  return value !== null && /^"[\x21\x23-\x7e\x80-\xff]*"$/.test(value);
}
export interface DavEntry extends LibraryEntry {
  etag?: string;
}
export function parseMultistatus(xml: string, root: string, parent: string): DavEntry[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new WebDAVError('WebDAV XML declarations are not supported.');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (
    doc.querySelector('parsererror') ||
    doc.documentElement.localName !== 'multistatus' ||
    doc.documentElement.namespaceURI !== dav
  )
    throw new WebDAVError('The server did not return a WebDAV directory listing.');
  const responses = children(doc.documentElement, 'response');
  if (responses.length > 20000) throw new WebDAVError('This WebDAV folder has too many entries.');
  const parentUrl = resolveWebDAVPath(root, parent),
    seen = new Set<string>();
  let foundParent = false;
  const entries: DavEntry[] = [];
  for (const response of responses) {
    const href = one(response, 'href')?.textContent ?? '';
    const url = resolveWebDAVPath(root, href, parentUrl);
    const status = one(response, 'status')?.textContent;
    if (status && !/^HTTP\/\d(?:\.\d)?\s+2\d\d(?:\s|$)/.test(status.trim()))
      throw new WebDAVError('The server could not read part of this folder.');
    const props = children(response, 'propstat')
      .filter((item) =>
        /^HTTP\/\d(?:\.\d)?\s+200(?:\s|$)/.test(one(item, 'status')?.textContent?.trim() ?? '')
      )
      .map((item) => one(item, 'prop'))
      .filter((item): item is Element => !!item);
    const resourceTypes = props.flatMap((prop) => children(prop, 'resourcetype'));
    if (resourceTypes.length !== 1)
      throw new WebDAVError('The server did not expose a resource type.');
    const folder = !!one(resourceTypes[0], 'collection');
    const id = folder ? url.replace(/\/+$/, '') + '/' : url;
    if (id.replace(/\/$/, '') === parentUrl.replace(/\/$/, '')) {
      if (!folder || foundParent)
        throw new WebDAVError('The selected WebDAV URL is not one directory.');
      foundParent = true;
      continue;
    }
    const path = new URL(id).pathname.replace(/\/$/, '');
    const parentPath = new URL(parentUrl).pathname.replace(/\/$/, '');
    if (path.slice(0, path.lastIndexOf('/')) !== parentPath || seen.has(id))
      throw new WebDAVError('The server returned duplicate or non-child resources.');
    seen.add(id);
    const name = decodeURIComponent(path.slice(path.lastIndexOf('/') + 1));
    const sizeText = props.flatMap((prop) => children(prop, 'getcontentlength'))[0]?.textContent;
    const size = sizeText == null ? undefined : Number(sizeText);
    if (
      size !== undefined &&
      (!/^\d+$/.test(sizeText!.trim()) || !Number.isSafeInteger(size) || size < 0)
    )
      throw new WebDAVError('The server returned an invalid file size.');
    const etag = props.flatMap((prop) => children(prop, 'getetag'))[0]?.textContent ?? undefined;
    entries.push({
      id,
      name,
      kind: folder ? 'folder' : 'file',
      size,
      ...(strongETag(etag ?? null) ? { etag } : {})
    });
  }
  if (!foundParent) throw new WebDAVError('The server did not confirm the selected folder.');
  return entries;
}
const propfindBody =
  '<?xml version="1.0" encoding="UTF-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getetag/></d:prop></d:propfind>';

/** Direct browser transport. Redirects never carry credentials to another resource. */
export class WebDAVClient {
  readonly root: string;
  private authorization: string;
  private lifetime = new AbortController();
  constructor(
    root: string,
    username: string,
    password: string,
    private fetcher: typeof fetch = fetch
  ) {
    this.root = normalizeWebDAVRoot(root);
    if (
      username.includes(':') ||
      /[\r\n]/.test(username) ||
      username.length > 512 ||
      password.length > 4096
    )
      throw new WebDAVError('Invalid WebDAV credentials.');
    const bytes = new TextEncoder().encode(`${username}:${password}`);
    this.authorization =
      'Basic ' + btoa([...bytes].map((byte) => String.fromCharCode(byte)).join(''));
  }
  close() {
    this.authorization = '';
    this.lifetime.abort();
  }
  private async request<T>(
    href: string,
    method: string,
    options: { headers?: Record<string, string>; body?: BodyInit },
    consume: (response: Response) => Promise<T>
  ): Promise<T> {
    const url = resolveWebDAVPath(this.root, href);
    this.lifetime.signal.throwIfAborted();
    const controller = new AbortController();
    const cancel = () => controller.abort();
    this.lifetime.signal.addEventListener('abort', cancel, { once: true });
    const timeout = setTimeout(cancel, 30000);
    try {
      const response = await this.fetcher(url, {
        method,
        mode: 'cors',
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
        headers: { Authorization: this.authorization, ...options.headers },
        body: options.body
      });
      this.lifetime.signal.throwIfAborted();
      const result = await consume(response);
      this.lifetime.signal.throwIfAborted();
      return result;
    } catch (error) {
      if (this.lifetime.signal.aborted)
        throw new WebDAVError('This WebDAV connection was locked or disconnected.');
      if (controller.signal.aborted) throw new WebDAVError('The WebDAV request timed out.');
      if (error instanceof WebDAVError) throw error;
      if (error instanceof Error && error.message === 'Response is too large.')
        throw new WebDAVError(
          'The WebDAV response exceeds the safe size limit. Nothing was imported.'
        );
      throw new WebDAVError(
        'Cannot reach WebDAV. Check the address, network, HTTPS certificate, redirects, and server CORS settings. The browser cannot distinguish these failures.'
      );
    } finally {
      clearTimeout(timeout);
      this.lifetime.signal.removeEventListener('abort', cancel);
    }
  }
  private failure(response: Response): never {
    void response.body?.cancel();
    if (response.status === 401 || response.status === 403)
      throw new WebDAVError(
        'WebDAV access was denied. Check your username, app password, and folder permissions.',
        response.status
      );
    if (response.status === 409 || response.status === 412)
      throw new WebDAVError(
        'The destination already exists or changed on the server. Nothing was overwritten.',
        response.status
      );
    throw new WebDAVError(`The WebDAV server returned HTTP ${response.status}.`, response.status);
  }
  async list(parent = this.root): Promise<DavEntry[]> {
    return this.request(
      parent,
      'PROPFIND',
      {
        headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
        body: propfindBody
      },
      async (response) => {
        if (response.status !== 207) this.failure(response);
        const bytes = await boundedBytes(response, 2 * 1024 * 1024);
        let xml: string;
        try {
          xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } catch {
          throw new WebDAVError('The WebDAV server returned invalid UTF-8 XML.');
        }
        return parseMultistatus(xml, this.root, parent);
      }
    );
  }
  async read(item: LibraryEntry, maximum = 128 * 1024 * 1024): Promise<File> {
    if (item.kind !== 'file' || (item.size !== undefined && item.size > maximum))
      throw new WebDAVError('This file is too large to read.');
    return this.request(item.id, 'GET', {}, async (response) => {
      if (!response.ok) this.failure(response);
      const bytes = await boundedBytes(response, maximum);
      return new File([bytes], item.name, {
        type: item.name.toLowerCase().endsWith('.epub')
          ? 'application/epub+zip'
          : 'application/octet-stream'
      });
    });
  }
  async upload(file: File, parent = this.root): Promise<void> {
    if (
      !/\.(epub|txt|htmlz|zip)$/i.test(file.name) ||
      file.size > 128 * 1024 * 1024 ||
      !file.name ||
      /[\\/\u0000-\u001f\u007f]/.test(file.name) ||
      file.name === '.' ||
      file.name === '..'
    )
      throw new WebDAVError('Choose an EPUB, HTMLZ, TXT, or backup ZIP no larger than 128 MiB.');
    const folder = resolveWebDAVPath(this.root, parent).replace(/\/?$/, '/');
    const href = folder + encodeURIComponent(file.name);
    // New uploads are always create-only. Never trust a preceding existence check.
    await this.request(
      href,
      'PUT',
      {
        body: file,
        headers: { 'If-None-Match': '*', 'Content-Type': file.type || 'application/octet-stream' }
      },
      async (response) => {
        if (![201, 204].includes(response.status)) this.failure(response);
        await response.body?.cancel();
      }
    );
  }
}
