/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  directoryName,
  encodeSeriesMetadata,
  decodeSeriesMetadata,
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
export function safePath(path: string): string[] {
  if (!path) return [];
  const parts = path.split('/');
  if (
    parts.some(
      (p) => !p || p === '.' || p === '..' || p === '.manabi-reader' || /[\\\x00-\x1f\x7f]/.test(p) // eslint-disable-line no-control-regex
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
async function writeFile(handle: FileSystemFileHandle, data: Blob | string) {
  const stream = await handle.createWritable();
  try {
    await stream.write(data);
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
  if (
    new Set(filenames.map((n) => n.normalize('NFC').toLocaleLowerCase('en-US'))).size !==
    unique.length
  )
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
function validate(plan: MovePlan) {
  if (
    plan.version !== 1 ||
    !/^[a-f0-9-]{36}$/.test(plan.id) ||
    !['prepared', 'copied', 'done'].includes(plan.phase)
  )
    throw new Error('Invalid move recovery record.');
  directoryName(plan.folder);
  safePath(plan.parent);
  if (plan.files.length < 2 || plan.files.length > 500)
    throw new Error('Invalid move recovery record.');
  const prefix = [plan.parent, plan.folder].filter(Boolean).join('/');
  const targets = new Set<string>(),
    originals = new Set<string>();
  for (const file of plan.files) {
    const name = safePath(file.from).at(-1);
    if (
      !name ||
      !/\.(epub|txt|htmlz)$/i.test(name) ||
      !/^[a-f0-9]{64}$/.test(file.hash) ||
      file.to !== `${prefix}/${name}` ||
      file.from.startsWith(`${prefix}/`) ||
      originals.has(file.from) ||
      targets.has(file.to.toLocaleLowerCase('en-US'))
    )
      throw new Error('Invalid move recovery path.');
    targets.add(file.to.toLocaleLowerCase('en-US'));
    originals.add(file.from);
  }
}
/**
 * No delete until EVERY destination is byte-verified. A restart uses the same durable plan.
 * External writers cannot be atomically locked by File System Access; a changed source or
 * destination stops recovery without guessing. The UI asks users to close external editors.
 */
export async function executeMove(
  root: FileSystemDirectoryHandle,
  plan: MovePlan,
  save: (plan: MovePlan) => Promise<void>,
  relocated: (file: MoveFile) => Promise<void>
) {
  validate(plan);
  if (plan.phase === 'done') return;
  const parent = await openDirectory(root, plan.parent);
  const folder = await parent.getDirectoryHandle(plan.folder, { create: true });
  const markerName = `.manabi-reader-operation-${plan.id}`;
  let marker: FileSystemFileHandle;
  if (await absent(() => folder.getFileHandle(markerName))) {
    for await (const _entry of folder.entries())
      throw new Error('The destination changed before the move started. Originals were kept.');
    marker = await folder.getFileHandle(markerName, { create: true });
    await writeFile(marker, plan.id);
  } else {
    marker = await folder.getFileHandle(markerName);
    if ((await (await marker.getFile()).text()) !== plan.id)
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
    const destination = await folder.getFileHandle(filename, { create: true });
    await writeFile(destination, original);
    if ((await digestFile(await destination.getFile())) !== item.hash)
      throw new Error('The copied book could not be verified. Originals were kept.');
  }
  const yaml = encodeSeriesMetadata(plan.name);
  if (await absent(() => folder.getFileHandle(seriesMetadataFilename)))
    await writeFile(await folder.getFileHandle(seriesMetadataFilename, { create: true }), yaml);
  else if (
    (await (await (await folder.getFileHandle(seriesMetadataFilename)).getFile()).text()) !== yaml
  )
    throw new Error('The destination series metadata changed. Originals were kept.');
  plan.phase = 'copied';
  await save(plan);
  for (const item of plan.files) {
    if ((await digestFile(await (await fileAt(root, item.to)).getFile())) !== item.hash)
      throw new Error('A destination changed. No more originals will be removed.');
    if (!(await absent(() => fileAt(root, item.from)))) {
      const original = await (await fileAt(root, item.from)).getFile();
      if ((await digestFile(original)) !== item.hash)
        throw new Error('An original changed. No more originals will be removed.');
      // Publish the new locator before deletion; interrupted moves remain readable at destination.
      await relocated(item);
      // Relinking is asynchronous: recheck after it, immediately before unlinking.
      if (
        (await digestFile(await (await fileAt(root, item.from)).getFile())) !== item.hash ||
        (await digestFile(await (await fileAt(root, item.to)).getFile())) !== item.hash
      )
        throw new Error('A file changed during the move. No more originals will be removed.');
      const parts = safePath(item.from),
        filename = parts.pop()!;
      await (await openDirectory(root, parts.join('/'))).removeEntry(filename);
    } else await relocated(item); // recovery after deletion but before journal acknowledgement
  }
  plan.phase = 'done';
  await save(plan);
  // Marker cleanup is cosmetic. A failed cleanup must not replay a completed move.
  await folder.removeEntry(markerName).catch(() => undefined);
}
export async function renameSeriesOnDisk(
  root: FileSystemDirectoryHandle,
  path: string,
  name: string
) {
  if (!path) throw new Error('The source root is not a series.');
  const directory = await openDirectory(root, path);
  const missing = await absent(() => directory.getFileHandle(seriesMetadataFilename));
  let before = '';
  if (!missing) {
    const file = await (await directory.getFileHandle(seriesMetadataFilename)).getFile();
    if (file.size > 4096) throw new Error('Series metadata is too large.');
    before = await file.text();
    decodeSeriesMetadata(before); // Do not destroy unknown/invalid YAML fields.
  }
  const handle = await directory.getFileHandle(seriesMetadataFilename, { create: true });
  if ((await (await handle.getFile()).text()) !== before)
    throw new Error('The series name changed elsewhere. Refresh before trying again.');
  await writeFile(handle, encodeSeriesMetadata(name));
}
