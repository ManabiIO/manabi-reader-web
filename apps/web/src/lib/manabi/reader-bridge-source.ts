/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { request, IntegrationError } from './client';
import { captureLibraryOperation } from './operation-scope';
import { readRestoredBook } from '../functions/file-loaders/utils/restored-book';
import type { RestoredContent } from '../functions/file-loaders/utils/restored-book';
import { identifyReaderBook } from './reader-book-identity.ts';
import { canonical, decodeTitle, importFile } from './ttu-migration-format.ts';
import {
  projectReaderBridgeFiles,
  READER_BRIDGE_RECORD_LIMITS,
  type ReaderBridgeProjection,
  type ReaderBridgeFile
} from './reader-bridge-projection.ts';
import type { ReaderBridgeSnapshot } from './reader-bridge-plan.ts';

export interface DriveReaderSelection {
  owner: string;
  connection: string;
  root: string;
  folder: string;
  profile: ReaderBridgeSnapshot['profile'];
}
export interface DriveReaderPreview {
  title: string;
  characters: number;
  projection: ReaderBridgeProjection;
  packageId: string;
  ignoredFiles: number;
}
// Keep decoded bytes out of mutable UI state. Only a preview produced by the
// verified download path can be used for a local comparison, in its original
// account/session generation. This is an observation, never write authority.
const preparedPreviews = new WeakMap<
  DriveReaderPreview,
  {
    content: RestoredContent;
    selection: DriveReaderSelection;
    observation: Observation;
    assertCurrent(): void;
  }
>();

export function captureDriveReaderPreview(preview: DriveReaderPreview) {
  const prepared = preparedPreviews.get(preview);
  if (!prepared) throw new Error('Refresh the Google Drive preview before comparing a local copy.');
  prepared.assertCurrent();
  return {
    get content() {
      prepared.assertCurrent();
      return structuredClone(prepared.content);
    },
    selection: { ...prepared.selection },
    assertCurrent: prepared.assertCurrent
  };
}

/** Recheck the complete observed file set immediately before a reviewed local
 * receive. This is still an observation, not an atomic Drive transaction. */
export async function recheckDriveReaderPreview(preview: DriveReaderPreview, signal?: AbortSignal) {
  const prepared = preparedPreviews.get(preview);
  if (!prepared) throw new IntegrationError('conflict');
  prepared.assertCurrent();
  signal?.throwIfAborted();
  const { selection } = prepared;
  const path = `connections/${selection.connection}/reader-bridge/?${new URLSearchParams({ root: selection.root, folder: selection.folder, profile: selection.profile })}`;
  const current = observation(await request<unknown>(path, { userId: selection.owner }), selection);
  signal?.throwIfAborted();
  prepared.assertCurrent();
  if (canonical(current) !== canonical(prepared.observation))
    throw new IntegrationError('conflict');
}
interface ObservedFile {
  id: string;
  name: string;
  version: string;
  parents: string[];
  mime: string;
  size: number;
  md5: string;
  role: 'book' | 'resume' | 'statistics';
}
interface Observation {
  profile: ReaderBridgeSnapshot['profile'];
  generation: string;
  revision: string;
  folder: { id: string; name: string; parents: string[]; mime: string; version: string };
  files: ObservedFile[];
  ignoredFiles: number;
}
const limits = {
  book: 128 * 1024 * 1024,
  resume: READER_BRIDGE_RECORD_LIMITS.resumeBytes,
  statistics: READER_BRIDGE_RECORD_LIMITS.statisticsBytes
};
const id = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(value);
const uuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const plain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const name = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 8192 &&
  // eslint-disable-next-line no-control-regex
  ![/[/\\]/, /[\u0000-\u001f\u007f\ud800-\udfff]/u].some((pattern) => pattern.test(value));

function observation(value: unknown, selection: DriveReaderSelection): Observation {
  const fail = () => {
    throw new IntegrationError('invalid_response');
  };
  if (
    !plain(value) ||
    value.profile !== selection.profile ||
    !uuid(value.generation) ||
    typeof value.revision !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.revision) ||
    !plain(value.folder) ||
    value.folder.id !== selection.folder ||
    !name(value.folder.name) ||
    value.folder.mime !== 'application/vnd.google-apps.folder' ||
    canonical(value.folder.parents) !== canonical([selection.root]) ||
    typeof value.folder.version !== 'string' ||
    !/^\d{1,20}$/.test(value.folder.version) ||
    !Array.isArray(value.files) ||
    value.files.length < 1 ||
    value.files.length > 3 ||
    !Number.isSafeInteger(value.ignoredFiles) ||
    Number(value.ignoredFiles) < 0 ||
    Number(value.ignoredFiles) > 1000
  )
    return fail();
  const seen = new Set<string>(),
    roles = new Set<string>();
  const source = selection.profile.startsWith('yatsu-') ? 'yatsu' : 'ttu';
  const files: ObservedFile[] = [];
  for (const file of value.files) {
    if (
      !plain(file) ||
      !id(file.id) ||
      !name(file.name) ||
      typeof file.version !== 'string' ||
      !/^\d{1,20}$/.test(file.version) ||
      typeof file.md5 !== 'string' ||
      !/^[a-f0-9]{32}$/.test(file.md5) ||
      typeof file.mime !== 'string' ||
      !file.mime ||
      file.mime.length > 256 ||
      file.mime.startsWith('application/vnd.google-apps.') ||
      canonical(file.parents) !== canonical([selection.folder]) ||
      !['book', 'resume', 'statistics'].includes(String(file.role)) ||
      !Number.isSafeInteger(file.size) ||
      Number(file.size) <= 0 ||
      Number(file.size) > limits[file.role as keyof typeof limits] ||
      seen.has(file.id) ||
      roles.has(String(file.role))
    )
      return fail();
    const descriptor = importFile(file.name, source);
    if (
      !descriptor ||
      descriptor.part !== (file.role === 'resume' ? 'bookmark' : file.role) ||
      file.name.split('_').slice(1, 3).join('-') !== selection.profile.split('-').slice(1).join('-')
    )
      return fail();
    seen.add(file.id);
    roles.add(String(file.role));
    files.push({
      id: file.id,
      name: file.name,
      version: file.version,
      md5: file.md5,
      mime: file.mime,
      parents: [selection.folder],
      size: Number(file.size),
      role: file.role as ObservedFile['role']
    });
  }
  if (!roles.has('book')) return fail();
  return {
    profile: selection.profile,
    generation: value.generation,
    revision: value.revision,
    folder: {
      id: selection.folder,
      name: value.folder.name,
      mime: value.folder.mime,
      version: value.folder.version,
      parents: [selection.root]
    },
    files: files.sort((a, b) => a.id.localeCompare(b.id)),
    ignoredFiles: Number(value.ignoredFiles)
  };
}

/** Explicit read-only preview. No storage, baseline acknowledgement or remote
 * write. All related downloads and decoded identity share one rechecked manifest. */
export async function previewDriveReaderBridge(input: DriveReaderSelection, signal?: AbortSignal) {
  const selection = { ...input };
  if (
    !selection.owner ||
    !uuid(selection.connection) ||
    !id(selection.root) ||
    !id(selection.folder) ||
    selection.root === selection.folder ||
    !['ttu-1-6', 'ttu-1-7', 'ttu-1-8', 'yatsu-1-11'].includes(selection.profile)
  )
    throw new Error('Invalid reader library selection.');
  const scope = captureLibraryOperation(selection.owner);
  const check = () => {
    signal?.throwIfAborted();
    scope.assertCurrent();
  };
  const path = (operation: string, fields: Record<string, string> = {}) =>
    `connections/${selection.connection}/${operation}/?${new URLSearchParams({ root: selection.root, folder: selection.folder, profile: selection.profile, ...fields })}`;
  try {
    check();
    const before = observation(
      await request<unknown>(path('reader-bridge'), { userId: selection.owner }),
      selection
    );
    check();
    const read = async (file: ObservedFile) => {
      check();
      const bytes = await request<ArrayBuffer>(
        path('reader-bridge-file', {
          revision: before.revision,
          generation: before.generation,
          id: file.id
        }),
        { userId: selection.owner, binary: true, maximumBytes: limits[file.role] }
      );
      check();
      if (bytes.byteLength !== file.size) throw new IntegrationError('conflict');
      return bytes;
    };
    const packageFile = before.files.find((file) => file.role === 'book')!;
    const bytes = await read(packageFile);
    const content = await readRestoredBook(new Blob([bytes]), () => 'application/octet-stream', {
      signal: signal ? AbortSignal.any([signal, scope.signal]) : scope.signal
    });
    check();
    if (!content || content.title !== decodeTitle(before.folder.name))
      throw new Error('Book data and its library folder disagree.');
    const source = selection.profile.startsWith('yatsu-') ? 'yatsu' : 'ttu';
    const book = await identifyReaderBook(
      content,
      importFile(packageFile.name, source)!.characters ?? 0,
      signal
    );
    check();
    const files: ReaderBridgeFile[] = [];
    for (const file of before.files.filter((file) => file.role !== 'book'))
      files.push({
        name: file.name,
        body: new TextDecoder('utf-8', { fatal: true }).decode(await read(file))
      });
    const projection = await projectReaderBridgeFiles(
      {
        binding: await binding(selection, packageFile.id),
        generation: before.generation,
        profile: selection.profile,
        fingerprint: book.fingerprint,
        revision: before.revision
      },
      { title: content.title, characters: book.characters },
      files,
      signal
    );
    check();
    const after = observation(
      await request<unknown>(path('reader-bridge'), { userId: selection.owner }),
      selection
    );
    check();
    if (canonical(after) !== canonical(before)) throw new IntegrationError('conflict');
    const result = Object.freeze({
      title: content.title,
      characters: book.characters,
      projection,
      packageId: packageFile.id,
      ignoredFiles: before.ignoredFiles
    });
    preparedPreviews.set(result, { content, selection, observation: before, assertCurrent: check });
    return result;
  } finally {
    scope.stop();
  }
}

async function binding(selection: DriveReaderSelection, packageId: string) {
  const bytes = new TextEncoder().encode(
    canonical([
      'google',
      selection.owner,
      selection.connection,
      selection.root,
      selection.folder,
      packageId
    ])
  );
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}
