/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { PublicationManifest, PublicationResource } from '../reader-location';

/** Sanitized, portable source documents. Never persist live object URLs or DOM nodes. */
export interface EpubResourceData extends PublicationResource {
  html: string;
  styleSheet: string;
  characters: number;
}

export interface EpubPublicationData {
  version: 1;
  resources: EpubResourceData[];
}

const MAX_DOCUMENTS = 8192;
const MAX_HTML = 32 * 1024 * 1024;
const MAX_CSS = 4 * 1024 * 1024;
const fields = new Set(['href', 'spineIndex', 'sectionId', 'html', 'styleSheet', 'characters']);

/** Validate before allocating DOMs, including data restored from external backups. */
export function validateEpubPublication(
  value: unknown,
  manifest?: PublicationManifest
): asserts value is EpubPublicationData {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid EPUB publication data.');
  const data = value as EpubPublicationData;
  if (
    data.version !== 1 ||
    Object.keys(data).some((key) => key !== 'version' && key !== 'resources') ||
    !Array.isArray(data.resources) ||
    !data.resources.length ||
    data.resources.length > MAX_DOCUMENTS ||
    (manifest !== undefined && manifest.resources.length !== data.resources.length)
  )
    throw new Error('Invalid EPUB publication resources.');
  let html = 0;
  let css = 0;
  let characters = 0;
  const ids = new Set<string>();
  for (const [index, resource] of data.resources.entries()) {
    if (
      !resource ||
      typeof resource !== 'object' ||
      Array.isArray(resource) ||
      Object.keys(resource).some((key) => !fields.has(key)) ||
      resource.spineIndex !== index ||
      typeof resource.href !== 'string' ||
      !resource.href ||
      resource.href.length > 2048 ||
      // eslint-disable-next-line no-control-regex
      /[\\\x00-\x1f\x7f]/.test(resource.href) ||
      // Hrefs are archive-root identities, not network URLs or runtime URLs.
      // Literal #/? characters are possible in ZIP names and remain identities.
      /^(?:[a-z][\w+.-]*:|[\\/])/i.test(resource.href) ||
      resource.href.split('/').some((part) => !part || part === '.' || part === '..') ||
      typeof resource.sectionId !== 'string' ||
      !/^ttu-[\w.-]+$/.test(resource.sectionId) ||
      resource.sectionId.length > 1024 ||
      ids.has(resource.sectionId) ||
      typeof resource.html !== 'string' ||
      !resource.html ||
      typeof resource.styleSheet !== 'string' ||
      !Number.isSafeInteger(resource.characters) ||
      resource.characters < 0
    )
      throw new Error('Invalid EPUB source document.');
    ids.add(resource.sectionId);
    html += resource.html.length;
    css += resource.styleSheet.length;
    characters += resource.characters;
    if (html > MAX_HTML || css > MAX_CSS || !Number.isSafeInteger(characters))
      throw new Error('EPUB publication exceeds the size limit.');
    const expected = manifest?.resources[index];
    if (
      expected &&
      (expected.spineIndex !== index ||
        expected.href !== resource.href ||
        expected.sectionId !== resource.sectionId)
    )
      throw new Error('EPUB source documents do not match their publication manifest.');
  }
}

export function epubPublicationManifest(data: EpubPublicationData): PublicationManifest {
  validateEpubPublication(data);
  return {
    version: 1,
    resources: data.resources.map(({ href, spineIndex, sectionId }) => ({
      href,
      spineIndex,
      sectionId
    }))
  };
}

/** Compatibility projection for continuous reading, search and the TTU wire format. */
export function epubPublicationHtml(data: EpubPublicationData): string {
  validateEpubPublication(data);
  return data.resources.map((resource) => resource.html).join('');
}
