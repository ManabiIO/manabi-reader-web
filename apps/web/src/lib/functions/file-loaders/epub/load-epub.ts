/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { sanitizeBookStyleSheet } from '../../book-security/book-content-security';
import type { LoadData } from '../types';
import extractEpub from './extract-epub';
import generateEpubHtml from './generate-epub-html';
import generateEpubStyleSheet from './generate-epub-style-sheet';
import getEpubCoverImageFilename from './get-epub-cover-image-filename';
import { isOPFType } from './types';
import { epubDirection } from './epub-direction';
import reduceObjToBlobs from '../utils/reduce-obj-to-blobs';
import { extractCreators, type BookCreator } from '$lib/library/book-metadata';

export default async function loadEpub(
  file: File,
  document: Document,
  lastBookModified: number,
  signal?: AbortSignal
): Promise<LoadData> {
  const { contents, result: data, contentsDirectory } = await extractEpub(file, { signal });
  const result = generateEpubHtml(data, contents, document, contentsDirectory);

  const displayData: {
    title: string;
    creators: BookCreator[];
    language: string;
    hasThumb: true;
    styleSheet: string;
  } = {
    title: file.name,
    creators: [],
    language: '',
    hasThumb: true,
    styleSheet: sanitizeBookStyleSheet(
      generateEpubStyleSheet(data, contents) + '\n' + result.styleSheet,
      document
    )
  };

  const metadata = isOPFType(contents)
    ? contents['opf:package']['opf:metadata']
    : contents.package.metadata;

  if (metadata) {
    displayData.creators = extractCreators(metadata as unknown as Record<string, unknown>);
    const languageValues = Array.isArray(metadata['dc:language'])
      ? metadata['dc:language']
      : [metadata['dc:language']];
    const titleValues = Array.isArray(metadata['dc:title'])
      ? metadata['dc:title']
      : [metadata['dc:title']];

    for (const dcTitle of titleValues) {
      if (typeof dcTitle === 'string') {
        displayData.title = dcTitle;
        break;
      } else if (dcTitle && dcTitle['#text']) {
        displayData.title = dcTitle['#text'];
        break;
      }
    }

    displayData.language =
      languageValues.reduce((languages, dcLanguage) => {
        try {
          if (typeof dcLanguage === 'string') {
            languages.push(...Intl.getCanonicalLocales(dcLanguage.trim()));
          } else if (dcLanguage && dcLanguage['#text']) {
            languages.push(...Intl.getCanonicalLocales(String(dcLanguage['#text']).trim()));
          }
        } catch (_) {
          //no-op
        }

        return languages;
      }, [])?.[0] || '';
  }

  if (!displayData.language) {
    displayData.language = 'ja';
    console.warn(`no language data found for ${file.name} - fallback to ja`);
  }

  const blobData = reduceObjToBlobs(data);
  const coverImageFilename = await getEpubCoverImageFilename(blobData, contents);
  let coverImage: Blob | undefined;

  if (coverImageFilename) {
    coverImage = blobData[coverImageFilename];
  }

  return {
    ...displayData,
    pageDirection: epubDirection(contents, data, document),
    elementHtml: result.element.innerHTML,
    blobs: blobData,
    coverImage,
    characters: result.characters,
    sections: result.sections,
    lastBookModified,
    lastBookOpen: 0
  };
}
