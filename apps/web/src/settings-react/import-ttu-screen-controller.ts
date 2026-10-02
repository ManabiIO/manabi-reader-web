/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { beforeNavigate } from '$app/navigation';
import { consumeImportBootstrap } from '../runtime/import-bootstrap';

import {
  TtuMigration,
  migratedBookChoices,
  type MigrationItem,
  type MigratedBookChoice
} from '$lib/manabi/ttu-migration';
import { importLabels, MigrationConflict, type ImportPart } from '$lib/manabi/ttu-migration-format';
import { ReaderController } from '../reader-react/controller';
import { type SettingsContextValue } from './context';

export type ImportTtuScreenProps = Record<string, unknown>;

export function createImportTtuScreen(
  props: ImportTtuScreenProps,
  _emit: (name: string, detail?: unknown) => void = () => {},
  _componentContext: SettingsContextValue
) {
  const __readerController = new ReaderController();
  let visibleRows: Row[] = [];
  let selected: Row[] = [];
  let ignored = 0;

  interface Row extends MigrationItem {
    key: string;
    source: TtuMigration;
    selected: boolean;
    targetId: number;
    status: string;
    message: string;
    bookId?: number;
  }
  let filePicker: HTMLInputElement | null = null;
  let rows: Row[] = [];
  let sources: TtuMigration[] = [];
  let choices: MigratedBookChoice[] = [];
  let parts = Object.keys(importLabels).filter((part) => part !== 'settings') as ImportPart[];
  let busy = false;
  let message = '';
  let operationController: AbortController | undefined;
  let stopped = false;
  let completed = 0;
  let total = 0;
  let page = 0;
  let yatsu = false;
  const pageSize = 50;
  __readerController.effect(
    () => [rows, page, pageSize],
    () => {
      __readerController.changed(
        (visibleRows = rows.slice(page * pageSize, (page + 1) * pageSize))
      );
    }
  );
  __readerController.effect(
    () => [rows],
    () => {
      __readerController.changed((selected = rows.filter((row) => row.selected && !row.error)));
    }
  );
  __readerController.effect(
    () => [sources],
    () => {
      __readerController.changed(
        (ignored = sources.reduce((count, source) => count + source.ignoredFiles, 0))
      );
    }
  );
  function setRowSelection(key: string, selected: boolean) {
    if (busy) return;
    __readerController.changed(
      (rows = rows.map((row) => (row.key === key ? { ...row, selected } : row)))
    );
  }
  function setRowTarget(key: string, targetId: number) {
    if (busy) return;
    __readerController.changed(
      (rows = rows.map((row) => (row.key === key ? { ...row, targetId } : row)))
    );
  }
  function describe(error: unknown): string {
    if (error instanceof DOMException && error.name === 'QuotaExceededError')
      return 'Not enough browser storage. This item was not imported; completed items were kept.';
    return error instanceof Error ? error.message : 'This item could not be imported.';
  }
  function consumeSelection(input: HTMLInputElement) {
    if (busy) return;
    const files = [...(input.files ?? [])];
    if (!files.length) return;
    // Clear synchronously so a queued native change and onMount cannot consume
    // the same selection twice. The browser may have accepted it before hydration.
    input.value = '';
    void choose(files);
  }
  async function choose(files: File[]) {
    if (busy || !files.length) return;
    __readerController.changed((busy = true));
    __readerController.changed((message = ''));
    __readerController.changed((operationController = new AbortController()));
    for (const file of files) {
      if (operationController.signal.aborted || stopped) break;
      try {
        const source = await TtuMigration.inspect(file, operationController.signal);
        if (stopped) {
          await source.close();
          break;
        }
        __readerController.changed((sources = [...sources, source]));
        const sourceId = crypto.randomUUID();
        __readerController.changed(
          (rows = [
            ...rows,
            ...source.items.map((item) => ({
              ...item,
              source,
              key: `${sourceId}/${item.id}`,
              selected: !item.error && !item.parts.includes('settings'),
              targetId: 0,
              status: item.error ? 'error' : 'ready',
              message: item.error ?? ''
            }))
          ])
        );
      } catch (error) {
        if (!operationController.signal.aborted)
          __readerController.changed((message += `${file.name}: ${describe(error)} `));
      }
    }
    try {
      __readerController.changed((choices = await migratedBookChoices()));
    } catch (error) {
      __readerController.changed((message += describe(error)));
    }
    if (operationController.signal.aborted)
      __readerController.changed((message = 'Stopped inspecting files. Ready items were kept.'));
    __readerController.changed((busy = false));
  }
  async function run(items: Row[], replace = false) {
    if (busy || !items.length) return;
    __readerController.changed((busy = true));
    __readerController.changed((message = ''));
    __readerController.changed((operationController = new AbortController()));
    __readerController.changed((completed = 0));
    __readerController.changed((total = items.length));
    for (const row of items) {
      if (operationController.signal.aborted || stopped) break;
      row.status = 'importing';
      row.message = 'Importing…';
      __readerController.changed(
        (rows = rows.map((item) => (item.key === row.key ? { ...row } : item)))
      );
      try {
        const result = await row.source.importItem(
          row.id,
          { parts, targetId: row.targetId || undefined, replace },
          operationController.signal
        );
        row.status = result.status;
        row.message =
          result.status === 'unchanged'
            ? 'Already imported; existing data kept.'
            : `Imported ${result.title}.`;
        if (result.warning) row.message += ` ${result.warning}`;
        row.bookId = result.bookId;
        row.selected = false;
      } catch (error) {
        row.status = error instanceof MigrationConflict ? 'conflict' : 'error';
        row.message = operationController.signal.aborted
          ? 'Cancelled. This item was not imported.'
          : describe(error);
      }
      __readerController.changed(completed++);
      __readerController.changed(
        (rows = rows.map((item) => (item.key === row.key ? { ...row } : item)))
      );
    }
    await Promise.all(sources.map((source) => source.close().catch(() => undefined)));
    let refreshError = '';
    try {
      __readerController.changed((choices = await migratedBookChoices()));
    } catch (error) {
      refreshError = describe(error);
    }
    __readerController.changed(
      (message = operationController.signal.aborted
        ? 'Stopped. Completed imports were kept; unfinished items can be retried.'
        : 'Finished. Your original ZIPs are unchanged.')
    );
    if (refreshError) __readerController.changed((message += ` ${refreshError}`));
    __readerController.changed((busy = false));
  }
  function cancel() {
    operationController?.abort();
  }
  function clear() {
    if (busy) return;
    void Promise.all(sources.map((source) => source.close().catch(() => undefined)));
    __readerController.changed((page = 0));
    __readerController.changed((rows = []));
    __readerController.changed((sources = []));
    __readerController.changed((message = ''));
    __readerController.changed((completed = 0));
    __readerController.changed((total = 0));
  }
  __readerController.onDestroy(
    beforeNavigate(({ cancel: prevent, type }) => {
      if (!busy) return;
      if (type === 'leave') {
        prevent();
        return;
      }
      if (!window.confirm('Stop importing? Completed imports will be kept.')) prevent();
      else cancel();
    })
  );
  __readerController.onMount(() => {
    __readerController.changed(
      (yatsu = new URLSearchParams(window.location.search).get('source') === 'yatsu')
    );
    consumeImportBootstrap(consumeSelection);
    if (filePicker) consumeSelection(filePicker);
    void migratedBookChoices()
      .then((value) => {
        if (!stopped) __readerController.changed((choices = value));
      })
      .catch((error) => {
        if (!stopped) __readerController.changed((message = describe(error)));
      });
  });
  __readerController.onDestroy(() => {
    __readerController.changed((stopped = true));
    cancel();
    void Promise.all(sources.map((source) => source.close().catch(() => undefined)));
  });

  const api = {
    controller: __readerController,
    setRowSelection,
    setRowTarget,
    describe,
    consumeSelection,
    choose,
    run,
    cancel,
    clear,
    get filePicker() {
      return filePicker;
    },
    set filePicker(nextValue: typeof filePicker) {
      if (Object.is(filePicker, nextValue)) return;
      filePicker = nextValue;
      __readerController.invalidate();
    },
    get rows() {
      return rows;
    },
    set rows(nextValue: typeof rows) {
      if (Object.is(rows, nextValue)) return;
      rows = nextValue;
      __readerController.invalidate();
    },
    get sources() {
      return sources;
    },
    set sources(nextValue: typeof sources) {
      if (Object.is(sources, nextValue)) return;
      sources = nextValue;
      __readerController.invalidate();
    },
    get choices() {
      return choices;
    },
    set choices(nextValue: typeof choices) {
      if (Object.is(choices, nextValue)) return;
      choices = nextValue;
      __readerController.invalidate();
    },
    get parts() {
      return parts;
    },
    set parts(nextValue: typeof parts) {
      if (Object.is(parts, nextValue)) return;
      parts = nextValue;
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
    get message() {
      return message;
    },
    set message(nextValue: typeof message) {
      if (Object.is(message, nextValue)) return;
      message = nextValue;
      __readerController.invalidate();
    },
    get operationController() {
      return operationController;
    },
    set operationController(nextValue: typeof operationController) {
      if (Object.is(operationController, nextValue)) return;
      operationController = nextValue;
      __readerController.invalidate();
    },
    get stopped() {
      return stopped;
    },
    set stopped(nextValue: typeof stopped) {
      if (Object.is(stopped, nextValue)) return;
      stopped = nextValue;
      __readerController.invalidate();
    },
    get completed() {
      return completed;
    },
    set completed(nextValue: typeof completed) {
      if (Object.is(completed, nextValue)) return;
      completed = nextValue;
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
    get page() {
      return page;
    },
    set page(nextValue: typeof page) {
      if (Object.is(page, nextValue)) return;
      page = nextValue;
      __readerController.invalidate();
    },
    get yatsu() {
      return yatsu;
    },
    set yatsu(nextValue: typeof yatsu) {
      if (Object.is(yatsu, nextValue)) return;
      yatsu = nextValue;
      __readerController.invalidate();
    },
    get pageSize() {
      return pageSize;
    },
    get visibleRows() {
      return visibleRows;
    },
    set visibleRows(nextValue: typeof visibleRows) {
      if (Object.is(visibleRows, nextValue)) return;
      visibleRows = nextValue;
      __readerController.invalidate();
    },
    get selected() {
      return selected;
    },
    set selected(nextValue: typeof selected) {
      if (Object.is(selected, nextValue)) return;
      selected = nextValue;
      __readerController.invalidate();
    },
    get ignored() {
      return ignored;
    },
    set ignored(nextValue: typeof ignored) {
      if (Object.is(ignored, nextValue)) return;
      ignored = nextValue;
      __readerController.invalidate();
    },
    updateProps(_next: Record<string, unknown>) {}
  };
  return api;
}
