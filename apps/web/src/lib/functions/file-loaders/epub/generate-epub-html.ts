/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { isOPFType, type EpubContent, type EpubOPFContent } from './types';
import type { Section } from '../../../data/database/books-db/versions/v3/books-db-v3';
import buildDummyBookImage from '../utils/build-dummy-book-image';
import clearAllBadImageRef from '../utils/clear-all-bad-image-ref';
import fixXHtmlHref from '../utils/fix-xhtml-href';
import { importHTMLFixMode$, restrictImportFixToAnchor$ } from '$lib/data/store';
import { ImportHTMLFixMode } from '$lib/data/import-html-fix-mode';
import { getCharacterCount } from '$lib/functions/get-character-count';
import { getParagraphNodes } from '../../../components/book-reader/get-paragraph-nodes';
import { resolveArchivePath } from '../utils/limited-archive';
import { sanitizeBookHtml } from '../../book-security/book-content-security';
import type { PublicationResource } from '$lib/reader-location';

export const prependValue = 'ttu-';

// eslint-disable-next-line no-control-regex
const controlCharactersRegex = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/gim;
const htmlHexEntitiesRegex = /&#x([0-9A-Fa-f]+);/gim;
const htmlDecEntitiesRegex = /&#(\d+);/gim;
const selfClosingTagsRegex = /><\/(meta|link)>/gim;
const selfClosingContentTags = [
  'a',
  'body',
  'code',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'ol',
  'ops:default',
  'p',
  'rb',
  'rt',
  'ruby',
  'script',
  'span',
  'td',
  'th',
  'title'
];

export default function generateEpubHtml(
  data: Record<string, string | Blob>,
  contents: EpubContent | EpubOPFContent,
  document: Document,
  contentsDirectory: string
) {
  const fallbackData = new Map<string, string>();
  const importHTMLFixMode = importHTMLFixMode$.getValue();
  const restrictImportFixToAnchor = restrictImportFixToAnchor$.getValue();
  const applyImportFixes = importHTMLFixMode !== ImportHTMLFixMode.OFF;
  const selfClosingContentTagsToFix =
    applyImportFixes && !restrictImportFixToAnchor ? selfClosingContentTags : [];

  let tocData = { type: 3, content: '' };
  let navKey = '';

  const itemIdToHtmlRef = (
    isOPFType(contents)
      ? contents['opf:package']['opf:manifest']['opf:item']
      : contents.package.manifest.item
  ).reduce<Record<string, string>>((acc, item) => {
    if (item['@_fallback']) {
      fallbackData.set(item['@_id'], item['@_fallback']);
    }

    if (item['@_media-type'] === 'application/xhtml+xml' || item['@_media-type'] === 'text/html') {
      acc[item['@_id']] = item['@_href'];

      if (item['@_properties'] === 'nav') {
        navKey = item['@_href'];
      }
    }
    return acc;
  }, Object.create(null));

  const blobLocations = Object.entries(data).reduce<string[]>((acc, [key, value]) => {
    const isV2Toc = key.endsWith('.ncx') && !tocData.content;

    if (isV2Toc || navKey === key) {
      tocData = {
        type: isV2Toc ? 2 : 3,
        content: value as string
      };
    }

    if (value instanceof Blob) {
      acc.push(key);
    }
    return acc;
  }, []);

  const embeddedStyles: string[] = [];
  const manifestOwner =
    contentsDirectory === '.' ? '__manifest__.opf' : `${contentsDirectory}/__manifest__.opf`;
  const imagePaths = new Map(
    blobLocations.map((key) => [resolveArchivePath(manifestOwner, key), buildDummyBookImage(key)])
  );
  const imageUrls = new Set(imagePaths.values());
  const parser = new DOMParser();
  const spineItemRef = isOPFType(contents)
    ? contents['opf:package']['opf:spine']['opf:itemref']
    : contents.package.spine.itemref;
  const itemRefs = Array.isArray(spineItemRef) ? spineItemRef : [spineItemRef];
  // A small ZIP can repeat a large chapter thousands of times. Bound the
  // rendering work as well as decompression, before creating chapter DOMs.
  if (!itemRefs.length || itemRefs.length > 8192)
    throw new Error('EPUB spine exceeds the size limit');
  let renderedCharacters = 0;
  for (const item of itemRefs) {
    if (!item || typeof item['@_idref'] !== 'string') throw new Error('Invalid EPUB spine item');
    const id = item['@_idref'];
    const href = itemIdToHtmlRef[id] || itemIdToHtmlRef[fallbackData.get(id) ?? ''];
    if (!href || typeof data[href] !== 'string')
      throw new Error('EPUB spine has no supported local chapter');
    renderedCharacters += (data[href] as string).length;
    if (renderedCharacters > 32 * 1024 * 1024)
      throw new Error('EPUB expanded reading content exceeds the size limit');
  }
  const sectionData: Section[] = [];
  const publicationResources: PublicationResource[] = [];
  const result = document.createElement('div');

  let mainChapters: Section[] = [];
  let firstChapterMatchIndex = -1;

  if (applyImportFixes && restrictImportFixToAnchor) {
    selfClosingContentTagsToFix.push('a');
  }

  if (tocData.type && tocData.content) {
    let parsedToc = parser.parseFromString(
      tocData.type === 3
        ? sanitizeBookHtml(tocData.content, { document, wholeDocument: true })
        : tocData.content,
      tocData.type === 3 ? 'text/html' : 'application/xml'
    );

    if (tocData.type === 3) {
      let navTocElement = parsedToc.querySelector('nav[epub\\:type="toc"],nav#toc');

      if (!navTocElement) {
        parsedToc = parser.parseFromString(
          sanitizeBookHtml(tocData.content, { document, wholeDocument: true }),
          'text/html'
        );
      }

      navTocElement = parsedToc.querySelector('nav[epub\\:type="toc"],nav#toc');

      if (navTocElement) {
        mainChapters = [...navTocElement.querySelectorAll('a')].map((elm) => {
          const anchor = elm as HTMLAnchorElement;

          return {
            reference: anchor.getAttribute('href') || '',
            charactersWeight: 1,
            label: anchor.textContent || ''
          };
        });
      }
    } else {
      mainChapters = [...parsedToc.querySelectorAll('navPoint')].map((elm) => {
        const navLabel = elm.querySelector('navLabel text') as HTMLElement;
        const contentElm = elm.querySelector('content') as HTMLElement;

        return {
          reference: contentElm.getAttribute('src') as string,
          charactersWeight: 1,
          label: navLabel.textContent || ''
        };
      });
    }
  }

  if (mainChapters.length) {
    firstChapterMatchIndex = itemRefs.findIndex((ref) =>
      mainChapters[0].reference.includes(itemIdToHtmlRef[ref['@_idref'].split('/').pop() || ''])
    );

    if (firstChapterMatchIndex !== 0) {
      const firstRef = itemRefs[0]['@_idref'];
      const firstHTMLRef = itemIdToHtmlRef[firstRef];
      const fallbackRef = fallbackData.get(firstRef);
      const reference = firstHTMLRef || (fallbackRef ? itemIdToHtmlRef[fallbackRef] : firstHTMLRef);

      mainChapters.unshift({
        reference,
        charactersWeight: 1,
        label: 'Preface',
        startCharacter: 0
      });
    }
  }

  let currentMainChapter = mainChapters[0];
  let currentMainChapterId = currentMainChapter ? `${prependValue}${itemRefs[0]['@_idref']}` : '';
  let currentMainChapterIndex = 0;
  let previousCharacterCount = 0;
  let currentCharCount = 0;

  itemRefs.forEach((item, spineIndex) => {
    let itemIdRef = item['@_idref'];
    let htmlHref = itemIdToHtmlRef[itemIdRef];

    if (!htmlHref && fallbackData.has(itemIdRef)) {
      itemIdRef = fallbackData.get(itemIdRef) as string;
      htmlHref = itemIdToHtmlRef[itemIdRef];
    }

    let contentToParse = (data[htmlHref] as string) || '';

    for (const tagMatch of selfClosingContentTagsToFix) {
      contentToParse = contentToParse.replace(new RegExp(`<${tagMatch}[^>]+?>`, 'gim'), (match) =>
        match.endsWith('/>') ? `${match.slice(0, -2)}></${tagMatch}>` : match
      );
    }

    if (importHTMLFixMode === ImportHTMLFixMode.EXTENDED) {
      contentToParse = contentToParse
        .replace(controlCharactersRegex, '')
        .replace(selfClosingTagsRegex, '>')
        .replace(htmlHexEntitiesRegex, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(htmlDecEntitiesRegex, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
        .replace('<!DOCTYPE html []>', '<!DOCTYPE html>')
        .trim();
    }

    const chapterOwner = resolveArchivePath(manifestOwner, htmlHref);
    contentToParse = sanitizeBookHtml(contentToParse, {
      document,
      wholeDocument: true,
      resolveImage: (source) => imagePaths.get(resolveArchivePath(chapterOwner, source)),
      onEmbeddedStyle: (css) => embeddedStyles.push(css)
    });
    let parsedContent = parser.parseFromString(contentToParse, 'text/html');
    let body = parsedContent.body;

    if (!body?.childNodes?.length) {
      parsedContent = parser.parseFromString(contentToParse, 'text/xml');
      body = parsedContent.querySelector('body')!;

      if (!body?.childNodes?.length) {
        throw new Error('Unable to find valid body content while parsing EPUB');
      }
    }

    const htmlClass = parsedContent.querySelector('html')?.className || '';
    const bodyId = body.id || '';
    const bodyClass = body.className || '';

    const innerHtml = sanitizeBookHtml(body.innerHTML || '', {
      document,
      imageUrls,
      allowRelativeLinks: true
    });

    const childBodyDiv = document.createElement('div');
    childBodyDiv.className = `ttu-book-body-wrapper ${bodyClass}`;
    if (bodyId) {
      childBodyDiv.id = bodyId;
    }
    childBodyDiv.innerHTML = innerHtml;

    const childHtmlDiv = document.createElement('div');
    childHtmlDiv.className = `ttu-book-html-wrapper ${htmlClass}`;
    childHtmlDiv.appendChild(childBodyDiv);

    const childWrapperDiv = document.createElement('div');
    childWrapperDiv.id = `${prependValue}${itemIdRef}`;
    childWrapperDiv.appendChild(childHtmlDiv);

    const resourceHref = resolveArchivePath(manifestOwner, htmlHref);
    childWrapperDiv.dataset.manabiEpubResourceHref = resourceHref;
    result.appendChild(childWrapperDiv);
    publicationResources.push({
      href: resourceHref,
      spineIndex,
      sectionId: childWrapperDiv.id
    });

    const elementCharCount = countForElement(childWrapperDiv);

    currentCharCount += elementCharCount;

    if (!elementCharCount) {
      childHtmlDiv.classList.add('ttu-no-text');
      childBodyDiv.classList.add('ttu-no-text');
    }

    const mainChapterIndex = mainChapters.findIndex((chapter) =>
      chapter.reference.includes(htmlHref.split('/').pop() || '')
    );
    const mainChapter = mainChapterIndex > -1 ? mainChapters[mainChapterIndex] : undefined;
    const characters = currentCharCount - previousCharacterCount;

    if (mainChapter) {
      const oldMainChapterIndex = currentMainChapterIndex;

      currentMainChapter = mainChapter;
      currentMainChapterIndex = sectionData.length;
      currentMainChapterId = `${prependValue}${itemIdRef}`;

      sectionData.push({
        reference: currentMainChapterId,
        charactersWeight: characters || 1,
        label: currentMainChapter.label,
        startCharacter: currentMainChapterIndex
          ? (sectionData[oldMainChapterIndex].startCharacter as number) +
            (sectionData[oldMainChapterIndex].characters as number)
          : 0,
        characters
      });
    } else if (currentMainChapter) {
      (sectionData[currentMainChapterIndex].characters as number) += characters;

      sectionData.push({
        reference: `${prependValue}${itemIdRef}`,
        charactersWeight: characters || 1,
        parentChapter: currentMainChapterId
      });
    }

    previousCharacterCount = currentCharCount;
  });

  clearAllBadImageRef(result);
  fixXHtmlHref(result);
  flattenAnchorHref(result, publicationResources);

  return {
    element: result,
    styleSheet: embeddedStyles.join('\n'),
    characters: currentCharCount,
    publicationManifest: { version: 1 as const, resources: publicationResources },
    sections: sectionData.filter((item: Section) => item.reference.startsWith(prependValue))
  };
}

function countForElement(containerEl: Node) {
  const paragraphs = getParagraphNodes(containerEl);

  let characterCount = 0;

  paragraphs.forEach((node) => {
    characterCount += getCharacterCount(node);
  });

  return characterCount;
}

function flattenAnchorHref(el: HTMLElement, resources: PublicationResource[]) {
  Array.from(el.getElementsByTagName('a')).forEach((tag) => {
    const oldHref = tag.getAttribute('href');
    if (!oldHref) return;
    tag.dataset.manabiEpubHref = oldHref;

    const owner = tag.closest<HTMLElement>('[data-manabi-epub-resource-href]');
    const ownerHref = owner?.dataset.manabiEpubResourceHref;
    const hashIndex = oldHref.indexOf('#');
    const resourceReference = (hashIndex >= 0 ? oldHref.slice(0, hashIndex) : oldHref).split('?', 1)[0];
    let fragment = hashIndex >= 0 ? oldHref.slice(hashIndex + 1) : '';
    try {
      fragment = decodeURIComponent(fragment);
    } catch {
      // Preserve malformed-but-inert fragment text for the legacy hash fallback.
    }

    try {
      const resourceHref =
        !resourceReference && ownerHref
          ? ownerHref
          : ownerHref
            ? resolveArchivePath(ownerHref, resourceReference)
            : undefined;
      const target = resourceHref
        ? resources.find((resource) => resource.href === resourceHref)
        : undefined;
      if (target) {
        tag.dataset.manabiTargetSpineIndex = String(target.spineIndex);
        if (fragment) tag.dataset.manabiTargetFragment = fragment;
      }
    } catch {
      // Sanitization already restricted links to local relative references.
      // A malformed target remains on the legacy inert hash path.
    }

    tag.setAttribute('href', `#${fragment}`);
  });
}
