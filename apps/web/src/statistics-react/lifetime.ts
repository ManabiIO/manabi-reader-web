/** @license BSD-3-Clause; Copyright (c) 2026, ッツ Reader Authors */
/** @license BSD-3-Clause; Copyright (c) 2026, ッツ Reader Authors */
import { captureLibraryOperation } from '$lib/manabi/operation-scope';
import { dialogManager, type Dialog } from '$lib/data/dialog-manager';
import { statisticsActionInProgress$ } from '$lib/components/statistics/statistics-types';
import type { ReaderController } from '../reader-react/controller';

// A global button/action lease prevents a late result from an old route from
// releasing a newer route's progress overlay or admitting a duplicate mutation.
let activeAction: symbol | undefined;
export function statisticsLifetime(controller: ReaderController) {
  const scope = captureLibraryOperation();
  const ownedDialogs = new Set<Dialog>();
  const pending = new Set<(cancelled: boolean) => void>();
  let ownedAction: symbol | undefined;
  const current = () => {
    if (controller.disposed) return false;
    try {
      scope.assertCurrent();
      return true;
    } catch {
      return false;
    }
  };
  const clearDialogs = () => {
    for (const resolve of [...pending]) resolve(true);
    const existing = dialogManager.dialogs$.getValue();
    if (existing.some((dialog) => ownedDialogs.has(dialog)))
      dialogManager.dialogs$.next(existing.filter((dialog) => !ownedDialogs.has(dialog)));
    ownedDialogs.clear();
  };
  const showDialogs = (dialogs: Dialog[]) => {
    if (!current()) {
      for (const dialog of dialogs) dialog.props?.resolver?.(true);
      return;
    }
    const next = dialogs.map((dialog) => {
      const original = dialog.props?.resolver;
      if (!original) {
        ownedDialogs.add(dialog);
        return dialog;
      }
      const resolver = (cancelled: boolean) => {
        if (!pending.delete(resolver)) return;
        original(cancelled);
      };
      pending.add(resolver);
      const owned = { ...dialog, props: { ...dialog.props, resolver } };
      ownedDialogs.add(owned);
      return owned;
    });
    dialogManager.dialogs$.next(next);
  };
  const release = () => {
    if (ownedAction && activeAction === ownedAction) {
      activeAction = undefined;
      statisticsActionInProgress$.next(false);
    }
    ownedAction = undefined;
  };
  scope.signal.addEventListener('abort', clearDialogs);
  controller.onDestroy(() => {
    clearDialogs();
    release();
    scope.signal.removeEventListener('abort', clearDialogs);
    scope.stop();
  });
  async function run(work: () => Promise<void>) {
    if (!current()) {
      if (!activeAction) statisticsActionInProgress$.next(false);
      return;
    }
    if (activeAction) return;
    const owner = Symbol('statistics-action');
    activeAction = ownedAction = owner;
    statisticsActionInProgress$.next(true);
    try {
      await work();
    } finally {
      if (ownedAction === owner) release();
    }
  }
  return { current, showDialogs, run, signal: scope.signal };
}
