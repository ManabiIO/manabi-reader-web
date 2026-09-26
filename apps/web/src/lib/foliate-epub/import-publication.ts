/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { openFoliateEpub } from './open-foliate-epub';
import type { FoliateNavigationItem, FoliateManifestItem } from './epub.js';
import {
  epubPublicationHtml,
  epubPublicationManifest,
  validateEpubPublication,
  type EpubPublicationData,
  type EpubResourceData
} from './publication-data';
import { scopeEpubStyleSheet } from './publication-styles';
import { localCssImports } from './css-imports';
import { repairEpubHtml, type EpubImportFixes } from './import-fixes';
import {
  sanitizeBookHtml,
  sanitizeBookStyleSheet
} from '../functions/book-security/book-content-security';
import { resolveArchivePath } from '../functions/file-loaders/utils/limited-archive';
import buildDummyBookImage from '../functions/file-loaders/utils/build-dummy-book-image';
import { getParagraphNodes } from '../components/book-reader/get-paragraph-nodes';
import { getCharacterCount } from '../functions/get-character-count';
import { extractCreators } from '../library/book-metadata';
import { epubDirection } from '../functions/file-loaders/epub/epub-direction';
import { resolveEpubLinkTarget } from '../functions/file-loaders/epub/epub-link-target';
import type {
  EpubContent,
  EpubCreator,
  EpubMetadataMeta
} from '../functions/file-loaders/epub/types';
import type { Section } from '../data/database/books-db/versions/v6/books-db-v6';
import type { LoadData } from '../functions/file-loaders/types';

const MAX_HTML = 32 * 1024 * 1024;
const MAX_CSS = 4 * 1024 * 1024;
const DC = 'http://purl.org/dc/elements/1.1/';
const OPF = 'http://www.idpf.org/2007/opf';
const IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/avif',
  'image/svg+xml'
]);

function packageMetadata(opf: Document): EpubContent['package']['metadata'] {
  const metadata = Array.from(opf.documentElement.children).find(
    (node) => node.localName === 'metadata'
  );
  const dc = (name: string) =>
    Array.from(metadata?.children ?? []).filter(
      (node) => node.localName === name && (node.namespaceURI === DC || !node.namespaceURI)
    );
  const creators: EpubCreator[] = dc('creator').map((node) => ({
    '#text': node.textContent ?? '',
    '@_id': node.getAttribute('id') ?? undefined,
    '@_role': node.getAttributeNS(OPF, 'role') ?? node.getAttribute('role') ?? undefined,
    '@_file-as': node.getAttributeNS(OPF, 'file-as') ?? node.getAttribute('file-as') ?? undefined
  }));
  const meta: EpubMetadataMeta[] = Array.from(metadata?.children ?? [])
    .filter((node) => node.localName === 'meta')
    .map((node) => ({
      '@_name': node.getAttribute('name') ?? undefined,
      '@_content': node.getAttribute('content') ?? undefined,
      '@_refines': node.getAttribute('refines') ?? undefined,
      '@_property': node.getAttribute('property') ?? undefined,
      '#text': node.textContent ?? ''
    }));
  return {
    'dc:title': dc('title')[0]?.textContent?.trim() ?? '',
    'dc:language': dc('language')[0]?.textContent?.trim() ?? '',
    'dc:creator': creators,
    meta
  };
}

function canonicalHref(item: FoliateManifestItem | { id: string }): string {
  return resolveArchivePath('', 'href' in item ? item.href : item.id);
}

function copyRootAttributes(source: Element, target: HTMLElement): void {
  for (const name of ['class', 'id', 'lang', 'xml:lang', 'dir', 'style', 'epub:type']) {
    const value = source.getAttribute(name);
    if (value !== null) target.setAttribute(name, value);
  }
}

function characterCount(element: Element): number {
  return getParagraphNodes(element).reduce((total, node) => total + getCharacterCount(node), 0);
}

function flattenedNavigation(
  items: readonly FoliateNavigationItem[] = []
): FoliateNavigationItem[] {
  const result: FoliateNavigationItem[] = [];
  const visit = (nodes: readonly FoliateNavigationItem[], depth: number) => {
    if (depth > 32 || result.length > 20000)
      throw new Error('EPUB navigation exceeds the size limit.');
    for (const node of nodes) {
      if (result.length >= 20000) throw new Error('EPUB navigation exceeds the size limit.');
      result.push(node);
      if (node.subitems) visit(node.subitems, depth + 1);
    }
  };
  visit(items, 0);
  return result;
}

/**
 * One bounded import creates portable per-spine documents. The archive never
 * feeds raw content into a live reader frame; only sanitized source documents
 * are persisted. Existing continuous/search/export consumers get a derived
 * compatibility projection, not a second parser or a second book identity.
 */
export async function importEpubPublication(
  file: File,
  document: Document,
  lastBookModified: number,
  fixes: EpubImportFixes,
  signal?: AbortSignal
): Promise<LoadData> {
  const publication = await openFoliateEpub(file, { signal });
  try {
    const { book, source } = publication;
    const items = book.resources.manifest;
    const byHref = new Map<string, FoliateManifestItem>();
    for (const item of items) {
      const href = canonicalHref(item);
      if (byHref.has(href)) throw new Error('Duplicate EPUB manifest resource.');
      byHref.set(href, item);
    }
    const metadata = packageMetadata(book.resources.opf);
    let language = '';
    try {
      language = Intl.getCanonicalLocales(String(metadata['dc:language']).trim())[0] ?? '';
    } catch {
      /* Retain the reader's documented Japanese fallback. */
    }
    language ||= 'ja';

    const blobs: Record<string, Blob> = Object.create(null);
    const placeholders = new Map<string, string>();
    // Images remain available to the existing gallery. Fonts and media are not
    // decoded as UTF-8 and are not activated as new features by this migration.
    for (const [href, item] of byHref) {
      signal?.throwIfAborted();
      if (!IMAGE_TYPES.has(item.mediaType)) continue;
      const value = await source.loadBlob(item.href);
      if (!value) throw new Error(`EPUB image not found: ${href}`);
      blobs[href] = new Blob([value], { type: item.mediaType });
      placeholders.set(href, buildDummyBookImage(href));
    }
    const imageUrls = new Set(placeholders.values());
    const resources: EpubResourceData[] = book.sections.map((section, spineIndex) => ({
      href: canonicalHref(section),
      spineIndex,
      sectionId: `ttu-epub-${spineIndex}`,
      html: '',
      styleSheet: '',
      characters: 0
    }));
    const rawSources: Record<string, string | Blob> = Object.create(null);
    const stylesheetCache = new Map<string, string>();
    const compileStyle = async (
      css: string,
      owner: string,
      ancestors: Set<string>
    ): Promise<string> => {
      if (css.length > MAX_CSS || ancestors.size > 32)
        throw new Error('EPUB stylesheet exceeds the size limit.');
      const parts: string[] = [];
      for (const reference of localCssImports(css)) {
        let href: string;
        try {
          href = resolveArchivePath(owner, reference);
        } catch {
          continue;
        }
        const item = byHref.get(href);
        if (!item || item.mediaType !== 'text/css' || ancestors.has(href)) continue;
        const cached = stylesheetCache.get(href);
        if (cached !== undefined) {
          parts.push(cached);
          continue;
        }
        const sourceCss = await source.loadText(item.href, MAX_CSS);
        if (sourceCss === null) continue;
        rawSources[href] = sourceCss;
        const compiled = await compileStyle(sourceCss, href, new Set([...ancestors, href]));
        stylesheetCache.set(href, compiled);
        parts.push(compiled);
      }
      parts.push(sanitizeBookStyleSheet(css, document));
      const result = parts.join('\n');
      if (result.length > MAX_CSS)
        throw new Error('EPUB expanded stylesheet exceeds the size limit.');
      return result;
    };
    let totalHtml = 0;
    let totalCss = 0;
    const labels: string[] = [];
    for (const [index, section] of book.sections.entries()) {
      signal?.throwIfAborted();
      const resource = resources[index];
      const text = await source.loadText(section.id);
      if (text === null) throw new Error(`EPUB chapter not found: ${resource.href}`);
      totalHtml += text.length;
      if (totalHtml > MAX_HTML)
        throw new Error('EPUB expanded reading content exceeds the size limit.');
      const repaired = repairEpubHtml(text, fixes);
      rawSources[resource.href] = repaired;
      // XML parsing is inert. Invalid XHTML still follows TTU's HTML recovery,
      // but neither representation is inserted into a live browsing context.
      const parser = new DOMParser();
      let parsed = parser.parseFromString(repaired, 'application/xhtml+xml');
      if (parsed.querySelector('parsererror') || parsed.documentElement.localName !== 'html')
        parsed = parser.parseFromString(repaired, 'text/html');
      const originalBody = parsed.querySelector('body');
      if (!originalBody) throw new Error('Unable to find valid EPUB body content.');
      const styles: string[] = [];
      for (const style of parsed.querySelectorAll('link[rel~="stylesheet"],style')) {
        if (style.localName === 'style') {
          styles.push(await compileStyle(style.textContent ?? '', resource.href, new Set()));
          continue;
        }
        const reference = style.getAttribute('href');
        if (!reference) continue;
        let href: string;
        try {
          href = resolveArchivePath(resource.href, reference);
        } catch {
          continue;
        }
        const item = byHref.get(href);
        if (!item || item.mediaType !== 'text/css') continue;
        const css = await source.loadText(item.href, MAX_CSS);
        if (css === null) continue;
        rawSources[href] = css;
        styles.push(await compileStyle(css, href, new Set([href])));
      }
      const safe = sanitizeBookHtml(repaired, {
        document,
        wholeDocument: true,
        resolveImage: (reference) => placeholders.get(resolveArchivePath(resource.href, reference))
      });
      const sanitized = parser.parseFromString(safe, 'text/html');
      const body = document.createElement('div');
      copyRootAttributes(sanitized.body, body);
      body.classList.add('ttu-book-body-wrapper');
      body.innerHTML = sanitizeBookHtml(sanitized.body.innerHTML, {
        document,
        imageUrls,
        allowRelativeLinks: true
      });
      const root = document.createElement('div');
      copyRootAttributes(sanitized.documentElement, root);
      root.classList.add('ttu-book-html-wrapper');
      root.append(body);
      const wrapper = document.createElement('div');
      wrapper.id = resource.sectionId;
      wrapper.className = `manabi-epub-resource-${index}`;
      wrapper.append(root);
      for (const anchor of wrapper.querySelectorAll('a[href]')) {
        const href = anchor.getAttribute('href')!;
        const target = resolveEpubLinkTarget(resource.href, href, resources, index);
        if (target) {
          anchor.setAttribute('data-manabi-target-spine-index', String(target.spineIndex));
          if (target.fragment) anchor.setAttribute('data-manabi-target-fragment', target.fragment);
          anchor.setAttribute(
            'href',
            `#${target.fragment ?? resources[target.spineIndex].sectionId}`
          );
        } else {
          // Do not let a partial/unknown reference navigate the app document.
          anchor.removeAttribute('href');
        }
      }
      resource.characters = characterCount(wrapper);
      if (!resource.characters) {
        root.classList.add('ttu-no-text');
        body.classList.add('ttu-no-text');
      }
      resource.html = wrapper.outerHTML;
      resource.styleSheet = scopeEpubStyleSheet(styles.join('\n'), index, document);
      totalCss += resource.styleSheet.length;
      if (totalCss > MAX_CSS) throw new Error('EPUB stylesheets exceed the size limit.');
      labels[index] =
        body.querySelector('h1,h2,h3')?.textContent?.trim() ||
        originalBody.ownerDocument.querySelector('title')?.textContent?.trim() ||
        `Chapter ${index + 1}`;
    }
    signal?.throwIfAborted();
    const epubPublication: EpubPublicationData = { version: 1, resources };
    validateEpubPublication(epubPublication);
    const manifest = epubPublicationManifest(epubPublication);
    const toc = flattenedNavigation(book.toc);
    let count = 0;
    const sections: Section[] = resources.map((resource, index) => {
      const entry = toc.find((item) => {
        if (!item.href) return false;
        try {
          return resolveArchivePath('', item.href) === resource.href;
        } catch {
          return false;
        }
      });
      const section: Section = {
        reference: resource.sectionId,
        charactersWeight: resource.characters || 1,
        label: entry?.label || labels[index],
        startCharacter: count,
        characters: resource.characters
      };
      count += resource.characters;
      return section;
    });
    // Feed the existing bounded authored-direction sampler, not a guess from
    // language or the user's currently selected reading mode.
    const compatibilityPackage: EpubContent = {
      package: {
        metadata,
        manifest: {
          item: items.map((item) => ({
            '@_id': item.id,
            '@_href': canonicalHref(item),
            '@_media-type': item.mediaType,
            '@_properties': item.properties?.join(' ')
          }))
        },
        spine: {
          '@_page-progression-direction': book.dir,
          itemref: book.sections.map((section) => ({
            '@_idref': byHref.get(canonicalHref(section))?.id ?? section.idref,
            '@_linear': section.linear
          }))
        }
      }
    };
    const cover = book.resources.cover && canonicalHref(book.resources.cover);
    return {
      title: String(metadata['dc:title']) || file.name,
      language,
      creators: extractCreators(metadata as unknown as Record<string, unknown>),
      hasThumb: true,
      sourceFormat: 'epub',
      pageDirection: epubDirection(compatibilityPackage, rawSources, document),
      elementHtml: epubPublicationHtml(epubPublication),
      styleSheet: resources.map((resource) => resource.styleSheet).join('\n'),
      blobs,
      coverImage: cover ? blobs[cover] : undefined,
      characters: count,
      sections,
      publicationManifest: manifest,
      epubPublication,
      lastBookModified,
      lastBookOpen: 0
    };
  } finally {
    await publication.close();
  }
}
