/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { integrationDB, exclusive, type LocalLibrary } from '$lib/manabi/persistence';
import { refreshLinkedBooks } from '$lib/manabi/books';
import { sourceBookKey, relocatePresentation } from './organization';
import {
  planMove,
  executeMove,
  renameSeriesOnDisk,
  type MovePlan,
  type MoveFile
} from './file-operations';

const journalKey = (sourceId: string) => `library-file-operation:${sourceId}`;
// Share the import admission lock: a read/import of the old path cannot publish
// its locator after the file was moved. Browser Web Locks also cover other tabs.
const fileChange = <T>(library: LocalLibrary, work: () => Promise<T>) =>
  exclusive('import-library-book', () => exclusive(`library-files:${library.id}`, work));
export async function pendingMoves(): Promise<MovePlan[]> {
  const db = await integrationDB(),
    tx = db.transaction('metadata');
  const keys = await tx.store.getAllKeys(),
    values = await tx.store.getAll();
  await tx.done;
  return values.filter((_, i) => keys[i].startsWith('library-file-operation:')) as MovePlan[];
}
async function relink(library: LocalLibrary, file: MoveFile) {
  const db = await integrationDB(),
    tx = db.transaction('books', 'readwrite');
  for (const link of await tx.store.getAll()) {
    if (
      link.owner === null &&
      link.sourceId === library.id &&
      link.root === '' &&
      link.fileId === file.from &&
      link.contentHash === file.hash
    )
      await tx.store.put({ ...link, fileId: file.to, name: file.to.split('/').at(-1)! });
  }
  await tx.done;
  await relocatePresentation(
    sourceBookKey({ id: library.id, owner: null, root: '' }, file.from),
    sourceBookKey({ id: library.id, owner: null, root: '' }, file.to)
  );
}
async function run(library: LocalLibrary, plan: MovePlan) {
  if (plan.sourceId !== library.id) throw new Error('A move cannot cross storage sources.');
  if (
    !library.writable ||
    (await library.handle.queryPermission({ mode: 'readwrite' })) !== 'granted'
  )
    throw new Error('Allow changes to this folder before moving books.');
  const db = await integrationDB();
  await executeMove(
    library.handle,
    plan,
    (value) =>
      db.put('metadata', structuredClone(value), journalKey(library.id)).then(() => undefined),
    (file) => relink(library, file)
  );
  await db.delete('metadata', journalKey(library.id));
  await refreshLinkedBooks();
}
export async function createLocalSeries(
  library: LocalLibrary,
  parent: string,
  name: string,
  files: string[]
) {
  return fileChange(library, async () => {
    const db = await integrationDB();
    if (await db.get('metadata', journalKey(library.id)))
      throw new Error('Resume the unfinished folder change before starting another.');
    const plan = await planMove(library.handle, library.id, parent, name, files);
    // Durable before any file creation. Closing/reopening this browser can resume the same plan.
    await db.put('metadata', plan, journalKey(library.id));
    await run(library, plan);
  });
}
export async function resumeLocalSeries(library: LocalLibrary) {
  return fileChange(library, async () => {
    const plan = (await (await integrationDB()).get('metadata', journalKey(library.id))) as
      | MovePlan
      | undefined;
    if (plan) await run(library, plan);
  });
}
export async function renameLocalSeries(library: LocalLibrary, path: string, name: string) {
  return fileChange(library, async () => {
    if (
      !library.writable ||
      (await library.handle.queryPermission({ mode: 'readwrite' })) !== 'granted'
    )
      throw new Error('Allow changes to this folder before renaming a series.');
    await renameSeriesOnDisk(library.handle, path, name);
  });
}
