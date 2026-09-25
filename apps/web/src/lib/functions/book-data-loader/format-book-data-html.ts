/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { BlurMode } from '$lib/data/blur-mode';
import type { BooksDbBookData } from '$lib/data/database/books-db/versions/books-db';
import { Observable } from 'rxjs';
import { BaseStorageHandler } from '$lib/data/storage/handler/base-handler';
import { readerImageGalleryPictures$ } from '$lib/components/book-reader/book-reader-image-gallery/book-reader-image-gallery';
import { createBookPresentationSource } from './book-presentation-source';

let galleryOwner: object | undefined;

export default function formatBookDataHtml(
  bookData: BooksDbBookData,
  document: Document,
  isPaginated: boolean,
  blurMode: BlurMode
) {
  return new Observable<string>((subscriber) => {
    const source = createBookPresentationSource(
      bookData,
      document,
      BaseStorageHandler.getImageMimeTypeFromExtension
    );
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
