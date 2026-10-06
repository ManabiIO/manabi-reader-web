/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { ReaderAnnotation } from '$lib/data/database/books-db/versions/v7/books-db-v7';
import type { AnnotationImportConflict } from '$lib/reader-annotations';
import { ReaderController, readerTick } from './controller';
export interface AnnotationsProps {
  open?: boolean;
  bookId?: number;
  bookKey?: string;
  annotations?: ReaderAnnotation[];
  importConflicts?: AnnotationImportConflict[];
  hasSelection?: boolean;
  error?: string;
  busy?: boolean;
  status?: string;
  savedVersion?: number;
}

export function createAnnotations(
  props: AnnotationsProps,
  emit: (name: string, detail?: unknown) => void = () => {}
) {
  const __readerController = new ReaderController();

  let open = props.open !== undefined ? props.open : false;
  let bookId = props.bookId !== undefined ? props.bookId : 0;
  let bookKey = props.bookKey !== undefined ? props.bookKey : '';
  let annotations: ReaderAnnotation[] = props.annotations !== undefined ? props.annotations : [];
  let importConflicts: AnnotationImportConflict[] =
    props.importConflicts !== undefined ? props.importConflicts : [];
  let hasSelection = props.hasSelection !== undefined ? props.hasSelection : false;
  let error = props.error !== undefined ? props.error : '';
  let busy = props.busy !== undefined ? props.busy : false;
  let status = props.status !== undefined ? props.status : '';
  let savedVersion = props.savedVersion !== undefined ? props.savedVersion : 0;
  let note = '';
  let contentElement: HTMLElement | null = null;
  let pendingRemoval:
    | {
        id: string;
        index: number;
      }
    | undefined;
  let pendingRemovalSawBusy = false;
  __readerController.effect(
    () => [savedVersion],
    () => {
      if (savedVersion > 0) __readerController.changed((note = ''));
    }
  );
  __readerController.effect(
    () => [pendingRemoval, busy],
    () => {
      if (pendingRemoval && busy) __readerController.changed((pendingRemovalSawBusy = true));
    }
  );
  __readerController.effect(
    () => [busy],
    () => {
      if (pendingRemoval && pendingRemovalSawBusy && !busy) {
        const pending = pendingRemoval;
        __readerController.changed((pendingRemoval = undefined));
        __readerController.changed((pendingRemovalSawBusy = false));
        void restoreRemovalFocus(pending.index);
      }
    }
  );
  const dispatch = (name: string, detail?: unknown) => emit(name, detail);
  function addNote() {
    const value = note.trim();
    if (!value || busy) return;
    dispatch('note', value);
  }
  async function restoreRemovalFocus(index: number) {
    await readerTick();
    const removes = contentElement?.querySelectorAll<HTMLButtonElement>(
      'button[data-annotation-remove]'
    );
    if (removes?.length) {
      removes[Math.min(index, removes.length - 1)]?.focus({ preventScroll: true });
      return;
    }
    contentElement
      ?.querySelector<HTMLButtonElement>('[data-annotations-primary]')
      ?.focus({ preventScroll: true });
  }
  function removeWithFocus(id: string, index: number) {
    if (busy) return;
    __readerController.changed((pendingRemoval = { id, index }));
    __readerController.changed((pendingRemovalSawBusy = false));
    contentElement?.focus({ preventScroll: true });
    dispatch('remove', id);
  }

  const api = {
    controller: __readerController,
    addNote,
    restoreRemovalFocus,
    removeWithFocus,
    get open() {
      return open;
    },
    set open(nextValue: typeof open) {
      if (Object.is(open, nextValue)) return;
      open = nextValue;
      __readerController.invalidate();
    },
    get bookId() {
      return bookId;
    },
    set bookId(nextValue: typeof bookId) {
      if (Object.is(bookId, nextValue)) return;
      bookId = nextValue;
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
    get annotations() {
      return annotations;
    },
    set annotations(nextValue: typeof annotations) {
      if (Object.is(annotations, nextValue)) return;
      annotations = nextValue;
      __readerController.invalidate();
    },
    get importConflicts() {
      return importConflicts;
    },
    set importConflicts(nextValue: typeof importConflicts) {
      if (Object.is(importConflicts, nextValue)) return;
      importConflicts = nextValue;
      __readerController.invalidate();
    },
    get hasSelection() {
      return hasSelection;
    },
    set hasSelection(nextValue: typeof hasSelection) {
      if (Object.is(hasSelection, nextValue)) return;
      hasSelection = nextValue;
      __readerController.invalidate();
    },
    get error() {
      return error;
    },
    set error(nextValue: typeof error) {
      if (Object.is(error, nextValue)) return;
      error = nextValue;
      __readerController.invalidate();
    },
    get busy() {
      return busy;
    },
    set busy(nextValue: typeof busy) {
      if (Object.is(busy, nextValue)) return;
      busy = nextValue;
      __readerController.invalidate();
    },
    get status() {
      return status;
    },
    set status(nextValue: typeof status) {
      if (Object.is(status, nextValue)) return;
      status = nextValue;
      __readerController.invalidate();
    },
    get savedVersion() {
      return savedVersion;
    },
    set savedVersion(nextValue: typeof savedVersion) {
      if (Object.is(savedVersion, nextValue)) return;
      savedVersion = nextValue;
      __readerController.invalidate();
    },
    get note() {
      return note;
    },
    set note(nextValue: typeof note) {
      if (Object.is(note, nextValue)) return;
      note = nextValue;
      __readerController.invalidate();
    },
    get contentElement() {
      return contentElement;
    },
    set contentElement(nextValue: typeof contentElement) {
      if (Object.is(contentElement, nextValue)) return;
      contentElement = nextValue;
      __readerController.invalidate();
    },
    get pendingRemoval() {
      return pendingRemoval;
    },
    set pendingRemoval(nextValue: typeof pendingRemoval) {
      if (Object.is(pendingRemoval, nextValue)) return;
      pendingRemoval = nextValue;
      __readerController.invalidate();
    },
    get pendingRemovalSawBusy() {
      return pendingRemovalSawBusy;
    },
    set pendingRemovalSawBusy(nextValue: typeof pendingRemovalSawBusy) {
      if (Object.is(pendingRemovalSawBusy, nextValue)) return;
      pendingRemovalSawBusy = nextValue;
      __readerController.invalidate();
    },
    get dispatch() {
      return dispatch;
    },
    updateProps(next: Record<string, unknown>) {
      if ('open' in next) api.open = next.open as typeof open;
      if ('bookId' in next) api.bookId = next.bookId as typeof bookId;
      if ('bookKey' in next) api.bookKey = next.bookKey as typeof bookKey;
      if ('annotations' in next) api.annotations = next.annotations as typeof annotations;
      if ('importConflicts' in next)
        api.importConflicts = next.importConflicts as typeof importConflicts;
      if ('hasSelection' in next) api.hasSelection = next.hasSelection as typeof hasSelection;
      if ('error' in next) api.error = next.error as typeof error;
      if ('busy' in next) api.busy = next.busy as typeof busy;
      if ('status' in next) api.status = next.status as typeof status;
      if ('savedVersion' in next) api.savedVersion = next.savedVersion as typeof savedVersion;
    }
  };
  return api;
}
