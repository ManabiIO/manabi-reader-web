/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { EPUB } from '$lib/vendor/foliate/epub.js';
import type { LimitedArchive } from '../utils/limited-archive';
import { resolveArchivePath } from '../utils/limited-archive';
import type {
  EpubContent,
  EpubCreator,
  EpubManifestItem,
  EpubMetadataMeta,
  EpubSpineItemRef
} from './types';

export interface FoliatePackageMetadata {
  title: string;
  language: string;
  creators: EpubCreator[];
  identifier?: string;
  description?: string;
  publisher?: string;
  published?: string;
  subjects?: string[];
  series?: { name: string; position?: string | number }[];
}

export interface FoliatePackageSnapshot {
  contents: EpubContent;
  contentsDirectory: '.';
  metadata: FoliatePackageMetadata;
  toc: unknown[];
  pageList: unknown[];
  landmarks: unknown[];
  rendition: Record<string, unknown>;
}

function languageMapValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  for (const candidate of Object.values(value as Record<string, unknown>)) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
  }
  return '';
}

function contributorName(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  return languageMapValue((value as { name?: unknown }).name);
}

function creatorFromFoliate(value: unknown): EpubCreator | undefined {
  const text = contributorName(value);
  if (!text) return;
  const object = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const roles = Array.isArray(object.role)
    ? object.role.filter((role): role is string => typeof role === 'string' && !!role)
    : [];
  const sortAs = languageMapValue(object.sortAs);
  return {
    '#text': text,
    ...(roles[0] ? { '@_role': roles[0] } : {}),
    ...(sortAs ? { '@_file-as': sortAs } : {})
  };
}

function metadataValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const resolved = metadataValue(item);
      if (resolved) return resolved;
    }
    return;
  }
  if (value && typeof value === 'object') {
    const named = contributorName(value);
    if (named) return named;
  }
}

function manifestItem(item: Record<string, unknown>): EpubManifestItem {
  return {
    '@_href': String(item.href ?? ''),
    '@_id': String(item.id ?? ''),
    '@_media-type': String(item.mediaType ?? ''),
    ...(Array.isArray(item.properties) && item.properties.length
      ? { '@_properties': item.properties.join(' ') }
      : {}),
    ...(typeof item.fallback === 'string' && item.fallback
      ? { '@_fallback': item.fallback }
      : {})
  };
}

function spineItem(item: Record<string, unknown>): EpubSpineItemRef {
  return {
    '@_idref': String(item.idref ?? ''),
    ...(typeof item.linear === 'string' && item.linear ? { '@_linear': item.linear } : {})
  };
}

function archiveName(name: string): string {
  return resolveArchivePath('', name);
}

/**
 * Parse a conforming EPUB package with Foliate while retaining Manabi's
 * bounded archive ownership. Missing optional package files resolve to null;
 * invalid paths and bounded-read failures remain hard errors.
 */
export async function parseFoliatePackage(
  archive: LimitedArchive,
  signal?: AbortSignal
): Promise<FoliatePackageSnapshot> {
  const optionalText = async (name: string): Promise<string | null> => {
    signal?.throwIfAborted();
    const path = archiveName(name);
    if (!archive.entries.has(path)) return null;
    const value = await archive.readText(path);
    signal?.throwIfAborted();
    return value;
  };
  const optionalBlob = async (name: string): Promise<Blob | null> => {
    signal?.throwIfAborted();
    const path = archiveName(name);
    if (!archive.entries.has(path)) return null;
    const value = await archive.readBlob(path);
    signal?.throwIfAborted();
    return value;
  };
  const getSize = (name: string): number => {
    const path = archiveName(name);
    return archive.entries.get(path)?.uncompressedSize ?? 0;
  };

  const book = new EPUB({
    loadText: optionalText,
    loadBlob: optionalBlob,
    getSize
  });
  try {
    await book.init();
    signal?.throwIfAborted();

    const manifest = (book.resources?.manifest ?? []).map((item: Record<string, unknown>) =>
      manifestItem(item)
    );
    const spine = (book.resources?.spine ?? []).map((item: Record<string, unknown>) =>
      spineItem(item)
    );
    if (!manifest.length || !spine.length) throw new Error('EPUB package has no readable spine');

    const rawMetadata = (book.metadata ?? {}) as Record<string, unknown>;
    const title = languageMapValue(rawMetadata.title);
    const languages = Array.isArray(rawMetadata.language)
      ? rawMetadata.language.filter((value: unknown): value is string => typeof value === 'string')
      : [];
    const authors = Array.isArray(rawMetadata.author) ? rawMetadata.author : [];
    const creators = authors
      .map(creatorFromFoliate)
      .filter((creator): creator is EpubCreator => !!creator);
    const seriesSource = (rawMetadata.belongsTo as { series?: unknown } | undefined)?.series;
    const series = (Array.isArray(seriesSource) ? seriesSource : seriesSource ? [seriesSource] : [])
      .map((item) => {
        if (!item || typeof item !== 'object') return;
        const record = item as Record<string, unknown>;
        const name = languageMapValue(record.name);
        if (!name) return;
        return {
          name,
          ...(typeof record.position === 'string' || typeof record.position === 'number'
            ? { position: record.position }
            : {})
        };
      })
      .filter((item): item is { name: string; position?: string | number } => !!item);

    const metadata: FoliatePackageMetadata = {
      title,
      language: languages[0] ?? '',
      creators,
      ...(typeof rawMetadata.identifier === 'string'
        ? { identifier: rawMetadata.identifier }
        : {}),
      ...(typeof rawMetadata.description === 'string'
        ? { description: rawMetadata.description }
        : {}),
      ...(metadataValue(rawMetadata.publisher)
        ? { publisher: metadataValue(rawMetadata.publisher) }
        : {}),
      ...(typeof rawMetadata.published === 'string' ? { published: rawMetadata.published } : {}),
      ...(Array.isArray(rawMetadata.subject)
        ? {
            subjects: rawMetadata.subject
              .map(metadataValue)
              .filter((value): value is string => !!value)
          }
        : {}),
      ...(series.length ? { series } : {})
    };

    const coverId =
      typeof book.resources?.cover?.id === 'string' && book.resources.cover.id
        ? book.resources.cover.id
        : undefined;
    const compatMetadata: EpubContent['package']['metadata'] = {
      'dc:title': title,
      'dc:language': metadata.language,
      ...(creators.length ? { 'dc:creator': creators } : {}),
      meta: [
        ...(coverId
          ? ([{ '@_name': 'cover', '@_content': coverId }] as EpubMetadataMeta[])
          : [])
      ]
    };

    return {
      contents: {
        package: {
          metadata: compatMetadata,
          manifest: { item: manifest },
          spine: {
            ...(typeof book.dir === 'string' && book.dir
              ? { '@_page-progression-direction': book.dir }
              : {}),
            itemref: spine
          }
        }
      },
      contentsDirectory: '.',
      metadata,
      toc: Array.isArray(book.toc) ? book.toc : [],
      pageList: Array.isArray(book.pageList) ? book.pageList : [],
      landmarks: Array.isArray(book.landmarks) ? book.landmarks : [],
      rendition:
        book.rendition && typeof book.rendition === 'object'
          ? { ...(book.rendition as Record<string, unknown>) }
          : {}
    };
  } finally {
    book.destroy?.();
  }
}
