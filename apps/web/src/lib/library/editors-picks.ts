/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

const catalogPath = '/static/reader/books/opds/index.xml';
const feedPrefix = '/static/reader/books/opds/feeds/';
const coverPrefix = '/static/reader/books/opds/covers/';
const bookPrefix = '/static/reader/books/library/';
const maxFeedBytes = 2 * 1024 * 1024;
const maxBookBytes = 80 * 1024 * 1024;

export interface EditorsPick {
  id: string;
  title: string;
  author: string;
  summary: string;
  coverUrl?: string;
  bookUrl: string;
}

function child(element: Element, name: string): Element | undefined {
  return Array.from(element.children).find((entry) => entry.localName === name);
}

function children(element: Element, name: string): Element[] {
  return Array.from(element.children).filter((entry) => entry.localName === name);
}

function value(element: Element, name: string): string {
  return child(element, name)?.textContent?.trim() || '';
}

function safeCatalogUrl(href: string, origin: string, prefix: string): string | undefined {
  try {
    const url = new URL(href, new URL(catalogPath, origin));
    if (
      url.username ||
      url.password ||
      (url.origin !== origin &&
        url.origin !== 'https://manabi.io' &&
        url.origin !== 'https://reader.manabi.io')
    )
      return;
    const decoded = decodeURIComponent(url.pathname);
    if (
      !url.pathname.startsWith(prefix) ||
      decoded.includes('\\') ||
      decoded.includes('\0') ||
      decoded.split('/').some((part) => part === '..' || part === '.')
    )
      return;
    return `${origin}${url.pathname}`;
  } catch {
    return;
  }
}

async function boundedResponse(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.ok) throw new Error(`The catalog returned ${response.status}.`);
  const length = Number(response.headers.get('content-length'));
  if (length > limit) throw new Error('This download is too large.');
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > limit) throw new Error('This download is too large.');
    return bytes;
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('This download is too large.');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function fetchFeed(path: string, signal?: AbortSignal): Promise<Document> {
  const response = await fetch(path, {
    credentials: 'omit',
    redirect: 'error',
    signal,
    headers: { Accept: 'application/atom+xml, application/xml;q=0.9' }
  });
  const xml = new TextDecoder().decode(await boundedResponse(response, maxFeedBytes));
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.querySelector('parsererror') || document.documentElement.localName !== 'feed')
    throw new Error('The catalog is not a valid OPDS feed.');
  return document;
}

export async function loadEditorsPicks(
  origin: string,
  signal?: AbortSignal
): Promise<EditorsPick[]> {
  const index = await fetchFeed(`${origin}${catalogPath}`, signal);
  const allBooks = children(index.documentElement, 'entry').find((entry) =>
    value(entry, 'title').startsWith('All Books')
  );
  const link =
    allBooks &&
    children(allBooks, 'link').find((entry) => entry.getAttribute('rel') === 'subsection');
  const feedUrl = link && safeCatalogUrl(link.getAttribute('href') || '', origin, feedPrefix);
  if (!feedUrl) throw new Error('The catalog has no All Books feed.');

  const feed = await fetchFeed(feedUrl, signal);
  const entries = children(feed.documentElement, 'entry');
  if (entries.length > 1000) throw new Error('The catalog has too many books to display.');
  return entries.flatMap((entry) => {
    const acquisition = children(entry, 'link').find(
      (link) =>
        link.getAttribute('rel')?.includes('opds-spec.org/acquisition') &&
        link.getAttribute('type') === 'application/epub+zip'
    );
    const bookUrl =
      acquisition && safeCatalogUrl(acquisition.getAttribute('href') || '', origin, bookPrefix);
    if (!bookUrl || !decodeURIComponent(bookUrl).toLowerCase().endsWith('.epub')) return [];
    const cover = children(entry, 'link').find((link) =>
      ['http://opds-spec.org/image', 'http://opds-spec.org/image/thumbnail', 'cover'].includes(
        link.getAttribute('rel') || ''
      )
    );
    const title = value(entry, 'title');
    if (!title) return [];
    return [
      {
        id: value(entry, 'id') || bookUrl,
        title,
        author: children(entry, 'author')
          .map((author) => value(author, 'name'))
          .filter(Boolean)
          .join(', '),
        summary: value(entry, 'summary'),
        coverUrl: cover && safeCatalogUrl(cover.getAttribute('href') || '', origin, coverPrefix),
        bookUrl
      }
    ];
  });
}

export async function downloadEditorsPick(pick: EditorsPick, signal?: AbortSignal): Promise<File> {
  const response = await fetch(pick.bookUrl, { credentials: 'omit', redirect: 'error', signal });
  const bytes = await boundedResponse(response, maxBookBytes);
  if (bytes.byteLength < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b)
    throw new Error('This catalog book is not a valid EPUB download.');
  const filename = decodeURIComponent(
    new URL(pick.bookUrl).pathname.split('/').pop() || 'Book.epub'
  );
  return new File([new Uint8Array(bytes).buffer], filename, { type: 'application/epub+zip' });
}
