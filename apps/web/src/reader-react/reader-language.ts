/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useEffect, useMemo, useState } from 'react';
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

export const READER_LANGUAGE_STARTUP_TIMEOUT_MS = 60_000;

/** Public selection interaction needs no provider startup. Private analysis is
 * admitted through the selected provider and shares its existing tab lease. */
export function useReaderLanguageBook(
  props: ReaderLanguageProps & {
    htmlContent?: string;
    publicationManifest?: PublicationManifest;
    viewMode?: string;
  }
) {
  const [attempt, setAttempt] = useState({ bookKey: props.bookKey, revision: 0, original: false });
  const original = attempt.bookKey === props.bookKey && attempt.original;
  const revision = attempt.bookKey === props.bookKey ? attempt.revision : 0;
  useEffect(() => {
    setAttempt({ bookKey: props.bookKey, revision: 0, original: false });
  }, [props.bookKey]);
  const retry = () =>
    setAttempt((previous) => ({
      bookKey: props.bookKey,
      revision: previous.revision + 1,
      original: false
    }));
  const readOriginal = () =>
    setAttempt((previous) => ({
      bookKey: props.bookKey,
      revision: previous.revision + 1,
      original: true
    }));
  const actions = {
    retry,
    readOriginal,
    original,
    canReadOriginal:
      readerEdition === 'manabi' && !!props.bookKey && !!props.htmlContent && !original
  };
  // A return to the same book/source after navigation is a fresh owner, even
  // when an earlier (now disposed) state's scalar fields happen to match.
  const owner = useMemo(
    () => ({}),
    [
      props.bookKey,
      props.htmlContent,
      props.imageBindings,
      props.publicationManifest,
      props.viewMode,
      revision,
      original
    ]
  );
  const [state, setState] = useState<{
    owner?: object;
    book?: ReaderLanguageBook;
    error?: string;
  }>({});
  useEffect(() => {
    if (!props.bookKey || !props.htmlContent) return;
    let live = true;
    let retired = false;
    let book: ReaderLanguageBook | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const lease = readerEdition === 'manabi' && !original ? dictionaryLease() : null;
    const retire = () => {
      if (retired) return;
      retired = true;
      clearTimeout(timer);
      try {
        book?.dispose();
      } catch {
        // Retire the provider lease even if an interaction disposer fails.
      } finally {
        lease?.release();
      }
    };
    void (async () => {
      try {
        const opening = (async () => {
          const runtime = await lease?.get();
          if (retired) return undefined;
          const created = await createReaderLanguageBook({
            bookKey: props.bookKey!,
            htmlContent: props.htmlContent!,
            imageBindings: props.imageBindings,
            manifest: props.publicationManifest,
            runtime
          });
          if (retired) {
            created.dispose();
            return undefined;
          }
          book = created;
          return created;
        })();
        // Timing out retires only this consumer's lease. The runtime owner still
        // serializes disposal before replacement; never race two storage owners.
        const opened = lease
          ? await Promise.race([
              opening,
              new Promise<never>((_, reject) => {
                timer = setTimeout(
                  () => reject(new Error('Language tools are taking too long to open.')),
                  READER_LANGUAGE_STARTUP_TIMEOUT_MS
                );
              })
            ])
          : await opening;
        clearTimeout(timer);
        if (!live || retired || !opened) return;
        setState({
          owner,
          book: opened
        });
      } catch (error) {
        retire();
        if (live)
          setState({
            owner,
            error:
              error instanceof Error ? error.message : 'The book’s language tools could not open.'
          });
      }
    })();
    return () => {
      live = false;
      retire();
    };
  }, [
    props.bookKey,
    props.htmlContent,
    props.imageBindings,
    props.publicationManifest,
    props.viewMode,
    revision,
    original,
    owner
  ]);
  if (!props.htmlContent) return { book: undefined, error: undefined, loading: false, ...actions };
  if (!props.bookKey) return { book: undefined, error: undefined, loading: true, ...actions };
  if (state.owner !== owner)
    return { book: undefined, error: undefined, loading: true, ...actions };
  return { book: state.book, error: state.error, loading: !state.book && !state.error, ...actions };
}
