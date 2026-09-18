/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { LoadData } from '../types';
import { XMLParser } from 'fast-xml-parser';
import extractHtmlz from './extract-htmlz';
import { getFormattedElementHtmlz } from './generate-htmlz-html';
import getHtmlzCoverImageFilename from './get-htmlz-cover-image-filename';
import reduceObjToBlobs from '../utils/reduce-obj-to-blobs';
import { sanitizeArchiveMarkup } from '$lib/manabi/sanitize-book';

export default async function loadHtmlz(
  file: File,
  document: Document,
  lastBookModified: number
): Promise<LoadData> {
  const data = sanitizeArchiveMarkup(await extractHtmlz(file));
  const element = getFormattedElementHtmlz(data, document);
  const metadata = new XMLParser().parse(data['metadata.opf'])?.package?.metadata;
  const title = typeof metadata?.['dc:title'] === 'string' ? metadata['dc:title'] : file.name;
  const blobData = reduceObjToBlobs(data);
  const coverImageFilename = getHtmlzCoverImageFilename();
  const coverImage = coverImageFilename ? blobData[coverImageFilename] : undefined;
  if (coverImageFilename) delete blobData[coverImageFilename];
  return {
    title,
    hasThumb: true,
    styleSheet: data['style.css'],
    elementHtml: element.innerHTML,
    blobs: blobData,
    coverImage,
    characters: 0,
    lastBookModified,
    lastBookOpen: 0
  };
}
