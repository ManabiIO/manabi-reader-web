/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { browser } from '../runtime/environment';
import { ReaderPanelSelection } from '$lib/reader-panel-selection';
import {
  codePointLength,
  makeLocator,
  projectPublication,
  type ProjectedResource,
  type PublicationManifest,
  type ReaderLocator
} from '$lib/reader-location';
import { ReaderController } from './controller';
export interface ScrubberProps {
  open?: boolean;
  rawHtml?: string;
  manifest: PublicationManifest | undefined;
  bookKey?: string;
  current: ReaderLocator | undefined;
}

export function createScrubber(
  props: ScrubberProps,
  emit: (name: string, detail?: unknown) => void = () => {}
) {
  const __readerController = new ReaderController();

  let open = props.open !== undefined ? props.open : false;
  let rawHtml = props.rawHtml !== undefined ? props.rawHtml : '';
  let manifest: PublicationManifest | undefined = props.manifest;
  let bookKey = props.bookKey !== undefined ? props.bookKey : '';
  let current: ReaderLocator | undefined = props.current;
  const dispatch = (name: string, detail?: unknown) => emit(name, detail);
  let resources: ProjectedResource[] = [];
  let lengths: number[] = [];
  let total = 0;
  let value = 0;
  let preview = 'Start of book';
  let selectionError = '';
  const selection = new ReaderPanelSelection();
  __readerController.effect(
    () => [open, selection],
    () => {
      if (!open) selection.invalidate();
    }
  );
  __readerController.onDestroy(() => selection.dispose());
  __readerController.effect(
    () => [open, selection, rawHtml, manifest, current],
    () => {
      if (browser && open) {
        selection.invalidate();
        __readerController.changed((selectionError = ''));
        const root = document.createElement('div');
        root.innerHTML = rawHtml;
        __readerController.changed((resources = rawHtml ? projectPublication(root, manifest) : []));
        __readerController.changed(
          (lengths = resources.map((resource) => Math.max(1, codePointLength(resource.text))))
        );
        __readerController.changed((total = lengths.reduce((sum, length) => sum + length, 0)));
        __readerController.changed((value = 0));
        let before = 0;
        for (let i = 0; i < resources.length; i += 1) {
          if (
            current?.resource.spineIndex === resources[i].resource.spineIndex &&
            current.resource.href === resources[i].resource.href
          ) {
            __readerController.changed(
              (value = total
                ? Math.round(((before + Math.min(current.start, lengths[i])) / total) * 1000)
                : 0)
            );
            break;
          }
          before += lengths[i];
        }
        updatePreview();
      }
    }
  );
  function target() {
    if (!resources.length) return undefined;
    let position = (total * value) / 1000;
    for (let i = 0; i < resources.length; i += 1) {
      const length = lengths[i];
      if (position <= length || i === resources.length - 1) {
        const resource = resources[i];
        const offset = Math.min(codePointLength(resource.text), Math.max(0, Math.floor(position)));
        return { resource, offset, index: i };
      }
      position -= length;
    }
    return undefined;
  }
  function updatePreview() {
    const selected = target();
    __readerController.changed(
      (preview = selected
        ? `Section ${selected.index + 1} of ${resources.length} · approximately ${Math.round(value / 10)}%`
        : 'Start of book')
    );
  }
  function choose() {
    const selected = target();
    if (!selected || !bookKey || !open) return;
    const key = bookKey;
    const projected = resources;
    __readerController.changed((selectionError = ''));
    void selection.run(
      () => makeLocator(key, selected.resource, selected.offset),
      () => open && bookKey === key && resources === projected,
      (locator) => dispatch('select', locator),
      () =>
        __readerController.changed(
          (selectionError = 'Could not open this position. Please try again.')
        )
    );
  }

  const api = {
    controller: __readerController,
    target,
    updatePreview,
    choose,
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
    get current() {
      return current;
    },
    set current(nextValue: typeof current) {
      if (Object.is(current, nextValue)) return;
      current = nextValue;
      __readerController.invalidate();
    },
    get dispatch() {
      return dispatch;
    },
    get resources() {
      return resources;
    },
    set resources(nextValue: typeof resources) {
      if (Object.is(resources, nextValue)) return;
      resources = nextValue;
      __readerController.invalidate();
    },
    get lengths() {
      return lengths;
    },
    set lengths(nextValue: typeof lengths) {
      if (Object.is(lengths, nextValue)) return;
      lengths = nextValue;
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
    get value() {
      return value;
    },
    set value(nextValue: typeof value) {
      if (Object.is(value, nextValue)) return;
      value = nextValue;
      __readerController.invalidate();
    },
    get preview() {
      return preview;
    },
    set preview(nextValue: typeof preview) {
      if (Object.is(preview, nextValue)) return;
      preview = nextValue;
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
      if ('current' in next) api.current = next.current as typeof current;
    }
  };
  return api;
}
