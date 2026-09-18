/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { LoadData } from '../types';
import extractEpub from './extract-epub';
import generateEpubHtml from './generate-epub-html';
import generateEpubStyleSheet from './generate-epub-style-sheet';
import getEpubCoverImageFilename from './get-epub-cover-image-filename';
import { isOPFType } from './types';
import reduceObjToBlobs from '../utils/reduce-obj-to-blobs';
import { sanitizeArchiveMarkup } from '$lib/manabi/sanitize-book';

export default async function loadEpub(
  file: File,
  document: Document,
  lastBookModified: number
): Promise<LoadData> {
  const { contents, result: data, contentsDirectory } = await extractEpub(file);
  sanitizeArchiveMarkup(data);
  const result = generateEpubHtml(data, contents, document, contentsDirectory);
  const displayData = {
    title: file.name,
    language: '',
    hasThumb: true,
    styleSheet: generateEpubStyleSheet(data, contents)
  };
  const metadata = isOPFType(contents)
    ? contents['opf:package']['opf:metadata']
    : contents.package.metadata;
  if (metadata) {
    const languageValues = Array.isArray(metadata['dc:language']) ? metadata['dc:language'] : [metadata['dc:language']];
    const titleValues = Array.isArray(metadata['dc:title']) ? metadata['dc:title'] : [metadata['dc:title']];
    for (const dcTitle of titleValues) {
      if (typeof dcTitle === 'string') { displayData.title = dcTitle; break; }
      if (dcTitle && typeof dcTitle['#text'] === 'string') { displayData.title = dcTitle['#text']; break; }
    }
    const languages: string[] = [];
    for (const dcLanguage of languageValues) {
      const value = typeof dcLanguage === 'string' ? dcLanguage : dcLanguage?.['#text'];
      if (typeof value === 'string') {
        try { languages.push(...Intl.getCanonicalLocales(value.trim())); } catch { /* Ignore invalid language metadata. */ }
      }
    }
    displayData.language = languages[0] || '';
  }
  if (!displayData.language) displayData.language = 'ja';
  const blobData = reduceObjToBlobs(data);
  const coverImageFilename = await getEpubCoverImageFilename(blobData, contents);
  const coverImage = coverImageFilename ? blobData[coverImageFilename] : undefined;
  return {
    ...displayData,
    elementHtml: result.element.innerHTML,
    blobs: blobData,
    coverImage,
    characters: result.characters,
    sections: result.sections,
    lastBookModified,
    lastBookOpen: 0
  };
}
