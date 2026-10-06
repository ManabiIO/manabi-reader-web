/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { browser } from '../runtime/environment';
import {
  codePointLength,
  makeLocator,
  projectPublication,
  type ProjectedResource,
  type PublicationManifest
} from '$lib/reader-location';
import { ReaderPanelSelection } from '$lib/reader-panel-selection';
import type { ReaderSearchHit } from '$lib/reader-search-worker';
import { ReaderController, readerTick } from './controller';
export interface SearchProps {
  open?: boolean;
  rawHtml?: string;
  manifest: PublicationManifest | undefined;
  bookKey?: string;
  bookTitle?: string;
}

export function createSearch(
  props: SearchProps,
  emit: (name: string, detail?: unknown) => void = () => {}
) {
  const __readerController = new ReaderController();

  let open = props.open !== undefined ? props.open : false;
  let rawHtml = props.rawHtml !== undefined ? props.rawHtml : '';
  let manifest: PublicationManifest | undefined = props.manifest;
  let bookKey = props.bookKey !== undefined ? props.bookKey : '';
  let bookTitle = props.bookTitle !== undefined ? props.bookTitle : '';
  const dispatch = (name: string, detail?: unknown) => emit(name, detail);
  let worker: Worker | undefined;
  let mounted = false;
  let searchError = '';
  let queryError = '';
  let requestId = 0;
  let bookGeneration = 0;
  let resources: ProjectedResource[] = [];
  let query = '';
  let matchCase = false;
  let composing = false;
  let inputElement: HTMLInputElement | undefined;
  let resultsElement: HTMLDivElement | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let hits: ReaderSearchHit[] = [];
  let visibleCount = 50;
  let revealingResults = false;
  let focusFrame = 0;
  let searching = false;
  let total = 0;
  let truncated = false;
  let projectedHtml = '';
  let projectedManifest: PublicationManifest | undefined;
  let projectedBookKey = '';
  let selectionError = '';
  const selection = new ReaderPanelSelection();
  __readerController.effect(
    () => [open, rawHtml, manifest, bookKey, query],
    () => {
      if (
        browser &&
        open &&
        (rawHtml !== projectedHtml ||
          manifest !== projectedManifest ||
          bookKey !== projectedBookKey)
      ) {
        __readerController.changed((projectedHtml = rawHtml));
        __readerController.changed((projectedManifest = manifest));
        __readerController.changed((projectedBookKey = bookKey));
        const root = document.createElement('div');
        root.innerHTML = rawHtml;
        __readerController.changed((resources = rawHtml ? projectPublication(root, manifest) : []));
        __readerController.changed((bookGeneration += 1));
        cancel();
        __readerController.changed((hits = []));
        __readerController.changed((total = 0));
        if (open && query) schedule();
      }
    }
  );
  __readerController.effect(
    () => [open],
    () => {
      if (open) schedule();
      else {
        cancel();
        __readerController.changed((composing = false));
      }
    }
  );
  __readerController.onMount(() => {
    __readerController.changed((mounted = true));
    if (open && query) schedule();
  });
  __readerController.onDestroy(() => {
    __readerController.changed((mounted = false));
    if (focusFrame) cancelAnimationFrame(focusFrame);
    cancel();
    worker?.terminate();
    selection.dispose();
  });
  function failSearch() {
    cancel();
    worker?.terminate();
    __readerController.changed((worker = undefined));
    __readerController.changed((hits = []));
    __readerController.changed((total = 0));
    __readerController.changed((truncated = false));
    if (open)
      __readerController.changed((searchError = 'Search could not finish. Please try again.'));
  }
  function ensureWorker() {
    if (worker) return true;
    try {
      const next = new Worker(new URL('../lib/reader-search-worker.ts', import.meta.url), {
        type: 'module'
      });
      __readerController.changed((worker = next));
      next.onmessage = (event: MessageEvent) => {
        if (worker !== next || !open) return;
        const value = event.data;
        if (value.requestId !== requestId || value.bookGeneration !== bookGeneration) return;
        if (value.type === 'error') {
          failSearch();
          return;
        }
        if (value.type === 'batch') __readerController.changed((hits = [...hits, ...value.hits]));
        if (value.type === 'done') {
          __readerController.changed((searching = false));
          __readerController.changed((total = value.total));
          __readerController.changed((truncated = value.truncated));
        }
      };
      next.onerror = (event) => {
        // Consume the handled worker failure; keep a retry path instead of an
        // endless spinner. A terminated worker cannot reset its replacement.
        event.preventDefault();
        if (worker === next) failSearch();
      };
      next.onmessageerror = () => {
        if (worker === next) failSearch();
      };
      return true;
    } catch {
      failSearch();
      return false;
    }
  }
  function cancel() {
    selection.invalidate();
    if (debounce) clearTimeout(debounce);
    __readerController.changed((debounce = undefined));
    try {
      worker?.postMessage({ type: 'cancel', requestId });
    } catch {
      worker?.terminate();
      __readerController.changed((worker = undefined));
    }
    __readerController.changed((requestId += 1));
    __readerController.changed((searching = false));
  }
  function schedule() {
    cancel();
    __readerController.changed((hits = []));
    __readerController.changed((total = 0));
    __readerController.changed((truncated = false));
    __readerController.changed((visibleCount = 50));
    __readerController.changed((selectionError = ''));
    __readerController.changed((searchError = ''));
    __readerController.changed((queryError = ''));
    if (!mounted || !open || !query.trim() || composing) return;
    // Match the worker's code-point limit; UTF-16 length rejects valid Japanese
    // supplementary characters. A validation error is not a failed worker.
    if (codePointLength(query) > 512) {
      __readerController.changed((queryError = 'Use a search of 512 characters or fewer.'));
      return;
    }
    if (!ensureWorker()) return;
    const id = requestId;
    __readerController.changed((searching = true));
    __readerController.changed(
      (debounce = setTimeout(() => {
        try {
          worker?.postMessage({
            type: 'search',
            requestId: id,
            bookGeneration,
            query,
            matchCase,
            resources: resources.map(({ resource, text }) => ({ resource, text }))
          });
        } catch {
          failSearch();
        }
      }, 160))
    );
  }
  function clearSearch() {
    __readerController.changed((query = ''));
    __readerController.changed((composing = false));
    schedule();
    inputElement?.focus({ preventScroll: true });
  }
  function revealResult(button: HTMLButtonElement) {
    cancelAnimationFrame(focusFrame);
    const id = requestId;
    // Native focus scrolling completes before we reveal a tall row's match.
    // The callback may not scroll after a new query, dismissal or focus move.
    __readerController.changed(
      (focusFrame = requestAnimationFrame(() => {
        if (!mounted || !open || id !== requestId || !button.isConnected) return;
        if (document.activeElement !== button) return;
        const match = button.querySelector<HTMLElement>('mark');
        const scroller = button.closest<HTMLElement>('[data-search-scroll]');
        if (match && scroller) {
          // WebKit may leave an inline mark below the scrollport when asked to
          // scrollIntoView. Position the actual match using the sole scroll owner.
          const markRect = match.getBoundingClientRect();
          const scrollRect = scroller.getBoundingClientRect();
          scroller.scrollTop +=
            markRect.top + markRect.height / 2 - (scrollRect.top + scrollRect.height / 2);
        } else {
          button.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
        }
      }))
    );
  }
  async function showMore(event: MouseEvent) {
    const trigger = event.currentTarget;
    if (!(trigger instanceof HTMLElement) || revealingResults) return;
    const id = requestId;
    const firstNew = visibleCount;
    trigger.focus({ preventScroll: true });
    // Keep the final-batch trigger connected until focus reaches the new row.
    // Otherwise the modal's focus recovery can run before this tick completes.
    __readerController.changed((revealingResults = true));
    __readerController.changed((visibleCount += 50));
    try {
      await readerTick();
      if (!mounted || !open || id !== requestId || document.activeElement !== trigger) return;
      const next = resultsElement?.querySelectorAll<HTMLButtonElement>(
        'button[data-search-result]'
      )[firstNew];
      next?.focus({ preventScroll: true });
    } finally {
      __readerController.changed((revealingResults = false));
    }
  }
  function select(hit: ReaderSearchHit) {
    const projected = resources.find(
      ({ resource }) =>
        resource.spineIndex === hit.resource.spineIndex && resource.href === hit.resource.href
    );
    if (!projected || !bookKey || !open) return;
    const key = bookKey;
    const generation = bookGeneration;
    const html = rawHtml;
    const publication = manifest;
    __readerController.changed((selectionError = ''));
    void selection.run(
      () => makeLocator(key, projected, hit.start, hit.end),
      () =>
        open &&
        bookKey === key &&
        bookGeneration === generation &&
        rawHtml === html &&
        manifest === publication,
      (locator) => dispatch('select', locator),
      () =>
        __readerController.changed(
          (selectionError = 'Could not open this result. Please try again.')
        )
    );
  }

  const api = {
    controller: __readerController,
    failSearch,
    ensureWorker,
    cancel,
    schedule,
    clearSearch,
    revealResult,
    showMore,
    select,
    get open() {
      return open;
    },
    set open(nextValue: typeof open) {
      if (Object.is(open, nextValue)) return;
      open = nextValue;
      __readerController.invalidate();
    },
    get rawHtml() {
      return rawHtml;
    },
    set rawHtml(nextValue: typeof rawHtml) {
      if (Object.is(rawHtml, nextValue)) return;
      rawHtml = nextValue;
      __readerController.invalidate();
    },
    get manifest() {
      return manifest;
    },
    set manifest(nextValue: typeof manifest) {
      if (Object.is(manifest, nextValue)) return;
      manifest = nextValue;
      __readerController.invalidate();
    },
    get bookKey() {
      return bookKey;
    },
    set bookKey(nextValue: typeof bookKey) {
      if (Object.is(bookKey, nextValue)) return;
      bookKey = nextValue;
      __readerController.invalidate();
    },
    get bookTitle() {
      return bookTitle;
    },
    set bookTitle(nextValue: typeof bookTitle) {
      if (Object.is(bookTitle, nextValue)) return;
      bookTitle = nextValue;
      __readerController.invalidate();
    },
    get dispatch() {
      return dispatch;
    },
    get worker() {
      return worker;
    },
    set worker(nextValue: typeof worker) {
      if (Object.is(worker, nextValue)) return;
      worker = nextValue;
      __readerController.invalidate();
    },
    get mounted() {
      return mounted;
    },
    set mounted(nextValue: typeof mounted) {
      if (Object.is(mounted, nextValue)) return;
      mounted = nextValue;
      __readerController.invalidate();
    },
    get searchError() {
      return searchError;
    },
    set searchError(nextValue: typeof searchError) {
      if (Object.is(searchError, nextValue)) return;
      searchError = nextValue;
      __readerController.invalidate();
    },
    get queryError() {
      return queryError;
    },
    set queryError(nextValue: typeof queryError) {
      if (Object.is(queryError, nextValue)) return;
      queryError = nextValue;
      __readerController.invalidate();
    },
    get requestId() {
      return requestId;
    },
    set requestId(nextValue: typeof requestId) {
      if (Object.is(requestId, nextValue)) return;
      requestId = nextValue;
      __readerController.invalidate();
    },
    get bookGeneration() {
      return bookGeneration;
    },
    set bookGeneration(nextValue: typeof bookGeneration) {
      if (Object.is(bookGeneration, nextValue)) return;
      bookGeneration = nextValue;
      __readerController.invalidate();
    },
    get resources() {
      return resources;
    },
    set resources(nextValue: typeof resources) {
      if (Object.is(resources, nextValue)) return;
      resources = nextValue;
      __readerController.invalidate();
    },
    get query() {
      return query;
    },
    set query(nextValue: typeof query) {
      if (Object.is(query, nextValue)) return;
      query = nextValue;
      __readerController.invalidate();
    },
    get matchCase() {
      return matchCase;
    },
    set matchCase(nextValue: typeof matchCase) {
      if (Object.is(matchCase, nextValue)) return;
      matchCase = nextValue;
      __readerController.invalidate();
    },
    get composing() {
      return composing;
    },
    set composing(nextValue: typeof composing) {
      if (Object.is(composing, nextValue)) return;
      composing = nextValue;
      __readerController.invalidate();
    },
    get inputElement() {
      return inputElement;
    },
    set inputElement(nextValue: typeof inputElement) {
      if (Object.is(inputElement, nextValue)) return;
      inputElement = nextValue;
      __readerController.invalidate();
    },
    get resultsElement() {
      return resultsElement;
    },
    set resultsElement(nextValue: typeof resultsElement) {
      if (Object.is(resultsElement, nextValue)) return;
      resultsElement = nextValue;
      __readerController.invalidate();
    },
    get debounce() {
      return debounce;
    },
    set debounce(nextValue: typeof debounce) {
      if (Object.is(debounce, nextValue)) return;
      debounce = nextValue;
      __readerController.invalidate();
    },
    get hits() {
      return hits;
    },
    set hits(nextValue: typeof hits) {
      if (Object.is(hits, nextValue)) return;
      hits = nextValue;
      __readerController.invalidate();
    },
    get visibleCount() {
      return visibleCount;
    },
    set visibleCount(nextValue: typeof visibleCount) {
      if (Object.is(visibleCount, nextValue)) return;
      visibleCount = nextValue;
      __readerController.invalidate();
    },
    get revealingResults() {
      return revealingResults;
    },
    set revealingResults(nextValue: typeof revealingResults) {
      if (Object.is(revealingResults, nextValue)) return;
      revealingResults = nextValue;
      __readerController.invalidate();
    },
    get focusFrame() {
      return focusFrame;
    },
    set focusFrame(nextValue: typeof focusFrame) {
      if (Object.is(focusFrame, nextValue)) return;
      focusFrame = nextValue;
      __readerController.invalidate();
    },
    get searching() {
      return searching;
    },
    set searching(nextValue: typeof searching) {
      if (Object.is(searching, nextValue)) return;
      searching = nextValue;
      __readerController.invalidate();
    },
    get total() {
      return total;
    },
    set total(nextValue: typeof total) {
      if (Object.is(total, nextValue)) return;
      total = nextValue;
      __readerController.invalidate();
    },
    get truncated() {
      return truncated;
    },
    set truncated(nextValue: typeof truncated) {
      if (Object.is(truncated, nextValue)) return;
      truncated = nextValue;
      __readerController.invalidate();
    },
    get projectedHtml() {
      return projectedHtml;
    },
    set projectedHtml(nextValue: typeof projectedHtml) {
      if (Object.is(projectedHtml, nextValue)) return;
      projectedHtml = nextValue;
      __readerController.invalidate();
    },
    get projectedManifest() {
      return projectedManifest;
    },
    set projectedManifest(nextValue: typeof projectedManifest) {
      if (Object.is(projectedManifest, nextValue)) return;
      projectedManifest = nextValue;
      __readerController.invalidate();
    },
    get projectedBookKey() {
      return projectedBookKey;
    },
    set projectedBookKey(nextValue: typeof projectedBookKey) {
      if (Object.is(projectedBookKey, nextValue)) return;
      projectedBookKey = nextValue;
      __readerController.invalidate();
    },
    get selectionError() {
      return selectionError;
    },
    set selectionError(nextValue: typeof selectionError) {
      if (Object.is(selectionError, nextValue)) return;
      selectionError = nextValue;
      __readerController.invalidate();
    },
    get selection() {
      return selection;
    },
    updateProps(next: Record<string, unknown>) {
      if ('open' in next) api.open = next.open as typeof open;
      if ('rawHtml' in next) api.rawHtml = next.rawHtml as typeof rawHtml;
      if ('manifest' in next) api.manifest = next.manifest as typeof manifest;
      if ('bookKey' in next) api.bookKey = next.bookKey as typeof bookKey;
      if ('bookTitle' in next) api.bookTitle = next.bookTitle as typeof bookTitle;
    }
  };
  return api;
}
