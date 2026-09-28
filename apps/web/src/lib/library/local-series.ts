/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { integrationDB, exclusive, type LocalLibrary } from '$lib/manabi/persistence';
import { refreshLinkedBooks } from '$lib/manabi/books';
import { captureLibraryOperation } from '$lib/manabi/operation-scope';
import { commitTransaction } from '$lib/data/database/books-db/commit-transaction.mjs';
import { sourceBookKey, relocatePresentation } from './organization';
import {
  planMove,
  executeMove,
  renameSeriesOnDisk,
  validateMovePlan,
  type FileChangeGuard,
  type MovePlan,
  type MoveFile
} from './file-operations';

type Operation = ReturnType<typeof captureLibraryOperation>;
const journalKey = (sourceId: string) => `library-file-operation:${sourceId}`;
// Capture before admission. A queued operation cannot follow a mutated selection,
// a disconnected/replaced folder, revoked write consent, or another local profile.
async function fileChange<T>(
  library: LocalLibrary,
  work: (library: LocalLibrary, beforeChange: FileChangeGuard, scope: Operation) => Promise<T>
) {
  const selected = { ...library };
  const scope = captureLibraryOperation();
  try {
    return await exclusive(
      'import-library-book',
      () =>
        exclusive(
          `library-files:${selected.id}`,
          async () => {
            const db = await integrationDB();
            const beforeChange = async () => {
              scope.assertCurrent();
              const current = await db.get('localLibraries', selected.id);
              scope.assertCurrent();
              if (!current || !(await current.handle.isSameEntry(selected.handle)))
                throw new Error(
                  'This local folder was disconnected or replaced. Reconnect it first.'
                );
              if (
                !current.writable ||
                (await current.handle.queryPermission({ mode: 'readwrite' })) !== 'granted'
              )
                throw new Error('Allow changes to this folder before changing its files.');
              scope.assertCurrent();
            };
            await beforeChange();
            return work(selected, beforeChange, scope);
          },
          scope.signal
        ),
      scope.signal
    );
  } finally {
    scope.stop();
  }
}
export async function pendingMoves(): Promise<MovePlan[]> {
  const db = await integrationDB(),
    tx = db.transaction('metadata');
  return commitTransaction(tx, async () => {
    const keys = await tx.store.getAllKeys(),
      values = await tx.store.getAll();
    const plans: MovePlan[] = [];
    for (const [index, key] of keys.entries()) {
      if (!key.startsWith('library-file-operation:')) continue;
      const plan = values[index] as MovePlan;
      validateMovePlan(plan);
      if (key !== journalKey(plan.sourceId)) throw new Error('Invalid move recovery source.');
      plans.push(plan);
    }
    return plans;
  });
}
async function relink(library: LocalLibrary, file: MoveFile, scope: Operation) {
  scope.assertCurrent();
  const db = await integrationDB(),
    tx = db.transaction(['books', 'localLibraries'], 'readwrite');
  const abort = () => {
    try {
      tx.abort();
    } catch {
      /* Already settled. */
    }
  };
  scope.signal.addEventListener('abort', abort, { once: true });
  try {
    await commitTransaction(tx, async () => {
      scope.assertCurrent();
      const current = await tx.objectStore('localLibraries').get(library.id);
      if (!current?.writable) throw new Error('This local folder is no longer writable.');
      const store = tx.objectStore('books');
      for (const link of await store.getAll()) {
        scope.assertCurrent();
        if (
          link.owner === null &&
          link.sourceId === library.id &&
          link.root === '' &&
          link.fileId === file.from &&
          link.contentHash === file.hash
        )
          await store.put({ ...link, fileId: file.to, name: file.to.split('/').at(-1)! });
      }
      scope.assertCurrent();
    });
  } finally {
    scope.signal.removeEventListener('abort', abort);
  }
  scope.assertCurrent();
  await relocatePresentation(
    sourceBookKey({ id: library.id, owner: null, root: '' }, file.from),
    sourceBookKey({ id: library.id, owner: null, root: '' }, file.to)
  );
}
async function run(
  library: LocalLibrary,
  plan: MovePlan,
  beforeChange: FileChangeGuard,
  scope: Operation
) {
  validateMovePlan(plan);
  if (plan.sourceId !== library.id) throw new Error('A move cannot cross storage sources.');
  const db = await integrationDB();
  await executeMove(
    library.handle,
    plan,
    (value) => db.put('metadata', value, journalKey(library.id)).then(() => undefined),
    (file) => relink(library, file, scope),
    beforeChange
  );
  await beforeChange();
  const tx = db.transaction('metadata', 'readwrite');
  await commitTransaction(tx, async () => {
    const current = (await tx.store.get(journalKey(library.id))) as MovePlan | undefined;
    if (current?.id !== plan.id || current.phase !== 'done')
      throw new Error('The move recovery record changed. Refresh before continuing.');
    scope.assertCurrent();
    await tx.store.delete(journalKey(library.id));
  });
  await refreshLinkedBooks();
}
async function requireNoPendingMove(library: LocalLibrary) {
  if (await (await integrationDB()).get('metadata', journalKey(library.id)))
    throw new Error('Resume the unfinished folder change before starting another.');
}
export async function createLocalSeries(
  library: LocalLibrary,
  parent: string,
  name: string,
  files: string[]
) {
  const selectedFiles = [...files];
  return fileChange(library, async (selected, beforeChange, scope) => {
    await requireNoPendingMove(selected);
    const plan = await planMove(selected.handle, selected.id, parent, name, selectedFiles);
    await beforeChange();
    // Durable before any file creation. Closing/reopening can resume this exact plan.
    await (await integrationDB()).put('metadata', plan, journalKey(selected.id));
    await run(selected, plan, beforeChange, scope);
  });
}
export async function resumeLocalSeries(library: LocalLibrary) {
  return fileChange(library, async (selected, beforeChange, scope) => {
    const plan = (await (await integrationDB()).get('metadata', journalKey(selected.id))) as
      | MovePlan
      | undefined;
    if (plan) await run(selected, plan, beforeChange, scope);
  });
}
export async function renameLocalSeries(library: LocalLibrary, path: string, name: string) {
  return fileChange(library, async (selected, beforeChange) => {
    // Changing the destination sidecar would make the saved move irrecoverable.
    await requireNoPendingMove(selected);
    await renameSeriesOnDisk(selected.handle, path, name, beforeChange);
  });
}
