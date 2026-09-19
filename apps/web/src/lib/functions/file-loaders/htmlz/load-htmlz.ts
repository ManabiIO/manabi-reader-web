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

export default async function loadHtmlz(
  file: File,
  document: Document,
  lastBookModified: number,
  signal?: AbortSignal
): Promise<LoadData> {
  const data = await extractHtmlz(file, { signal });
  const embeddedStyles: string[] = [];
  const element = getFormattedElementHtmlz(data, document, embeddedStyles);
  const parser = new XMLParser({ processEntities: false });
  const metadata = parser.parse(data['metadata.opf'])?.package?.metadata;

  const displayData = {
    title: file.name,
    hasThumb: true,
    styleSheet: sanitizeBookStyleSheet(
      data['style.css'] + '\n' + embeddedStyles.join('\n'),
      document
    )
  };
  if (metadata && metadata['dc:title']) {
    displayData.title = metadata['dc:title'];
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
    // Reader pagination treats each top-level element as a section and renders
    // its innerHTML. Keep the complete HTMLZ body inside one section so root
    // text, paragraph/heading semantics and following siblings are preserved.
    elementHtml: element.outerHTML,
    blobs: blobData,
    coverImage,
    characters: 0,
    lastBookModified,
    lastBookOpen: 0
  };
}
