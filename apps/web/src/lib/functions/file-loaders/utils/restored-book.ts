/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  readEpubPublication,
  epubPublicationManifest,
  assertEpubManifest,
  type EpubPublicationData
} from '$lib/foliate-epub/publication-data';
import type { PublicationManifest } from '$lib/reader-location';
import type { Section } from '$lib/data/database/books-db/versions/v4/books-db-v4';
import { LimitedArchive, type ArchiveOptions } from './limited-archive';
import { validDirectionEvidence, type DirectionEvidence } from '$lib/library/direction';
import { validCreators, type BookCreator } from '$lib/library/book-metadata';

export interface RestoredContent {
  title: string;
  elementHtml: string;
  styleSheet: string;
  sections: Section[];
  htmlBackup?: string;
  language?: string;
  creators?: BookCreator[];
  pageDirection?: DirectionEvidence;
  contentHash?: string;
  sourceFormat?: 'epub' | 'htmlz' | 'txt';
  publicationManifest?: PublicationManifest;
  epubPublication?: EpubPublicationData;
  blobs: Record<string, Blob>;
  coverImage?: Blob;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readMetadata(value: unknown): Omit<RestoredContent, 'blobs' | 'coverImage'> {
  if (
    !object(value) ||
    typeof value.title !== 'string' ||
    !value.title ||
    value.title.length > 4096 ||
    typeof value.elementHtml !== 'string' ||
    !value.elementHtml
  )
    throw new Error('Invalid restored book metadata');
  for (const field of ['styleSheet', 'htmlBackup', 'language'] as const) {
    if (value[field] !== undefined && typeof value[field] !== 'string')
      throw new Error(`Invalid restored book ${field}`);
  }
  if (typeof value.language === 'string' && value.language.length > 128)
    throw new Error('Invalid restored book language');
  if (value.pageDirection !== undefined && !validDirectionEvidence(value.pageDirection))
    throw new Error('Invalid restored book page direction');
  if (
    value.contentHash !== undefined &&
    (typeof value.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.contentHash))
  )
    throw new Error('Invalid restored book content identity');
  const sections: Section[] = [];
  if (value.sections !== undefined) {
    if (!Array.isArray(value.sections) || value.sections.length > 8192)
      throw new Error('Invalid restored book sections');
    for (const section of value.sections) {
      if (
        !object(section) ||
        typeof section.reference !== 'string' ||
        section.reference.length > 4096 ||
        typeof section.charactersWeight !== 'number' ||
        !Number.isFinite(section.charactersWeight) ||
        section.charactersWeight < 0
      )
        throw new Error('Invalid restored book section');
      for (const field of ['startCharacter', 'characters'] as const) {
        const v = section[field];
        if (v !== undefined && (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0))
          throw new Error('Invalid restored book character count');
      }
      for (const field of ['label', 'parentChapter'] as const) {
        const v = section[field];
        if (v !== undefined && (typeof v !== 'string' || v.length > 4096))
          throw new Error('Invalid restored book section label');
      }
      // Do not spread arbitrary restored keys into the application model.
      sections.push({
        reference: section.reference,
        charactersWeight: section.charactersWeight,
        ...(section.label === undefined ? {} : { label: section.label as string }),
        ...(section.parentChapter === undefined
          ? {}
          : { parentChapter: section.parentChapter as string }),
        ...(section.startCharacter === undefined
          ? {}
          : { startCharacter: section.startCharacter as number }),
        ...(section.characters === undefined ? {} : { characters: section.characters as number })
      });
    }
  }
  let publicationManifest: PublicationManifest | undefined;
  if (value.publicationManifest !== undefined) {
    const manifest = value.publicationManifest;
    if (
      !object(manifest) ||
      manifest.version !== 1 ||
      !Array.isArray(manifest.resources) ||
      manifest.resources.length > 8192
    )
      throw new Error('Invalid restored publication manifest');
    publicationManifest = {
      version: 1,
      resources: manifest.resources.map((resource, index) => {
        if (
          !object(resource) ||
          resource.spineIndex !== index ||
          typeof resource.href !== 'string' ||
          !resource.href ||
          resource.href.length > 2048 ||
          typeof resource.sectionId !== 'string' ||
          resource.sectionId.length > 512
        )
          throw new Error('Invalid restored publication resource');
        return { href: resource.href, spineIndex: index, sectionId: resource.sectionId };
      })
    };
  }
  const epubPublication =
    value.epubPublication === undefined
      ? undefined
      : readEpubPublication(value.epubPublication, value.elementHtml);
  if (epubPublication) {
    publicationManifest ??= epubPublicationManifest(epubPublication);
    assertEpubManifest(epubPublication, publicationManifest);
    if (value.sourceFormat !== undefined && value.sourceFormat !== 'epub')
      throw new Error('Restored EPUB resources have a different source format');
  }
  const sourceFormat = epubPublication
    ? 'epub'
    : ['epub', 'htmlz', 'txt'].includes(value.sourceFormat as string)
      ? (value.sourceFormat as 'epub' | 'htmlz' | 'txt')
      : undefined;
  return {
    ...(sourceFormat ? { sourceFormat } : {}),
    ...(publicationManifest ? { publicationManifest } : {}),
    ...(epubPublication ? { epubPublication } : {}),
    title: value.title,
    elementHtml: value.elementHtml,
    styleSheet: (value.styleSheet as string) || '',
    sections,
    ...(value.htmlBackup === undefined ? {} : { htmlBackup: value.htmlBackup as string }),
    ...(value.language === undefined ? {} : { language: value.language as string }),
    ...(validCreators(value.creators) ? { creators: value.creators as BookCreator[] } : {}),
    ...(value.pageDirection === undefined
      ? {}
      : { pageDirection: value.pageDirection as DirectionEvidence }),
    ...(value.contentHash === undefined ? {} : { contentHash: value.contentHash as string })
  };
}

/** All providers use this decoder; no raw zip.js extraction bypass remains. */
export async function readRestoredBook(
  blob: Blob,
  mimeForImage: (name: string) => string,
  options: ArchiveOptions = {},
  progress: () => void = () => {}
): Promise<RestoredContent | undefined> {
  const archive = await LimitedArchive.open(blob, { ...options, literalNames: true });
  try {
    const entries = [...archive.entries.values()].filter((entry) => !entry.directory);
    if (!entries.length) return undefined;
    // Validate the complete metadata before retaining images or writing a book.
    const metadata = readMetadata(JSON.parse(await archive.readText('staticdata.json')));
    progress();
    const result: RestoredContent = { ...metadata, blobs: Object.create(null) };
    const covers = entries.filter((entry) => entry.filename.startsWith('cover.'));
    if (covers.length > 1) throw new Error('Restored book has multiple covers');
    await archive.map(
      entries.filter((entry) => entry.filename !== 'staticdata.json'),
      async (entry) => {
        const name = entry.filename;
        if (name.startsWith('blobs/')) {
          const key = name.slice('blobs/'.length);
          result.blobs[key] = await archive.readBlob(name, mimeForImage(key));
        } else if (name.startsWith('cover.')) {
          result.coverImage = await archive.readBlob(name, mimeForImage(name));
        }
        progress();
      }
    );
    options.signal?.throwIfAborted();
    return result;
  } finally {
    await archive.close();
  }
}
