/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { localProfileUser, localUser } from '$lib/manabi/client';
import { listImportedNotes, restoreImportedNotes } from '$lib/manabi/imported-notes';
import { MigrationConflict } from '$lib/manabi/ttu-migration-format';
import type { ReaderImportRecord } from '$lib/data/database/books-db/versions/v10/books-db-v10';
import { ReaderController, type StoreValue } from './controller';
export interface NotesProps {
  bookId?: number;
  bookKey?: string;
  open?: boolean;
}

export function createNotes(
  props: NotesProps,
  emit: (name: string, detail?: unknown) => void = () => {}
) {
  const __readerController = new ReaderController();
  let nextSignature: string;
  let visible: ReaderImportRecord[];
  let $localUser: StoreValue<typeof localUser> = __readerController.read(localUser);
  let bookId = props.bookId !== undefined ? props.bookId : 0;
  let bookKey = props.bookKey !== undefined ? props.bookKey : '';
  let open = props.open !== undefined ? props.open : false;
  let records: ReaderImportRecord[] = [],
    editing = '',
    body = '',
    label = '',
    error = '',
    message = '',
    busy = false,
    mounted = false,
    serial = 0,
    signature = '',
    restorePickerOpen = false;
  let pendingArchive: string | undefined;
  __readerController.effect(
    () => [open, bookKey, $localUser],
    () => {
      __readerController.changed((nextSignature = JSON.stringify([open, bookKey, $localUser?.id])));
    }
  );
  __readerController.effect(
    () => [mounted, nextSignature],
    () => {
      if (mounted && signature !== nextSignature) {
        __readerController.changed((signature = nextSignature));
        __readerController.changed((editing = ''));
        __readerController.changed((pendingArchive = undefined));
        __readerController.changed((restorePickerOpen = false));
        __readerController.changed((records = []));
        // Schedule after this identity transition; the loader owns its request generation.
        void Promise.resolve().then(load);
      }
    }
  );
  __readerController.effect(
    () => [records],
    () => {
      __readerController.changed(
        (visible = records.filter((row) => !row.deletedAt && row.status !== 'anchored'))
      );
    }
  );
  async function load() {
    const run = __readerController.changed(++serial),
      key = bookKey,
      owner = localProfileUser()?.id ?? null;
    if (!open || !key) return;
    try {
      const rows = await listImportedNotes(key);
      if (run === serial && mounted && owner === (localProfileUser()?.id ?? null))
        __readerController.changed((records = rows));
    } catch (e) {
      if (run === serial && mounted) __readerController.changed((error = String(e)));
    }
  }
  async function action(work: () => Promise<void>) {
    if (busy) return;
    const identity = signature;
    __readerController.changed((busy = true));
    __readerController.changed((error = ''));
    try {
      await work();
      if (mounted && identity === signature) await load();
    } catch (e) {
      if (mounted && identity === signature)
        __readerController.changed((error = e instanceof Error ? e.message : String(e)));
    } finally {
      __readerController.changed((busy = false));
    }
  }
  function download(json: string) {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'manabi-imported-notes.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function restore(json: string, replace = false) {
    const identity = signature;
    try {
      const count = await restoreImportedNotes(json, bookId, bookKey, replace);
      if (!mounted || identity !== signature) return;
      __readerController.changed((pendingArchive = undefined));
      __readerController.changed((message = `${count} notebook record(s) restored.`));
    } catch (e) {
      if (mounted && identity === signature && e instanceof MigrationConflict)
        __readerController.changed((pendingArchive = json));
      throw e;
    }
  }
  __readerController.onMount(() => {
    __readerController.changed((mounted = true));
    return () => {
      __readerController.changed((mounted = false));
      __readerController.changed(serial++);
    };
  });
  __readerController.observeSource(
    () => localUser,
    (value) => {
      $localUser = value;
    }
  );
  const api = {
    controller: __readerController,
    load,
    action,
    download,
    restore,
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
    get open() {
      return open;
    },
    set open(nextValue: typeof open) {
      if (Object.is(open, nextValue)) return;
      open = nextValue;
      __readerController.invalidate();
    },
    get records() {
      return records;
    },
    set records(nextValue: typeof records) {
      if (Object.is(records, nextValue)) return;
      records = nextValue;
      __readerController.invalidate();
    },
    get editing() {
      return editing;
    },
    set editing(nextValue: typeof editing) {
      if (Object.is(editing, nextValue)) return;
      editing = nextValue;
      __readerController.invalidate();
    },
    get body() {
      return body;
    },
    set body(nextValue: typeof body) {
      if (Object.is(body, nextValue)) return;
      body = nextValue;
      __readerController.invalidate();
    },
    get label() {
      return label;
    },
    set label(nextValue: typeof label) {
      if (Object.is(label, nextValue)) return;
      label = nextValue;
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
    get message() {
      return message;
    },
    set message(nextValue: typeof message) {
      if (Object.is(message, nextValue)) return;
      message = nextValue;
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
    get mounted() {
      return mounted;
    },
    set mounted(nextValue: typeof mounted) {
      if (Object.is(mounted, nextValue)) return;
      mounted = nextValue;
      __readerController.invalidate();
    },
    get serial() {
      return serial;
    },
    set serial(nextValue: typeof serial) {
      if (Object.is(serial, nextValue)) return;
      serial = nextValue;
      __readerController.invalidate();
    },
    get signature() {
      return signature;
    },
    set signature(nextValue: typeof signature) {
      if (Object.is(signature, nextValue)) return;
      signature = nextValue;
      __readerController.invalidate();
    },
    get restorePickerOpen() {
      return restorePickerOpen;
    },
    set restorePickerOpen(nextValue: typeof restorePickerOpen) {
      if (Object.is(restorePickerOpen, nextValue)) return;
      restorePickerOpen = nextValue;
      __readerController.invalidate();
    },
    get pendingArchive() {
      return pendingArchive;
    },
    set pendingArchive(nextValue: typeof pendingArchive) {
      if (Object.is(pendingArchive, nextValue)) return;
      pendingArchive = nextValue;
      __readerController.invalidate();
    },
    get nextSignature() {
      return nextSignature;
    },
    set nextSignature(nextValue: typeof nextSignature) {
      if (Object.is(nextSignature, nextValue)) return;
      nextSignature = nextValue;
      __readerController.invalidate();
    },
    get visible() {
      return visible;
    },
    set visible(nextValue: typeof visible) {
      if (Object.is(visible, nextValue)) return;
      visible = nextValue;
      __readerController.invalidate();
    },
    get $localUser() {
      return $localUser;
    },
    updateProps(next: Record<string, unknown>) {
      if ('bookId' in next) api.bookId = next.bookId as typeof bookId;
      if ('bookKey' in next) api.bookKey = next.bookKey as typeof bookKey;
      if ('open' in next) api.open = next.open as typeof open;
    }
  };
  return api;
}
