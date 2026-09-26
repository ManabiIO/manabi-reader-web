/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { sanitizeBookHtml, sanitizeBookStyleSheet } from '../book-security/book-content-security';
import { BlurMode } from '$lib/data/blur-mode';
import type { BooksDbBookData } from '$lib/data/database/books-db/versions/books-db';
import { Observable } from 'rxjs';
import { BaseStorageHandler } from '$lib/data/storage/handler/base-handler';
import buildDummyBookImage from '$lib/functions/file-loaders/utils/build-dummy-book-image';
import { isElementGaiji } from '$lib/functions/is-element-gaiji';
import { map } from 'rxjs/operators';
import { validateEpubPublication, type EpubResourceData } from '$lib/foliate-epub/publication-data';
import { getParagraphNodes } from '$lib/components/book-reader/get-paragraph-nodes';
import { getCharacterCount } from '$lib/functions/get-character-count';
import {
  readerImageGalleryPictures$,
  type ReaderImageGalleryPicture
} from '$lib/components/book-reader/book-reader-image-gallery/book-reader-image-gallery';

export interface FormattedBookContent {
  htmlContent: string;
  epubResources?: EpubResourceData[];
}

export default function formatBookDataHtml(
  bookData: BooksDbBookData,
  document: Document,
  isPaginated: boolean,
  blurMode: BlurMode
) {
  return formatBookReadingContent(bookData, document, isPaginated, blurMode).pipe(
    map((content) => content.htmlContent)
  );
}

/** Sanitize/decorate one source document at a time, not a whole-book DOM. */
export function formatBookReadingContent(
  bookData: BooksDbBookData,
  document: Document,
  isPaginated: boolean,
  blurMode: BlurMode
) {
  if (bookData.epubPublication)
    validateEpubPublication(bookData.epubPublication, bookData.publicationManifest);
  return getHtmlWithImageSource(bookData, document, isPaginated).pipe(
    map(({ htmls, imageUrls }): FormattedBookContent => {
      const resources = bookData.epubPublication?.resources;
      let afterToc = -1;
      if (resources && blurMode === BlurMode.AFTER_TOC) {
        afterToc = htmls.findIndex((html) => {
          const section = document.createElement('div');
          section.innerHTML = html;
          return section.querySelectorAll('a').length > 1;
        });
        if (afterToc === htmls.length - 1) afterToc = -1;
      }
      const formatted = htmls.map((html, index) => {
        const element = document.createElement('div');
        element.innerHTML = html;
        if (
          resources &&
          (element.children.length !== 1 ||
            element.firstElementChild?.id !== resources[index].sectionId)
        )
          throw new Error('The EPUB source section has an invalid root.');
        addImageContainerClass(element);
        removeSvgDimensions(element);
        if (!resources || afterToc < 0 || index > afterToc)
          addSpoilerTags(element, document, resources ? BlurMode.ALL : blurMode);
        removeOldBrTagSolution(element);
        const safe = sanitizeBookHtml(element.innerHTML, {
          document,
          imageUrls,
          preserveReaderLinks: true
        });
        element.innerHTML = safe;
        return {
          html: safe,
          characters: getParagraphNodes(element).reduce(
            (count, node) => count + getCharacterCount(node),
            0
          )
        };
      });
      return {
        htmlContent: formatted.map((section) => section.html).join(''),
        ...(resources
          ? {
              epubResources: resources.map((resource, index) => ({
                ...resource,
                ...formatted[index],
                styleSheet: sanitizeBookStyleSheet(resource.styleSheet, document)
              }))
            }
          : {})
      };
    })
  );
}

function getHtmlWithImageSource(
  bookData: BooksDbBookData,
  document: Document,
  isPaginated: boolean
) {
  return new Observable<{ htmls: string[]; imageUrls: ReadonlySet<string> }>((subscriber) => {
    const objectUrls: string[] = [];
    let cancelled = false;
    void (async () => {
      const replacements = new Map<string, string>();
      const pictures: Array<ReaderImageGalleryPicture & { index: number }> = [];
      for (const [key, original] of Object.entries(bookData.blobs)) {
        if (cancelled) return;
        if (!(original instanceof Blob) || original.size > 64 * 1024 * 1024)
          throw new Error('Book image exceeds the size limit');
        const mime = (original.type || BaseStorageHandler.getImageMimeTypeFromExtension(key) || '')
          .split(';', 1)[0]
          .toLowerCase();
        let value = original;
        if (mime === 'image/svg+xml') {
          if (value.size > 16 * 1024 * 1024) throw new Error('Book SVG exceeds the size limit');
          value = new Blob([sanitizeBookHtml(await value.text(), { document, svgOnly: true })], {
            type: mime
          });
        } else if (
          ![
            'image/png',
            'image/jpeg',
            'image/gif',
            'image/webp',
            'image/bmp',
            'image/avif'
          ].includes(mime)
        ) {
          continue;
        } else if (!original.type || original.type !== mime) {
          value = new Blob([original], { type: mime });
        }
        if (cancelled) return;
        const url = URL.createObjectURL(value);
        objectUrls.push(url);
        const placeholder = buildDummyBookImage(key);
        replacements.set(placeholder, url);
        replacements.set(`ttu:${key}`, url);
        pictures.push({
          url,
          unspoilered: !isPaginated,
          index: bookData.elementHtml.indexOf(placeholder)
        });
      }
      if (cancelled) return;
      const imageUrls = new Set(objectUrls);
      const sources = bookData.epubPublication?.resources.map((resource) => resource.html) ?? [
        bookData.elementHtml
      ];
      const htmls = sources.map((html) =>
        sanitizeBookHtml(html, {
          document,
          resolveImage: (source) => replacements.get(source),
          preserveReaderLinks: true
        })
      );
      subscriber.next({ htmls, imageUrls });
      if (!cancelled && !subscriber.closed) {
        readerImageGalleryPictures$.next(
          pictures
            .sort((a, b) => a.index - b.index)
            .map(({ url, unspoilered }) => ({ url, unspoilered }))
        );
      }
    })().catch((error) => {
      if (!cancelled) subscriber.error(error);
    });
    return () => {
      cancelled = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  });
}

function addImageContainerClass(el: HTMLElement) {
  Array.from(el.getElementsByTagName('img'))
    .map((imgEl) => ({ parentEl: imgEl.parentElement, isGaiji: isElementGaiji(imgEl) }))
    .forEach(({ parentEl, isGaiji }) => {
      parentEl?.classList.add('ttu-img-container');

      if (!isGaiji) {
        parentEl?.classList.add('ttu-illustration-container');
      }
    });
}

function removeSvgDimensions(el: HTMLElement) {
  Array.from(el.getElementsByTagName('svg')).forEach((tag) => {
    tag.removeAttribute('width');
    tag.removeAttribute('height');
  });
}

function addSpoilerTags(el: HTMLElement, document: Document, blurMode: BlurMode) {
  const getChildNodesAfterTableOfContents = () => {
    let childNodes = [...el.children];
    const afterContentsDivIndex =
      childNodes.findIndex((childNode) => childNode.getElementsByTagName('a').length > 1) + 1;
    if (afterContentsDivIndex > 0 && afterContentsDivIndex < childNodes.length) {
      childNodes = childNodes.slice(afterContentsDivIndex);
    }
    return childNodes;
  };

  const createWrapper = (tag: Element, childNode: Element) => {
    const imgWrapper = document.createElement('span');
    const parentElement = tag.parentElement || childNode;

    imgWrapper.classList.add('ttu-img-parent');
    imgWrapper.toggleAttribute('data-ttu-spoiler-img');

    parentElement.insertBefore(imgWrapper, tag);
    imgWrapper.appendChild(tag);
  };

  (blurMode === BlurMode.AFTER_TOC
    ? getChildNodesAfterTableOfContents()
    : [...el.children]
  ).forEach((childNode) => {
    Array.from(childNode.getElementsByTagName('img'))
      .filter((tag) => !isElementGaiji(tag))
      .forEach((tag) => createWrapper(tag, childNode));

    Array.from(childNode.getElementsByTagName('svg'))
      .filter((tag) => tag.getElementsByTagName('image').length)
      .forEach((tag) => createWrapper(tag, childNode));
  });
}

function removeOldBrTagSolution(el: HTMLElement) {
  el.querySelectorAll('.placeholder-br').forEach((placeholderEl) => {
    placeholderEl.parentElement!.removeChild(placeholderEl);
  });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function combineImagePairs(el: HTMLElement) {
  const imagePairs: [Element, Element][] = [];

  let startingIndex = 1;

  if (el.children.item(0)?.id.startsWith('ttu-')) {
    // Skip first page (index 0) as it's probably cover
    startingIndex = 2;
  }

  for (let i = startingIndex; i < el.children.length; i += 2) {
    const leftChild = el.children.item(i - 1)!;
    const rightChild = el.children.item(i)!;

    if (
      hasNoText(leftChild) &&
      hasNoText(rightChild) &&
      hasSingleImage(leftChild) &&
      hasSingleImage(rightChild)
    ) {
      imagePairs.push([leftChild, rightChild]);
    }
  }

  if (
    imagePairs.some(([leftPair, rightPair]) => {
      const leftImages = leftPair.querySelectorAll('image');
      const rightImages = rightPair.querySelectorAll('image');

      if (leftImages.length !== 1 || rightImages.length !== 1) {
        // Not supported
        return true;
      }

      if (!isImagePortrait(leftImages[0]) || !isImagePortrait(rightImages[0])) {
        return true;
      }

      return false;
    })
  ) {
    return;
  }

  imagePairs.forEach(([leftPair, rightPair]) => {
    el.removeChild(rightPair);

    leftPair.classList.add('grouped-image');

    const images = extractImageChildren(leftPair).concat(extractImageChildren(rightPair));

    clearChildren(leftPair);

    images.forEach((image) => leftPair.appendChild(image));
  });
}

function hasNoText(el: Element) {
  return typeof el.textContent === 'string' ? el.textContent.trim().length === 0 : !el.textContent;
}

function getImageChildren(el: Element) {
  const imageChilds = el.querySelectorAll('svg');
  return imageChilds;
}

function hasSingleImage(el: Element) {
  return getImageChildren(el).length === 1;
}

function extractImageChildren(el: Element) {
  const imageChildren = getImageChildren(el);
  const result: Element[] = [];
  imageChildren.forEach((child) => {
    if (child.parentNode) {
      child.parentNode.removeChild(child);
      result.push(child);
    }
  });
  return result;
}

function clearChildren(el: Element) {
  Array.from(el.children).forEach((child) => {
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
  });
  return el;
}

function isImagePortrait(el: SVGImageElement) {
  return el.height.baseVal.value > el.width.baseVal.value;
}
