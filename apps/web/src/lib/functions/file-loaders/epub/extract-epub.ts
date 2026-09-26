/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { isOPFType, type EpubContent, type EpubOPFContent } from './types';
import { XMLParser } from 'fast-xml-parser';
import initZipSettings from '../utils/init-zip-settings';
import {
  ArchiveLimitError,
  LimitedArchive,
  resolveArchivePath,
  type ArchiveOptions
} from '../utils/limited-archive';
import path from 'path-browserify';
import {
  parseFoliatePackage,
  type FoliatePackageMetadata
} from './foliate-package';

initZipSettings();

interface PackageParse {
  contentsDirectory: string;
  contents: EpubContent | EpubOPFContent;
  contentOpfFilename: string;
  packageMetadata?: FoliatePackageMetadata;
  navigation?: {
    toc: unknown[];
    pageList: unknown[];
    landmarks: unknown[];
    rendition: Record<string, unknown>;
  };
  parser: 'foliate' | 'legacy';
}

async function parseLegacyPackage(archive: LimitedArchive): Promise<PackageParse> {
  const parser = new XMLParser({ ignoreAttributes: false, processEntities: false });
  const containerXml = await archive.readText('META-INF/container.xml', 1024 * 1024);
  const rootFiles = parser.parse(containerXml)?.container?.rootfiles?.rootfile;
  const rootFile = Array.isArray(rootFiles) ? rootFiles[0] : rootFiles;
  const contentOpfFilename = resolveArchivePath('', rootFile?.['@_full-path']);
  const contentsXml = await archive.readText(contentOpfFilename, 4 * 1024 * 1024);
  const contentsDirectory = path.dirname(contentOpfFilename);
  const contents = parser.parse(contentsXml) as EpubContent | EpubOPFContent;
  return { contentsDirectory, contents, contentOpfFilename, parser: 'legacy' };
}

async function parsePackage(
  archive: LimitedArchive,
  signal?: AbortSignal
): Promise<PackageParse> {
  try {
    const parsed = await parseFoliatePackage(archive, signal);
    return {
      contentsDirectory: parsed.contentsDirectory,
      contents: parsed.contents,
      // Foliate resolves manifest hrefs to archive-root relative paths.
      contentOpfFilename: '',
      packageMetadata: parsed.metadata,
      navigation: {
        toc: parsed.toc,
        pageList: parsed.pageList,
        landmarks: parsed.landmarks,
        rendition: parsed.rendition
      },
      parser: 'foliate'
    };
  } catch (error) {
    if (
      signal?.aborted ||
      error instanceof ArchiveLimitError ||
      (error instanceof DOMException && error.name === 'AbortError')
    )
      throw error;
    // TTU historically accepts a useful set of malformed namespace-less EPUBs.
    // Keep that compatibility path while conforming packages use Foliate.
    return parseLegacyPackage(archive);
  }
}

export default async function extractEpub(
  blob: Blob,
  options: ArchiveOptions & { preview?: boolean } = {}
) {
  const archive = await LimitedArchive.open(blob, options);
  try {
    const result: Record<string, string | Blob> = Object.create(null);
    const {
      contentsDirectory,
      contents,
      contentOpfFilename,
      packageMetadata,
      navigation,
      parser
    } = await parsePackage(archive, options.signal);

    const manifest = isOPFType(contents)
      ? contents['opf:package']?.['opf:manifest']
      : contents.package?.manifest;
    if (!manifest) throw new Error('EPUB package has no manifest');
    const rawItems = 'item' in manifest ? manifest.item : manifest['opf:item'];
    const items = Array.isArray(rawItems) ? rawItems : [rawItems];
    if (
      !items.length ||
      items.length > archive.limits.entryCount ||
      items.some(
        (item) =>
          !item ||
          typeof item['@_href'] !== 'string' ||
          typeof item['@_media-type'] !== 'string' ||
          typeof item['@_id'] !== 'string' ||
          item['@_id'].length === 0 ||
          item['@_id'].length > 512
      )
    ) {
      throw new Error('Invalid EPUB manifest');
    }
    // Preserve the array contract consumed by the existing EPUB formatters.
    if ('item' in manifest) manifest.item = items;
    else manifest['opf:item'] = items;
    const ids = new Set<string>();
    for (const item of items) {
      if (ids.has(item['@_id'])) throw new Error('Duplicate EPUB manifest ID');
      ids.add(item['@_id']);
    }

    let selected = items;
    if (options.preview) {
      const packageData = isOPFType(contents) ? contents['opf:package'] : contents.package;
      const metadata =
        ('metadata' in packageData ? packageData.metadata : packageData['opf:metadata']) ?? {};
      const meta =
        'meta' in metadata
          ? metadata.meta
          : 'opf:meta' in metadata
            ? metadata['opf:meta']
            : undefined;
      const coverIDs = new Set(
        (Array.isArray(meta) ? meta : [meta])
          .filter((m) => m?.['@_name'] === 'cover')
          .map((m) => m!['@_content'])
      );
      const spine = isOPFType(contents)
        ? contents['opf:package']['opf:spine']['opf:itemref']
        : contents.package.spine.itemref;
      const chapterIDs = new Set(
        (Array.isArray(spine) ? spine : [spine])
          .filter((ref) => ref && ref['@_linear'] !== 'no')
          .slice(0, 12)
          .map((ref) => ref['@_idref'])
      );
      const styles = items.filter((item) => item['@_media-type'] === 'text/css').slice(0, 64);
      selected = items.filter(
        (item) =>
          chapterIDs.has(item['@_id']) ||
          styles.includes(item) ||
          item['@_properties']?.split(/\s+/).includes('cover-image') ||
          coverIDs.has(item['@_id'])
      );
    }

    const references = new Set<string>();
    await archive.map(selected, async (item) => {
      const reference = item['@_href'];
      if (references.has(reference))
        throw new Error(`Duplicate EPUB manifest resource: ${reference}`);
      references.add(reference);
      const name =
        parser === 'foliate'
          ? resolveArchivePath('', reference)
          : resolveArchivePath(contentOpfFilename, reference);
      if (options.preview && (archive.entries.get(name)?.uncompressedSize ?? 0) > 8 * 1024 * 1024)
        return;
      result[reference] = item['@_media-type'].startsWith('image/')
        ? await archive.readBlob(name, item['@_media-type'])
        : await archive.readText(name);
    });

    return {
      contentsDirectory,
      contents,
      result,
      packageMetadata,
      navigation,
      parser
    };
  } finally {
    await archive.close();
  }
}
