/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { PublicationManifest, PublicationResource } from '../reader-location';

/** Prepared runtime resource. Image URLs belong to the owning read lifetime. */
export interface EpubResourceData extends PublicationResource {
  html: string;
  styleSheet: string;
}

interface PackedEpubResource extends PublicationResource {
  start: number;
  end: number;
  style: number;
}

/**
 * Individual resources address immutable slices of the existing elementHtml
 * buffer. Do not persist a second copy of every chapter or shared stylesheet.
 * Old readers/backups retain their compatibility projection in the same field.
 */
export interface EpubPublicationData {
  version: 1;
  resources: PackedEpubResource[];
  styleSheets: string[];
}

const MAX_HTML = 32 * 1024 * 1024;
const MAX_CSS = 4 * 1024 * 1024;
const localHref = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 2048 &&
  !/^[a-z][\w+.-]*:/i.test(value) &&
  // These are resolved names, not URLs. Never decode a second time.
  // eslint-disable-next-line no-control-regex
  !/[\\\x00-\x1f\x7f]/.test(value) &&
  value.split('/').every((part) => part && part !== '.' && part !== '..');

/** Validate persisted input; HTML/CSS still cross the sanitizer on every read. */
export function readEpubPublication(value: unknown, source: string): EpubPublicationData {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid EPUB publication data.');
  const publication = value as Record<string, unknown>;
  if (
    publication.version !== 1 ||
    !Array.isArray(publication.resources) ||
    !publication.resources.length ||
    publication.resources.length > 8192 ||
    !Array.isArray(publication.styleSheets) ||
    publication.styleSheets.length > 8192 ||
    typeof source !== 'string' ||
    source.length > MAX_HTML
  )
    throw new Error('Unsupported EPUB publication data.');
  let cssSize = 0;
  const styleSheets = publication.styleSheets.map((css): string => {
    if (typeof css !== 'string' || (cssSize += css.length) > MAX_CSS)
      throw new Error('EPUB styles exceed the expanded size limit.');
    return css;
  });
  let position = 0;
  const ids = new Set<string>();
  const resources = publication.resources.map((value, index): PackedEpubResource => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Invalid EPUB resource.');
    const entry = value as Record<string, unknown>;
    if (
      entry.spineIndex !== index ||
      !localHref(entry.href) ||
      typeof entry.sectionId !== 'string' ||
      !/^ttu-[a-zA-Z0-9_-]{1,128}$/.test(entry.sectionId) ||
      ids.has(entry.sectionId) ||
      entry.start !== position ||
      !Number.isSafeInteger(entry.end) ||
      (entry.end as number) <= position ||
      (entry.end as number) > source.length ||
      !Number.isSafeInteger(entry.style) ||
      (entry.style as number) < 0 ||
      (entry.style as number) >= styleSheets.length
    )
      throw new Error('Invalid EPUB resource identity or content range.');
    ids.add(entry.sectionId);
    position = entry.end as number;
    return {
      href: entry.href,
      spineIndex: index,
      sectionId: entry.sectionId,
      start: entry.start as number,
      end: position,
      style: entry.style as number
    };
  });
  if (position !== source.length) throw new Error('EPUB resource ranges do not cover the source.');
  return { version: 1, resources, styleSheets };
}

export function packEpubResources(resources: readonly EpubResourceData[]): {
  elementHtml: string;
  epubPublication: EpubPublicationData;
} {
  const styles = new Map<string, number>();
  let position = 0;
  const entries = resources.map(({ href, spineIndex, sectionId, html, styleSheet }) => {
    if (!styles.has(styleSheet)) styles.set(styleSheet, styles.size);
    const start = position;
    position += html.length;
    return { href, spineIndex, sectionId, start, end: position, style: styles.get(styleSheet)! };
  });
  const elementHtml = resources.map((resource) => resource.html).join('');
  const epubPublication = readEpubPublication(
    { version: 1, resources: entries, styleSheets: [...styles.keys()] },
    elementHtml
  );
  return { elementHtml, epubPublication };
}

export function epubResourceContents(
  publication: EpubPublicationData,
  source: string
): EpubResourceData[] {
  return publication.resources.map(({ href, spineIndex, sectionId, start, end, style }) => ({
    href,
    spineIndex,
    sectionId,
    html: source.slice(start, end),
    styleSheet: publication.styleSheets[style]
  }));
}

export function epubPublicationManifest(
  publication: { resources: readonly PublicationResource[] }
): PublicationManifest {
  return {
    version: 1,
    resources: publication.resources.map(({ href, spineIndex, sectionId }) => ({
      href,
      spineIndex,
      sectionId
    }))
  };
}

/** A stale descriptor cannot reinterpret a different publication's positions. */
export function assertEpubManifest(
  publication: EpubPublicationData,
  manifest: PublicationManifest | undefined
): void {
  if (
    !manifest ||
    manifest.version !== 1 ||
    manifest.resources.length !== publication.resources.length ||
    publication.resources.some((resource, index) => {
      const expected = manifest.resources[index];
      return (
        expected?.href !== resource.href ||
        expected.spineIndex !== resource.spineIndex ||
        expected.sectionId !== resource.sectionId
      );
    })
  )
    throw new Error('EPUB resources do not match the saved publication manifest.');
}

/** Rebuild offsets after any sanitizer/transform changes the serialized chapters. */
export function rewriteEpubPublication(
  publication: EpubPublicationData,
  source: string,
  transform: (resource: EpubResourceData) => EpubResourceData
): { elementHtml: string; epubPublication: EpubPublicationData } {
  const validated = readEpubPublication(publication, source);
  const resources = epubResourceContents(validated, source).map((resource) => {
    const next = transform(resource);
    if (
      next.href !== resource.href ||
      next.spineIndex !== resource.spineIndex ||
      next.sectionId !== resource.sectionId
    )
      throw new Error('An EPUB content transform changed resource identity.');
    return next;
  });
  return packEpubResources(resources);
}
