/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  validateEpubPublication,
  type EpubPublicationData,
  type EpubResourceData
} from './publication-data.ts';

interface ResourceSlice extends Omit<EpubResourceData, 'html' | 'styleSheet'> {
  htmlStart: number;
  htmlEnd: number;
  cssStart: number;
  cssEnd: number;
}
interface PublicationSlices {
  version: 1;
  encoding: 'html-slices';
  resources: ResourceSlice[];
}

/** Keep TTU's existing HTML/CSS fields without duplicating book text in its ZIP JSON. */
export function encodeEpubPublication(
  data: EpubPublicationData,
  html: string,
  css: string
): PublicationSlices {
  validateEpubPublication(data);
  let htmlOffset = 0;
  let cssOffset = 0;
  const resources = data.resources.map(({ html: body, styleSheet, ...resource }, index) => {
    if (index) cssOffset += 1; // Compatibility stylesheets are joined with one newline.
    const slice = {
      ...resource,
      htmlStart: htmlOffset,
      htmlEnd: htmlOffset + body.length,
      cssStart: cssOffset,
      cssEnd: cssOffset + styleSheet.length
    };
    if (
      html.slice(slice.htmlStart, slice.htmlEnd) !== body ||
      css.slice(slice.cssStart, slice.cssEnd) !== styleSheet
    )
      throw new Error('EPUB backup projection does not match its source documents.');
    htmlOffset = slice.htmlEnd;
    cssOffset = slice.cssEnd;
    return slice;
  });
  if (htmlOffset !== html.length || cssOffset !== css.length)
    throw new Error('EPUB backup projection has unexpected trailing content.');
  return { version: 1, encoding: 'html-slices', resources };
}

/** Validate offsets and total size before creating source substrings from a backup. */
export function decodeEpubPublication(
  value: unknown,
  html: string,
  css: string
): EpubPublicationData {
  if (!(value && typeof value === 'object' && 'encoding' in value)) {
    validateEpubPublication(value);
    return value;
  }
  const data = value as PublicationSlices;
  if (
    data.version !== 1 ||
    data.encoding !== 'html-slices' ||
    !Array.isArray(data.resources) ||
    data.resources.length < 1 ||
    data.resources.length > 8192 ||
    Object.keys(data).some((key) => !['version', 'encoding', 'resources'].includes(key)) ||
    html.length > 32 * 1024 * 1024 ||
    css.length > 4 * 1024 * 1024
  )
    throw new Error('Invalid EPUB backup resource slices.');
  let htmlOffset = 0;
  let cssOffset = 0;
  const resources = data.resources.map((slice, index): EpubResourceData => {
    if (
      !slice ||
      typeof slice !== 'object' ||
      Array.isArray(slice) ||
      Object.keys(slice).some(
        (key) =>
          ![
            'href',
            'spineIndex',
            'sectionId',
            'characters',
            'htmlStart',
            'htmlEnd',
            'cssStart',
            'cssEnd'
          ].includes(key)
      )
    )
      throw new Error('Invalid EPUB backup resource slice.');
    if (index) {
      if (css[cssOffset] !== '\n') throw new Error('Invalid EPUB backup stylesheet boundary.');
      cssOffset += 1;
    }
    if (
      ![slice.htmlStart, slice.htmlEnd, slice.cssStart, slice.cssEnd].every(Number.isSafeInteger) ||
      slice.htmlStart !== htmlOffset ||
      slice.htmlEnd <= htmlOffset ||
      slice.htmlEnd > html.length ||
      slice.cssStart !== cssOffset ||
      slice.cssEnd < cssOffset ||
      slice.cssEnd > css.length
    )
      throw new Error('Invalid EPUB backup resource boundary.');
    htmlOffset = slice.htmlEnd;
    cssOffset = slice.cssEnd;
    return {
      href: slice.href,
      spineIndex: slice.spineIndex,
      sectionId: slice.sectionId,
      characters: slice.characters,
      html: html.slice(slice.htmlStart, slice.htmlEnd),
      styleSheet: css.slice(slice.cssStart, slice.cssEnd)
    };
  });
  if (htmlOffset !== html.length || cssOffset !== css.length)
    throw new Error('Invalid EPUB backup trailing content.');
  const publication = { version: 1 as const, resources };
  validateEpubPublication(publication);
  return publication;
}
