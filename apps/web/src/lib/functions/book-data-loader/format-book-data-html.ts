/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { sanitizeBookHtml } from '../book-security/book-content-security';
import { BlurMode } from '$lib/data/blur-mode';
import type { BooksDbBookData } from '$lib/data/database/books-db/versions/books-db';
import { Observable } from 'rxjs';
import { BaseStorageHandler } from '$lib/data/storage/handler/base-handler';
import buildDummyBookImage from '$lib/functions/file-loaders/utils/build-dummy-book-image';
import { isElementGaiji } from '$lib/functions/is-element-gaiji';
import {
  readerImageGalleryPictures$
} from '$lib/components/book-reader/book-reader-image-gallery/book-reader-image-gallery';
import { BookResourceLease } from '$lib/preprocessing/book-resources.mjs';

let galleryOwner: object | undefined;

/**
 * The stable source and its disposable presentation are separate operations.
 * Preprocessors consume sourceHtml, never HTML returned by render(). Source
 * sanitization cannot opt itself into application-owned annotation markup.
 */
export function createBookPresentationSource(bookData: BooksDbBookData, document: Document) {
  const resources = new BookResourceLease({
    blobs: bookData.blobs,
    placeholderFor: buildDummyBookImage,
    inferMimeType: (key) => BaseStorageHandler.getImageMimeTypeFromExtension(key),
    sanitizeSvg: (source) => sanitizeBookHtml(source, { document, svgOnly: true })
  });
  try {
    const sourceHtml = sanitizeBookHtml(bookData.elementHtml, {
      document,
      resolveImage: (source) => resources.resolveSourceImage(source)
    });
    const template = document.createElement('template');
    template.innerHTML = sourceHtml;
    const sourceImages = Array.from(template.content.querySelectorAll('img, image'))
      .map((image) =>
        image.tagName.toLowerCase() === 'img'
          ? image.getAttribute('src')
          : (image.getAttribute('href') ?? image.getAttribute('xlink:href'))
      )
      .filter((source): source is string => source !== null);
    return Object.freeze({
      sourceHtml,
      prepare: (options?: { signal?: AbortSignal }) => resources.prepare(options),
      render(html: string, blurMode: BlurMode, annotations = false) {
        const element = document.createElement('div');
        // Reuse our already sanitized immutable source on the identity path.
        // Transformed/cache HTML must cross the same security boundary again.
        element.innerHTML =
          html === sourceHtml && !annotations
            ? sourceHtml
            : sanitizeBookHtml(html, {
                document,
                allowReaderAnnotations: annotations,
                resolveImage: (source) => resources.resolveSourceImage(source)
              });
        formatBookPresentation(element, document, blurMode);
        return sanitizeBookHtml(element.innerHTML, {
          document,
          allowReaderAnnotations: annotations,
          resolveImage: (source) => resources.resolveRenderImage(source)
        });
      },
      pictures: (isPaginated: boolean) => resources.pictures(sourceImages, isPaginated),
      dispose: () => resources.dispose()
    });
  } catch (error) {
    resources.dispose();
    throw error;
  }
}

export type BookPresentationSource = ReturnType<typeof createBookPresentationSource>;

export default function formatBookDataHtml(
  bookData: BooksDbBookData,
  document: Document,
  isPaginated: boolean,
  blurMode: BlurMode
) {
  return new Observable<string>((subscriber) => {
    const source = createBookPresentationSource(bookData, document);
    const controller = new AbortController();
    const owner = {};
    void source
      .prepare({ signal: controller.signal })
      .then(() => {
        controller.signal.throwIfAborted();
        const html = source.render(source.sourceHtml, blurMode);
        subscriber.next(html);
        // next() may synchronously replace this subscription/book. Never publish
        // the old gallery into its successor, even when preparation just finished.
        if (subscriber.closed || controller.signal.aborted) return;
        galleryOwner = owner;
        readerImageGalleryPictures$.next(source.pictures(isPaginated));
      })
      .catch((error) => {
        if (!controller.signal.aborted && !subscriber.closed) subscriber.error(error);
      });
    return () => {
      controller.abort();
      source.dispose();
      if (galleryOwner === owner) {
        galleryOwner = undefined;
        readerImageGalleryPictures$.next([]);
      }
    };
  });
}

/** Presentation-only transforms; never part of a semantic chapter cache. */
function formatBookPresentation(el: HTMLElement, document: Document, blurMode: BlurMode) {
  for (const img of Array.from(el.getElementsByTagName('img'))) {
    img.parentElement?.classList.add('ttu-img-container');
    if (!isElementGaiji(img)) img.parentElement?.classList.add('ttu-illustration-container');
  }
  for (const svg of Array.from(el.getElementsByTagName('svg'))) {
    svg.removeAttribute('width');
    svg.removeAttribute('height');
  }
  let children = [...el.children];
  if (blurMode === BlurMode.AFTER_TOC) {
    const start = children.findIndex((child) => child.getElementsByTagName('a').length > 1) + 1;
    if (start > 0 && start < children.length) children = children.slice(start);
  }
  for (const child of children) {
    const images = [
      ...Array.from(child.getElementsByTagName('img')).filter((img) => !isElementGaiji(img)),
      ...Array.from(child.getElementsByTagName('svg')).filter(
        (svg) => svg.getElementsByTagName('image').length > 0
      )
    ];
    for (const image of images) {
      const wrapper = document.createElement('span');
      wrapper.classList.add('ttu-img-parent');
      wrapper.toggleAttribute('data-ttu-spoiler-img');
      (image.parentElement ?? child).insertBefore(wrapper, image);
      wrapper.appendChild(image);
    }
  }
  for (const placeholder of Array.from(el.querySelectorAll('.placeholder-br'))) {
    placeholder.remove();
  }
}
