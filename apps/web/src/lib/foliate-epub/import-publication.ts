/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { openFoliateEpub } from './open-foliate-epub';
import type { FoliateManifestItem, FoliateNavigationItem } from './epub.js';
import {
  packEpubResources,
  epubPublicationManifest,
  type EpubResourceData
} from './publication-data';
import { epubCompatibilityStyles } from './resource-styles';
import { repairEpubHtml } from './html-repair';
import {
  sanitizeBookHtml,
  sanitizeBookStyleSheet
} from '../functions/book-security/book-content-security';
import { resolveArchivePath } from '../functions/file-loaders/utils/limited-archive';
import buildDummyBookImage from '../functions/file-loaders/utils/build-dummy-book-image';
import { resolveEpubLinkTarget } from '../functions/file-loaders/epub/epub-link-target';
import { getParagraphNodes } from '../components/book-reader/get-paragraph-nodes';
import { getCharacterCount } from '../functions/get-character-count';
import { extractCreators } from '../library/book-metadata';
import { epubDirection } from '../functions/file-loaders/epub/epub-direction';
import type { EpubContent } from '../functions/file-loaders/epub/types';
import type { LoadData } from '../functions/file-loaders/types';

const htmlTypes = new Set(['application/xhtml+xml', 'text/html']);
const imageTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/avif',
  'image/svg+xml'
]);
const values = (value: unknown): unknown[] =>
  value == null ? [] : Array.isArray(value) ? value : [value];
const text = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  return Object.values(value).find((item): item is string => typeof item === 'string') ?? '';
};

function readableItem(
  item: FoliateManifestItem | undefined,
  items: Map<string, FoliateManifestItem>
): FoliateManifestItem {
  const seen = new Set<string>();
  while (item && !htmlTypes.has(item.mediaType)) {
    if (seen.has(item.id)) throw new Error('EPUB manifest contains a fallback cycle.');
    seen.add(item.id);
    item = item.fallback ? items.get(item.fallback) : undefined;
  }
  if (!item) throw new Error('EPUB spine has no supported local chapter.');
  return item;
}

function chapterLabels(toc: FoliateNavigationItem[] | undefined): Map<string, string> {
  const result = new Map<string, string>();
  const queue = [...(toc ?? [])];
  let count = 0;
  while (queue.length) {
    if (++count > 20000) throw new Error('EPUB navigation exceeds the size limit.');
    const item = queue.shift()!;
    if (item.href && item.label) {
      try {
        const href = resolveArchivePath('', item.href);
        if (!result.has(href)) result.set(href, item.label.slice(0, 4096));
      } catch {
        // An external navigation label does not identify a local spine resource.
      }
    }
    if (item.subitems) queue.unshift(...item.subitems);
  }
  return result;
}

function copyRootAttributes(source: Element, target: HTMLElement): void {
  // These attributes have already crossed the HTML sanitizer, including style.
  for (const name of [
    'id',
    'class',
    'style',
    'lang',
    'xml:lang',
    'dir',
    'hidden',
    'aria-hidden'
  ]) {
    const value = source.getAttribute(name);
    if (value !== null) target.setAttribute(name, value);
  }
}

/**
 * Foliate owns package/spine parsing. The Web boundary owns inert resource
 * preparation and persistence; no raw publication is ever attached to a frame.
 * elementHtml is a derived compatibility/search/export projection, not the
 * input to new EPUB pagination. Existing saved books need no eager migration.
 */
export async function importEpubPublication(
  file: File,
  document: Document,
  lastBookModified: number,
  options: { signal?: AbortSignal; repairMode: string; anchorsOnly: boolean }
): Promise<LoadData> {
  const { signal } = options;
  const publication = await openFoliateEpub(file, { signal });
  let failed = false;
  try {
    const { book } = publication;
    const items = book.resources.manifest;
    const byId = new Map(items.map((item) => [item.id, item]));
    const byHref = new Map(items.map((item) => [item.href, item]));
    if (byId.size !== items.length || byHref.size !== items.length)
      throw new Error('EPUB manifest contains duplicate resources.');
    const spine = book.resources.spine.map((ref) => readableItem(byId.get(ref.idref), byId));
    const resources: EpubResourceData[] = spine.map((item, spineIndex) => ({
      href: item.href,
      spineIndex,
      sectionId: `ttu-epub-${spineIndex}`,
      html: '',
      styleSheet: ''
    }));
    const manifest = epubPublicationManifest({ resources });
    const labels = chapterLabels(book.toc);
    const sourceText = new Map<string, string>();
    const readText = async (href: string): Promise<string> => {
      signal?.throwIfAborted();
      if (sourceText.has(href)) return sourceText.get(href)!;
      const value = await publication.readText(href);
      if (value === null) throw new Error(`EPUB resource is missing: ${href}`);
      sourceText.set(href, value);
      return value;
    };
    const blobs: Record<string, Blob> = Object.create(null);
    const imagePaths = new Map<string, string>();
    // Keep current gallery behavior (all declared illustrations), but never
    // decode audio, scripts, fonts or arbitrary non-EPUB manifest payloads.
    for (const item of items) {
      signal?.throwIfAborted();
      if (!imageTypes.has(item.mediaType)) continue;
      const value = await publication.readBlob(item.href);
      if (!value) throw new Error(`EPUB image is missing: ${item.href}`);
      blobs[item.href] =
        item.mediaType === 'image/svg+xml'
          ? new Blob([sanitizeBookHtml(await value.text(), { document, svgOnly: true })], {
              type: item.mediaType
            })
          : new Blob([value], { type: item.mediaType });
      imagePaths.set(item.href, buildDummyBookImage(item.href));
    }
    const imageUrls = new Set(imagePaths.values());
    let rawSize = 0;
    let totalCharacters = 0;
    const sections: NonNullable<LoadData['sections']> = [];
    let mainChapter: (typeof sections)[number] | undefined;
    for (const [index, item] of spine.entries()) {
      signal?.throwIfAborted();
      const raw = repairEpubHtml(await readText(item.href), options.repairMode, options.anchorsOnly);
      rawSize += raw.length;
      if (rawSize > 32 * 1024 * 1024)
        throw new Error('EPUB expanded reading content exceeds the size limit.');
      // Preserve linked/inline cascade order, including malformed HTML handled
      // by the existing inert sanitizer. Removed links are never attached/fetched.
      const styleSources: Array<{ css: string } | { href: string }> = [];
      const safe = sanitizeBookHtml(raw, {
        document,
        wholeDocument: true,
        resolveImage: (href) => imagePaths.get(resolveArchivePath(item.href, href)),
        onEmbeddedStyle: (css) => styleSources.push({ css }),
        onStyleSheetReference: (href) => styleSources.push({ href })
      });
      const styles: string[] = [];
      for (const source of styleSources) {
        if ('css' in source) styles.push(source.css);
        else {
          let href: string;
          try {
            href = resolveArchivePath(item.href, source.href);
          } catch {
            continue; // External/unsafe stylesheets are never fetched.
          }
          if (byHref.get(href)?.mediaType === 'text/css') styles.push(await readText(href));
        }
      }
      const chapter = new DOMParser().parseFromString(safe, 'text/html');
      if (!chapter.body) throw new Error('EPUB resource has no readable body.');
      const resource = resources[index];
      const section = document.createElement('div');
      section.id = resource.sectionId;
      const html = document.createElement('div');
      copyRootAttributes(chapter.documentElement, html);
      html.classList.add('ttu-book-html-wrapper');
      const body = document.createElement('div');
      copyRootAttributes(chapter.body, body);
      body.classList.add('ttu-book-body-wrapper');
      body.innerHTML = chapter.body.innerHTML;
      html.append(body);
      section.append(html);
      for (const anchor of section.querySelectorAll('a[href]')) {
        const target = resolveEpubLinkTarget(
          item.href,
          anchor.getAttribute('href')!,
          manifest.resources,
          index
        );
        if (!target) {
          anchor.removeAttribute('href');
          continue;
        }
        anchor.setAttribute('data-manabi-target-spine-index', String(target.spineIndex));
        if (target.fragment) anchor.setAttribute('data-manabi-target-fragment', target.fragment);
        anchor.setAttribute('href', `#${target.fragment ?? resources[target.spineIndex].sectionId}`);
      }
      const characters = getParagraphNodes(section).reduce(
        (count, node) => count + getCharacterCount(node),
        0
      );
      if (!characters) {
        html.classList.add('ttu-no-text');
        body.classList.add('ttu-no-text');
      }
      const label = labels.get(item.href);
      if (label || !mainChapter || !labels.size) {
        mainChapter = {
          reference: resource.sectionId,
          label: label ?? (labels.size ? 'Preface' : `Section ${index + 1}`),
          charactersWeight: characters || 1,
          startCharacter: totalCharacters,
          characters
        };
        sections.push(mainChapter);
      } else {
        mainChapter.characters = (mainChapter.characters ?? 0) + characters;
        sections.push({
          reference: resource.sectionId,
          charactersWeight: characters || 1,
          parentChapter: mainChapter.reference
        });
      }
      totalCharacters += characters;
      resource.html = sanitizeBookHtml(section.outerHTML, {
        document,
        imageUrls,
        preserveReaderLinks: true
      });
      resource.styleSheet = sanitizeBookStyleSheet(styles.join('\n'), document);
    }
    const { elementHtml, epubPublication } = packEpubResources(resources);
    const metadata = book.metadata ?? {};
    const creators = extractCreators({
      'dc:creator': values(metadata.author).map((value) => {
        const entry = typeof value === 'object' && value ? (value as Record<string, unknown>) : {};
        return { '#text': text(entry.name ?? value), '@_role': 'aut', '@_file-as': text(entry.sortAs) };
      })
    });
    let language = 'ja';
    for (const value of values(metadata.language)) {
      if (typeof value !== 'string') continue;
      try {
        language = Intl.getCanonicalLocales(value.trim())[0] || language;
        break;
      } catch {
        // Try the next language.
      }
    }
    // Reuse the established authored-direction evidence, including its inert
    // content sampling when page-progression-direction is not declared.
    const directionContents: EpubContent = {
      package: {
        metadata: { 'dc:title': '', 'dc:language': language },
        manifest: {
          item: items.map((entry) => ({
            '@_id': entry.id,
            '@_href': entry.href,
            '@_media-type': entry.mediaType,
            '@_properties': entry.properties?.join(' ')
          }))
        },
        spine: {
          '@_page-progression-direction': book.dir,
          itemref: spine.map((entry) => ({ '@_idref': entry.id }))
        }
      }
    };
    const directionSources = Object.fromEntries(sourceText);
    signal?.throwIfAborted();
    return {
      title: (text(metadata.title) || file.name).slice(0, 4096),
      creators,
      language,
      sourceFormat: 'epub',
      hasThumb: true,
      coverImage: book.resources.cover ? blobs[book.resources.cover.href] : undefined,
      blobs,
      characters: totalCharacters,
      sections,
      publicationManifest: manifest,
      epubPublication,
      elementHtml,
      styleSheet: epubCompatibilityStyles(resources, document),
      pageDirection: epubDirection(directionContents, directionSources, document),
      lastBookModified,
      lastBookOpen: 0
    };
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      await publication.close();
    } catch (error) {
      // Preserve an import failure, but do not hide a close failure after success.
      if (!failed) throw error;
    }
  }
}
