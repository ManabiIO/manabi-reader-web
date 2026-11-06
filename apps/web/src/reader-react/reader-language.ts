/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useEffect, useState } from 'react';
import { ReaderLanguageBook } from '$lib/preprocessing/reader-book.mjs';
import { sha256 } from '$lib/preprocessing/contracts.mjs';
import { sanitizeProcessedChapter } from '$lib/preprocessing/sanitizer';
import { projectResource, type PublicationManifest } from '$lib/reader-location';
import { dictionaryLease } from '$lib/search/dictionary-runtime';
import { attachReaderDictionaryInteraction } from '$lib/search/reader-dictionary-interaction';
import { readerEdition } from '../runtime/edition';

export interface ReaderLanguageProps {
  bookKey?: string;
  imageBindings?: ReadonlyMap<string, string>;
}

/** Replace current object URLs with their stable source placeholders before
 * analysis. Only this read lifetime's loader-issued URLs may be restored. */
export async function createReaderLanguageBook({
  bookKey,
  htmlContent,
  imageBindings,
  manifest,
  runtime
}: {
  bookKey: string;
  htmlContent: string;
  imageBindings?: ReadonlyMap<string, string>;
  manifest?: PublicationManifest;
  runtime?: Awaited<ReturnType<ReturnType<typeof dictionaryLease>['get']>>;
}) {
  const canonical = document.createElement('div');
  canonical.innerHTML = htmlContent;
  const bindings = new Map(imageBindings);
  const reverse = new Map<string, string>();
  for (const [source, url] of bindings) {
    if (source.startsWith('data:image/gif;ttu:')) reverse.set(url, source);
  }
  for (const image of canonical.querySelectorAll('img,image')) {
    for (const name of ['src', 'href', 'xlink:href']) {
      const value = image.getAttribute(name);
      if (value?.startsWith('blob:')) {
        const source = reverse.get(value);
        if (!source) throw new Error('A book image is missing its current resource binding.');
        image.setAttribute(name, source);
      }
    }
  }
  const sources = Array.from(canonical.children);
  const chapters = sources.map((source, index) => ({
    id: manifest?.resources[index]?.sectionId || source.id || `chapter-${index}`,
    baseURL: new URL(
      manifest?.resources[index]?.href || `chapter-${index}`,
      'https://reader-book.invalid/'
    ).href,
    html: source.innerHTML
  }));
  if (manifest && manifest.resources.length !== chapters.length)
    throw new Error('Book chapter identities do not match the publication.');
  const resources = new Set(bindings.values());
  const resourceVersion = await sha256(canonical.innerHTML);
  return new ReaderLanguageBook({
    runtime,
    chapters,
    bookKey,
    resourceVersion,
    interaction: attachReaderDictionaryInteraction,
    renderHTML(html, index) {
      const safe = sanitizeProcessedChapter(html, {
        document,
        imageUrls: resources,
        resolveImage: (source) => bindings.get(source),
        preserveReaderLinks: true
      });
      const transformed = document.createElement('div');
      transformed.innerHTML = safe;
      const resource = {
        sectionId: chapters[index].id,
        href: chapters[index].baseURL,
        spineIndex: index
      };
      if (
        projectResource(sources[index], resource).text !==
        projectResource(transformed, resource).text
      )
        throw new Error('Chapter analysis changed the book’s source text.');
      return safe;
    }
  });
}

/** Public selection interaction needs no provider startup. Private analysis is
 * admitted through the selected provider and shares its existing tab lease. */
export function useReaderLanguageBook(
  props: ReaderLanguageProps & {
    htmlContent?: string;
    publicationManifest?: PublicationManifest;
    viewMode?: string;
  }
) {
  const [state, setState] = useState<{
    source?: string;
    bookKey?: string;
    mode?: string;
    bindings?: ReadonlyMap<string, string>;
    manifest?: PublicationManifest;
    book?: ReaderLanguageBook;
    error?: string;
  }>({});
  useEffect(() => {
    if (!props.bookKey || !props.htmlContent) return;
    let live = true;
    let book: ReaderLanguageBook | undefined;
    const lease = readerEdition === 'manabi' ? dictionaryLease() : null;
    void (async () => {
      try {
        const runtime = await lease?.get();
        if (!live) return;
        book = await createReaderLanguageBook({
          bookKey: props.bookKey!,
          htmlContent: props.htmlContent!,
          imageBindings: props.imageBindings,
          manifest: props.publicationManifest,
          runtime
        });
        if (!live) {
          book.dispose();
          return;
        }
        setState({
          source: props.htmlContent,
          bookKey: props.bookKey,
          mode: props.viewMode,
          bindings: props.imageBindings,
          manifest: props.publicationManifest,
          book
        });
      } catch (error) {
        if (live)
          setState({
            source: props.htmlContent,
            bookKey: props.bookKey,
            mode: props.viewMode,
            bindings: props.imageBindings,
            manifest: props.publicationManifest,
            error:
              error instanceof Error ? error.message : 'The book’s language tools could not open.'
          });
      }
    })();
    return () => {
      live = false;
      book?.dispose();
      lease?.release();
    };
  }, [
    props.bookKey,
    props.htmlContent,
    props.imageBindings,
    props.publicationManifest,
    props.viewMode
  ]);
  if (!props.htmlContent) return { book: undefined, error: undefined, loading: false };
  if (!props.bookKey) return { book: undefined, error: undefined, loading: true };
  if (
    state.source !== props.htmlContent ||
    state.bookKey !== props.bookKey ||
    state.mode !== props.viewMode ||
    state.bindings !== props.imageBindings ||
    state.manifest !== props.publicationManifest
  )
    return { book: undefined, error: undefined, loading: true };
  return { book: state.book, error: state.error, loading: !state.book && !state.error };
}
