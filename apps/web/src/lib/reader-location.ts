/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

// v2 treats block-level divs and !important-hidden inline content explicitly.
export const readerProjectionVersion = 2;

export interface PublicationResource {
  href: string;
  spineIndex: number;
  sectionId: string;
}

export interface PublicationManifest {
  version: 1;
  resources: PublicationResource[];
}

export interface ReaderLocator {
  version: 1;
  bookKey: string;
  resource: PublicationResource;
  projectionVersion: number;
  resourceDigest: string;
  start: number;
  end: number;
  quote: string;
  prefix: string;
  suffix: string;
}

export interface TextRun {
  node: Text;
  start: number;
  end: number;
}

export interface ProjectedResource {
  resource: PublicationResource;
  element: Element;
  text: string;
  runs: TextRun[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Reader locations cross async, storage and sync boundaries. Treat them as
 * immutable values: validate the supported coordinate contract and return a
 * deep identity snapshot before any caller can retarget pending work.
 */
export function snapshotReaderLocator(
  value: unknown,
  expectedBookKey?: string
): ReaderLocator | undefined {
  if (!isRecord(value) || value.version !== 1 || typeof value.bookKey !== 'string') return;
  if (expectedBookKey !== undefined && value.bookKey !== expectedBookKey) return;
  if (
    !isRecord(value.resource) ||
    typeof value.resource.href !== 'string' ||
    !value.resource.href ||
    typeof value.resource.sectionId !== 'string' ||
    !value.resource.sectionId ||
    !Number.isSafeInteger(value.resource.spineIndex) ||
    Number(value.resource.spineIndex) < 0 ||
    !Number.isSafeInteger(value.projectionVersion) ||
    Number(value.projectionVersion) < 1 ||
    Number(value.projectionVersion) > readerProjectionVersion ||
    typeof value.resourceDigest !== 'string' ||
    !Number.isSafeInteger(value.start) ||
    Number(value.start) < 0 ||
    !Number.isSafeInteger(value.end) ||
    Number(value.end) < Number(value.start) ||
    typeof value.quote !== 'string' ||
    typeof value.prefix !== 'string' ||
    typeof value.suffix !== 'string'
  )
    return;
  return {
    version: 1,
    bookKey: value.bookKey,
    resource: {
      href: value.resource.href,
      spineIndex: Number(value.resource.spineIndex),
      sectionId: value.resource.sectionId
    },
    projectionVersion: Number(value.projectionVersion),
    resourceDigest: value.resourceDigest,
    start: Number(value.start),
    end: Number(value.end),
    quote: value.quote,
    prefix: value.prefix,
    suffix: value.suffix
  };
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const excludedTags = new Set(['rt', 'rp', 'rtc', 'script', 'style', 'template', 'noscript']);
const blockTags = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'blockquote',
  'pre',
  'div',
  'tr',
  'figcaption'
]);

/**
 * EPUB resources may be parsed as XHTML and may live in a child browsing
 * context. Avoid realm-specific `instanceof Element` checks and HTML-only
 * upper-case tag-name assumptions so canonical coordinates are identical in
 * the legacy same-document reader and the Foliate-style framed renderer.
 */
function elementLocalName(node: Node): string | undefined {
  if (node.nodeType !== ELEMENT_NODE) return undefined;
  const element = node as Element;
  return (element.localName || element.tagName || '').toLowerCase() || undefined;
}

/** One Unicode code point is one coordinate, even when the DOM uses two UTF-16 code units. */
export function codePointLength(text: string): number {
  let count = 0;
  for (const _character of text) count += 1;
  return count;
}

export function utf16OffsetAtCodePoint(text: string, point: number): number {
  if (!Number.isSafeInteger(point) || point < 0) throw new RangeError('Invalid text position.');
  let index = 0;
  let count = 0;
  for (const character of text) {
    if (count === point) return index;
    index += character.length;
    count += 1;
  }
  if (count === point) return index;
  throw new RangeError('Text position is beyond the resource.');
}

/** Project a stored, sanitized resource before runtime image URLs or presentation wrappers. */
export function projectResource(
  element: Element,
  resource: PublicationResource
): ProjectedResource {
  const parts: string[] = [];
  const runs: TextRun[] = [];
  let count = 0;
  const separator = () => {
    if (count && parts.at(-1) !== '\n') {
      parts.push('\n');
      count += 1;
    }
  };
  const visit = (node: Node) => {
    if (node.nodeType === TEXT_NODE) {
      const value = node.textContent ?? '';
      if (!value) return;
      const length = codePointLength(value);
      runs.push({ node: node as Text, start: count, end: count + length });
      parts.push(value);
      count += length;
      return;
    }
    const localName = elementLocalName(node);
    if (!localName) return;
    const element = node as Element;
    if (
      excludedTags.has(localName) ||
      element.hasAttribute('hidden') ||
      element.getAttribute('aria-hidden') === 'true' ||
      /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|content-visibility\s*:\s*hidden)\s*(?:!important\s*)?(?:;|$)/i.test(
        element.getAttribute('style') ?? ''
      )
    )
      return;
    if (localName === 'br') {
      separator();
      return;
    }
    const block = blockTags.has(localName);
    if (block) separator();
    for (const child of node.childNodes) visit(child);
    if (block) separator();
  };
  for (const child of element.childNodes) visit(child);
  if (parts.at(-1) === '\n') parts.pop();
  return { resource, element, text: parts.join(''), runs };
}

export function defaultManifest(html: HTMLElement): PublicationManifest {
  return {
    version: 1,
    resources: Array.from(html.children, (section, spineIndex) => ({
      href: `legacy-section-${spineIndex}`,
      spineIndex,
      sectionId: section.id || `section-${spineIndex}`
    }))
  };
}

export function projectPublication(
  html: HTMLElement,
  manifest: PublicationManifest = defaultManifest(html)
): ProjectedResource[] {
  if (manifest.resources.length !== html.children.length)
    throw new Error('Publication manifest does not match stored reading sections.');
  return manifest.resources.map((resource, index) =>
    projectResource(html.children[index], resource)
  );
}

export async function resourceDigest(text: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  );
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Convert a canonical point or range to live DOM; separators have no DOM node. */
export function rangeAt(
  resource: ProjectedResource,
  start: number,
  end = start
): Range | undefined {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    end > codePointLength(resource.text)
  )
    return undefined;
  if (!resource.runs.length && start === 0 && end === 0) {
    const range = resource.element.ownerDocument.createRange();
    range.selectNodeContents(resource.element);
    return range;
  }
  if (start === end) {
    // WebKit reports an empty rectangle for collapsed ranges. A source point
    // needs the adjacent glyph's ink box to navigate to it after reflow.
    const run =
      resource.runs.find((item) => item.start <= start && start < item.end) ??
      resource.runs.find((item) => item.start > start) ??
      resource.runs.at(-1);
    if (!run || run.end <= run.start) return undefined;
    const point = Math.min(Math.max(start, run.start), run.end - 1);
    const range = run.node.ownerDocument.createRange();
    range.setStart(run.node, utf16OffsetAtCodePoint(run.node.data, point - run.start));
    range.setEnd(run.node, utf16OffsetAtCodePoint(run.node.data, point - run.start + 1));
    return range;
  }
  const first = resource.runs.find((run) => run.start <= start && start <= run.end);
  const last = resource.runs.find((run) => run.start <= end && end <= run.end);
  if (!first || !last || end < start) return undefined;
  const range = first.node.ownerDocument.createRange();
  range.setStart(first.node, utf16OffsetAtCodePoint(first.node.data, start - first.start));
  range.setEnd(last.node, utf16OffsetAtCodePoint(last.node.data, end - last.start));
  return range;
}

/** Capture an existing DOM selection without changing it or wrapping imported markup. */
export function selectedOffsets(
  resource: ProjectedResource,
  selection: Range
): { start: number; end: number } | undefined {
  let start: number | undefined;
  let end: number | undefined;
  for (const run of resource.runs) {
    if (!selection.intersectsNode(run.node)) continue;
    const first = selection.startContainer === run.node ? selection.startOffset : 0;
    const last = selection.endContainer === run.node ? selection.endOffset : run.node.data.length;
    const from = run.start + codePointLength(run.node.data.slice(0, first));
    const to = run.start + codePointLength(run.node.data.slice(0, last));
    if (to <= from) continue;
    start ??= from;
    end = to;
  }
  return start === undefined || end === undefined ? undefined : { start, end };
}

export async function makeLocator(
  bookKey: string,
  projected: ProjectedResource,
  start: number,
  end = start
): Promise<ReaderLocator> {
  const { text } = projected;
  const length = codePointLength(text);
  if (start < 0 || end < start || end > length) throw new RangeError('Invalid source range.');
  const start16 = utf16OffsetAtCodePoint(text, start);
  const end16 = utf16OffsetAtCodePoint(text, end);
  const prefix16 = utf16OffsetAtCodePoint(text, Math.max(0, start - 32));
  const suffix16 = utf16OffsetAtCodePoint(text, Math.min(length, end + 32));
  return {
    version: 1,
    bookKey,
    resource: { ...projected.resource },
    projectionVersion: readerProjectionVersion,
    resourceDigest: await resourceDigest(text),
    start,
    end,
    quote: text.slice(start16, end16),
    prefix: text.slice(prefix16, start16),
    suffix: text.slice(end16, suffix16)
  };
}

/** Never guess between repeated quotes in a changed resource. */
export async function resolveLocator(
  locator: ReaderLocator,
  projected: ProjectedResource,
  bookKey: string
): Promise<{ start: number; end: number } | undefined> {
  const request = snapshotReaderLocator(locator, bookKey);
  if (
    !request ||
    request.resource.spineIndex !== projected.resource.spineIndex ||
    request.resource.href !== projected.resource.href
  )
    return undefined;
  // Own caller coordinates before hashing yields. A saved locator is a value,
  // not authority for the caller to retarget a pending resolution by mutation.
  locator = request;
  const text = projected.text;
  const digest = await resourceDigest(text);
  if (
    projected.text !== text ||
    projected.resource.spineIndex !== locator.resource.spineIndex ||
    projected.resource.href !== locator.resource.href
  )
    return undefined;
  if (digest === locator.resourceDigest && locator.end <= codePointLength(text))
    return { start: locator.start, end: locator.end };
  const candidates: number[] = [];
  if (!locator.quote) {
    if (!locator.prefix && !locator.suffix)
      return text.length === 0 ? { start: 0, end: 0 } : undefined;
    if (locator.suffix) {
      let index = -1;
      while ((index = text.indexOf(locator.suffix, index + 1)) >= 0) {
        if (text.slice(Math.max(0, index - locator.prefix.length), index) === locator.prefix)
          candidates.push(index);
        if (candidates.length > 1) return undefined;
      }
    } else {
      let index = -1;
      while ((index = text.indexOf(locator.prefix, index + 1)) >= 0) {
        candidates.push(index + locator.prefix.length);
        if (candidates.length > 1) return undefined;
      }
    }
    if (candidates.length !== 1) return undefined;
    const point = codePointLength(text.slice(0, candidates[0]));
    return { start: point, end: point };
  }
  let index = -1;
  while ((index = text.indexOf(locator.quote, index + 1)) >= 0) {
    if (
      text.slice(Math.max(0, index - locator.prefix.length), index) === locator.prefix &&
      text.slice(
        index + locator.quote.length,
        index + locator.quote.length + locator.suffix.length
      ) === locator.suffix
    )
      candidates.push(index);
    if (candidates.length > 1) return undefined;
  }
  if (candidates.length !== 1) return undefined;
  const start = codePointLength(text.slice(0, candidates[0]));
  return { start, end: start + codePointLength(locator.quote) };
}
