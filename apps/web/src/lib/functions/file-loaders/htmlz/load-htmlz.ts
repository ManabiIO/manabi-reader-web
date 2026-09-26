/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { sanitizeBookStyleSheet } from '../../book-security/book-content-security';
import type { LoadData } from '../types';
import { XMLParser } from 'fast-xml-parser';
import extractHtmlz from './extract-htmlz';
import { getFormattedElementHtmlz } from './generate-htmlz-html';
import getHtmlzCoverImageFilename from './get-htmlz-cover-image-filename';
import reduceObjToBlobs from '../utils/reduce-obj-to-blobs';
import { extractCreators, type BookCreator } from '$lib/library/book-metadata';

export default async function loadHtmlz(
  file: File,
  document: Document,
  lastBookModified: number,
  signal?: AbortSignal
): Promise<LoadData> {
  const data = await extractHtmlz(file, { signal });
  const embeddedStyles: string[] = [];
  const element = getFormattedElementHtmlz(data, document, embeddedStyles);
  const parser = new XMLParser({ ignoreAttributes: false, processEntities: false });
  const metadata = parser.parse(data['metadata.opf'])?.package?.metadata;

  const displayData: {
    title: string;
    creators?: BookCreator[];
    hasThumb: true;
    styleSheet: string;
  } = {
    title: file.name,
    hasThumb: true,
    styleSheet: sanitizeBookStyleSheet(
      data['style.css'] + '\n' + embeddedStyles.join('\n'),
      document
    )
  };
  if (metadata) {
    const title = Array.isArray(metadata['dc:title'])
      ? metadata['dc:title'][0]
      : metadata['dc:title'];
    const titleText = typeof title === 'string' ? title : title?.['#text'];
    if (typeof titleText === 'string' && titleText.trim()) displayData.title = titleText.trim();
    const creators = extractCreators(metadata as Record<string, unknown>);
    if (creators.length) displayData.creators = creators;
  }
  const blobData = reduceObjToBlobs(data);
  const coverImageFilename = getHtmlzCoverImageFilename();
  let coverImage: Blob | undefined;

  if (coverImageFilename) {
    coverImage = blobData[coverImageFilename];
    delete blobData[coverImageFilename];
  }

  return {
    ...displayData,
    sourceFormat: 'htmlz',
    // Reader pagination treats each top-level element as a section and renders
    // its innerHTML. Keep the complete HTMLZ body inside one section so root
    // text, paragraph/heading semantics and following siblings are preserved.
    elementHtml: element.outerHTML,
    publicationManifest: {
      version: 1,
      resources: [{ href: 'htmlz:body', spineIndex: 0, sectionId: element.id || 'section-0' }]
    },
    blobs: blobData,
    coverImage,
    characters: 0,
    lastBookModified,
    lastBookOpen: 0
  };
}
