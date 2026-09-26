/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { sanitizeBookHtml } from '../book-security/book-content-security';
import {
  readEpubPublication,
  epubResourceContents,
  assertEpubManifest,
  type EpubResourceData
} from '$lib/foliate-epub/publication-data';
import { epubResourceStyles, epubCompatibilityStyles } from '$lib/foliate-epub/resource-styles';
import { BlurMode } from '$lib/data/blur-mode';
import type { BooksDbBookData } from '$lib/data/database/books-db/versions/books-db';
import { Observable } from 'rxjs';
import { BaseStorageHandler } from '$lib/data/storage/handler/base-handler';
import buildDummyBookImage from '$lib/functions/file-loaders/utils/build-dummy-book-image';
import { isElementGaiji } from '$lib/functions/is-element-gaiji';
import { map } from 'rxjs/operators';
import {
  readerImageGalleryPictures$,
  type ReaderImageGalleryPicture
} from '$lib/components/book-reader/book-reader-image-gallery/book-reader-image-gallery';

export default function formatBookDataHtml(
  bookData: BooksDbBookData,
  document: Document,
  isPaginated: boolean,
  blurMode: BlurMode,
  parentSelector = '.book-content'
) {
  return getHtmlWithImageSource(bookData, document, isPaginated).pipe(
    map(({ html, imageUrls, resources }) => {
      const element = document.createElement('div');
      element.innerHTML = html;

      addImageContainerClass(element);
      // combineImagePairs(element);
      removeSvgDimensions(element);
      addSpoilerTags(element, document, blurMode);
      removeOldBrTagSolution(element);

      const htmlContent = sanitizeBookHtml(element.innerHTML, {
        document,
        imageUrls,
        preserveReaderLinks: true
      });
      const prepared = document.createElement('div');
      prepared.innerHTML = htmlContent;
      if (
        resources &&
        (prepared.children.length !== resources.length ||
          resources.some((resource, index) => prepared.children[index]?.id !== resource.sectionId))
      )
        throw new Error('Prepared EPUB resources do not match the publication.');
      return {
        htmlContent,
        epubStyleSheet: resources
          ? epubCompatibilityStyles(resources, document, parentSelector)
          : undefined,
        epubResources: resources?.map((resource, index) => ({
          ...resource,
          html: prepared.children[index].outerHTML,
          styleSheet: epubResourceStyles(resource, document)
        }))
      };
    })
  );
}

function getHtmlWithImageSource(
  bookData: BooksDbBookData,
  document: Document,
  isPaginated: boolean
) {
  return new Observable<{
    html: string;
    imageUrls: ReadonlySet<string>;
    resources?: EpubResourceData[];
  }>((subscriber) => {
    const objectUrls: string[] = [];
    let cancelled = false;
    void (async () => {
      const publication =
        bookData.epubPublication === undefined
          ? undefined
          : readEpubPublication(bookData.epubPublication, bookData.elementHtml);
      if (publication) assertEpubManifest(publication, bookData.publicationManifest);
      const sourceHtml = bookData.elementHtml;
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
          index: sourceHtml.indexOf(placeholder)
        });
      }
      if (cancelled) return;
      const imageUrls = new Set(objectUrls);
      const html = sanitizeBookHtml(sourceHtml, {
        document,
        preserveReaderLinks: true,
        resolveImage: (source) => replacements.get(source)
      });
      subscriber.next({
        html,
        imageUrls,
        resources: publication ? epubResourceContents(publication, sourceHtml) : undefined
      });
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
