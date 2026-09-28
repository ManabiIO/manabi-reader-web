/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  directoryName,
  encodeSeriesMetadata,
  decodeSeriesMetadata,
  legacySeriesMetadataFilename,
  seriesMetadataFilename
} from './series-metadata.ts';

export interface MoveFile {
  from: string;
  to: string;
  hash: string;
}
export interface MovePlan {
  version: 1;
  id: string;
  sourceId: string;
  parent: string;
  folder: string;
  name: string;
  files: MoveFile[];
  phase: 'prepared' | 'copied' | 'done';
}
export type FileChangeGuard = () => void | Promise<void>;
const unguarded: FileChangeGuard = () => {};
const portablePath = (path: string) => path.normalize('NFC').toLocaleLowerCase('en-US');

export function safePath(path: string): string[] {
  if (typeof path !== 'string') throw new Error('Invalid library path.');
  if (!path) return [];
  const parts = path.split('/');
  // Control characters and Windows separators must never enter a filesystem path.
  // eslint-disable-next-line no-control-regex
  const forbiddenCharacter = /[\\\x00-\x1f\x7f]/;
  if (
    parts.some(
      (p) => !p || p === '.' || p === '..' || p === '.manabi-reader' || forbiddenCharacter.test(p)
    )
  )
    throw new Error('Invalid library path.');
  return parts;
}
export async function openDirectory(root: FileSystemDirectoryHandle, path: string) {
  let directory = root;
  for (const part of safePath(path)) directory = await directory.getDirectoryHandle(part);
  return directory;
}
async function fileAt(root: FileSystemDirectoryHandle, path: string) {
  const parts = safePath(path),
    name = parts.pop();
  if (!name) throw new Error('Missing book filename.');
  return (await openDirectory(root, parts.join('/'))).getFileHandle(name);
}
async function absent(work: () => Promise<unknown>): Promise<boolean> {
  try {
    await work();
    return false;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'NotFoundError') return true;
    throw e;
  }
}
export async function digestFile(file: File): Promise<string> {
  if (file.size > 128 * 1024 * 1024) throw new Error('This book exceeds the 128 MiB file limit.');
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
}
async function readText(handle: FileSystemFileHandle, maximum = 4096) {
  const file = await handle.getFile();
  if (file.size > maximum) throw new Error('Series metadata or move marker is too large.');
  return file.text();
}
async function writeFile(
  handle: FileSystemFileHandle,
  data: Blob | string,
  beforeChange: FileChangeGuard,
  verify?: () => Promise<void>
) {
  await beforeChange();
  const stream = await handle.createWritable();
  try {
    await stream.write(data);
    await beforeChange();
    await verify?.();
    await beforeChange();
    await stream.close();
  } catch (error) {
    await stream.abort().catch(() => undefined);
    throw error;
  }
}
export async function planMove(
  root: FileSystemDirectoryHandle,
  sourceId: string,
  parent: string,
  name: string,
  files: string[]
): Promise<MovePlan> {
  const unique = [...new Set(files)];
  if (unique.length < 2 || unique.length > 500)
    throw new Error('Choose between 2 and 500 books in one connected folder source.');
  const folder = directoryName(name),
    parentDirectory = await openDirectory(root, parent);
  if (!(await absent(() => parentDirectory.getDirectoryHandle(folder))))
    throw new Error('A folder with that name already exists. Choose another name.');
  const filenames = unique.map((path) => safePath(path).at(-1)!);
  if (new Set(filenames.map(portablePath)).size !== unique.length)
    throw new Error(
      'Two selected books have the same filename. Rename one on disk before combining them.'
    );
  const moved: MoveFile[] = [];
  const prefix = [parent, folder].filter(Boolean).join('/');
  for (const from of unique) {
    if (!/\.(epub|txt|htmlz)$/i.test(from))
      throw new Error('Only ebook files can be combined into a series.');
    const handle = await fileAt(root, from),
      file = await handle.getFile();
    moved.push({ from, to: `${prefix}/${safePath(from).at(-1)}`, hash: await digestFile(file) });
  }
  return {
    version: 1,
    id: crypto.randomUUID(),
    sourceId,
    parent,
    folder,
    name,
    files: moved,
    phase: 'prepared'
  };
}
/** Validate the complete recovery record before any filesystem operation. */
export function validateMovePlan(plan: MovePlan) {
  if (
    !plan ||
    typeof plan !== 'object' ||
    plan.version !== 1 ||
    typeof plan.id !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(plan.id) ||
    typeof plan.sourceId !== 'string' ||
    !plan.sourceId ||
    typeof plan.folder !== 'string' ||
    typeof plan.name !== 'string' ||
    !Array.isArray(plan.files) ||
    !['prepared', 'copied', 'done'].includes(plan.phase)
  )
    throw new Error('Invalid move recovery record.');
  if (directoryName(plan.folder) !== plan.folder)
    throw new Error('Invalid move recovery folder.');
  encodeSeriesMetadata(plan.name);
  safePath(plan.parent);
  if (plan.files.length < 2 || plan.files.length > 500)
    throw new Error('Invalid move recovery record.');
  const prefix = [plan.parent, plan.folder].filter(Boolean).join('/');
  const targets = new Set<string>(),
    originals = new Set<string>();
  for (const file of plan.files) {
    if (!file || typeof file !== 'object' || typeof file.to !== 'string')
      throw new Error('Invalid move recovery path.');
    const name = safePath(file.from).at(-1);
    if (
      !name ||
      !/\.(epub|txt|htmlz)$/i.test(name) ||
      typeof file.hash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(file.hash) ||
      file.to !== `${prefix}/${name}` ||
      portablePath(file.from).startsWith(`${portablePath(prefix)}/`) ||
      originals.has(portablePath(file.from)) ||
      targets.has(portablePath(file.to))
    )
      throw new Error('Invalid move recovery path.');
    targets.add(portablePath(file.to));
    originals.add(portablePath(file.from));
  }
}
/**
 * No delete until EVERY destination is byte-verified. A restart uses the same durable plan.
 * External writers cannot be atomically locked by File System Access; a changed source or
 * destination stops recovery without guessing. The UI asks users to close external editors.
 */
export async function executeMove(
  root: FileSystemDirectoryHandle,
  selectedPlan: MovePlan,
  save: (plan: MovePlan) => Promise<void>,
  relocated: (file: MoveFile) => Promise<void>,
  beforeChange: FileChangeGuard = unguarded
) {
  // UI records and callback arguments are not the authority for later deletes.
  // Never let an await or a persistence callback retarget the validated plan.
  const plan = structuredClone(selectedPlan);
  validateMovePlan(plan);
  const checkpoint = async (phase: MovePlan['phase']) => {
    await beforeChange();
    await save(structuredClone({ ...plan, phase }));
    await beforeChange();
    plan.phase = phase;
  };
  await beforeChange();
  if (plan.phase === 'done') return;
  const parent = await openDirectory(root, plan.parent);
  await beforeChange();
  const folder = await parent.getDirectoryHandle(plan.folder, { create: true });
  const markerName = `.manabi-reader-operation-${plan.id}`;
  let marker: FileSystemFileHandle;
  if (await absent(() => folder.getFileHandle(markerName))) {
    for await (const _entry of folder.entries())
      throw new Error('The destination changed before the move started. Originals were kept.');
    await beforeChange();
    marker = await folder.getFileHandle(markerName, { create: true });
    await writeFile(marker, plan.id, beforeChange);
  } else {
    marker = await folder.getFileHandle(markerName);
    if ((await readText(marker, 64)) !== plan.id)
      throw new Error('The move marker changed. Originals were kept.');
  }
  for (const item of plan.files) {
    const filename = safePath(item.to).at(-1)!;
    const hasDestination = !(await absent(() => folder.getFileHandle(filename)));
    if (hasDestination) {
      if ((await digestFile(await (await folder.getFileHandle(filename)).getFile())) !== item.hash)
        throw new Error(
          `The destination copy of “${filename}” changed or is incomplete. Keep your original, remove the incomplete copy, then resume.`
        );
      continue;
    }
    const original = await (await fileAt(root, item.from)).getFile();
    if ((await digestFile(original)) !== item.hash)
      throw new Error(
        `“${filename}” changed since the move was prepared. No more originals will be removed.`
      );
    await beforeChange();
    const destination = await folder.getFileHandle(filename, { create: true });
    await writeFile(destination, original, beforeChange);
    if ((await digestFile(await destination.getFile())) !== item.hash)
      throw new Error('The copied book could not be verified. Originals were kept.');
  }
  const yaml = encodeSeriesMetadata(plan.name);
  if (await absent(() => folder.getFileHandle(seriesMetadataFilename))) {
    await beforeChange();
    await writeFile(
      await folder.getFileHandle(seriesMetadataFilename, { create: true }),
      yaml,
      beforeChange
    );
  } else if ((await readText(await folder.getFileHandle(seriesMetadataFilename))) !== yaml)
    throw new Error('The destination series metadata changed. Originals were kept.');
  await checkpoint('copied');
  for (const item of plan.files) {
    if ((await digestFile(await (await fileAt(root, item.to)).getFile())) !== item.hash)
      throw new Error('A destination changed. No more originals will be removed.');
    if (!(await absent(() => fileAt(root, item.from)))) {
      const original = await (await fileAt(root, item.from)).getFile();
      if ((await digestFile(original)) !== item.hash)
        throw new Error('An original changed. No more originals will be removed.');
      // Publish the new locator before deletion; interrupted moves remain readable at destination.
      await beforeChange();
      await relocated({ ...item });
      await beforeChange();
      // Relinking is asynchronous: recheck after it, immediately before unlinking.
      if (
        (await digestFile(await (await fileAt(root, item.from)).getFile())) !== item.hash ||
        (await digestFile(await (await fileAt(root, item.to)).getFile())) !== item.hash
      )
        throw new Error('A file changed during the move. No more originals will be removed.');
      const parts = safePath(item.from),
        filename = parts.pop()!;
      const originalDirectory = await openDirectory(root, parts.join('/'));
      await beforeChange();
      await originalDirectory.removeEntry(filename);
    } else {
      await beforeChange();
      await relocated({ ...item }); // recovery after deletion but before journal acknowledgement
    }
  }
  await checkpoint('done');
  // Marker cleanup is cosmetic. A failed cleanup must not replay a completed move.
  await folder.removeEntry(markerName).catch(() => undefined);
}
export async function renameSeriesOnDisk(
  root: FileSystemDirectoryHandle,
  path: string,
  name: string,
  beforeChange: FileChangeGuard = unguarded
) {
  if (!path) throw new Error('The source root is not a series.');
  // Validate before create:true can leave an empty canonical sidecar on failure.
  const yaml = encodeSeriesMetadata(name);
  await beforeChange();
  const directory = await openDirectory(root, path);
  const missing = await absent(() => directory.getFileHandle(seriesMetadataFilename));
  let before = '';
  let legacy: { handle: FileSystemFileHandle; text: string } | undefined;
  if (!missing) {
    before = await readText(await directory.getFileHandle(seriesMetadataFilename));
    decodeSeriesMetadata(before); // Do not destroy unknown/invalid YAML fields.
  } else if (!(await absent(() => directory.getFileHandle(legacySeriesMetadataFilename)))) {
    const handle = await directory.getFileHandle(legacySeriesMetadataFilename);
    const text = await readText(handle);
    decodeSeriesMetadata(text);
    legacy = { handle, text };
  }
  const verifyLegacy = async () => {
    if (legacy && (await readText(legacy.handle)) !== legacy.text)
      throw new Error('The series name changed elsewhere. Refresh before trying again.');
  };
  await beforeChange();
  await verifyLegacy();
  const handle = await directory.getFileHandle(seriesMetadataFilename, { create: true });
  const verify = async () => {
    if ((await readText(handle)) !== before)
      throw new Error('The series name changed elsewhere. Refresh before trying again.');
    await verifyLegacy();
  };
  try {
    await verify();
    // A stream is a staged replacement, not a compare-and-swap. Recheck after
    // async stream preparation so a concurrent rename is not silently overwritten.
    await writeFile(handle, yaml, beforeChange, verify);
  } catch (error) {
    // create:true precedes the staged write. Remove only its still-empty shell;
    // leaving it would mask a valid legacy sidecar. Never remove nonempty edits.
    if (missing) {
      try {
        if ((await handle.getFile()).size === 0)
          await directory.removeEntry(seriesMetadataFilename);
      } catch {
        /* Permission loss may prevent cleanup; preserve the original failure. */
      }
    }
    throw error;
  }
}
