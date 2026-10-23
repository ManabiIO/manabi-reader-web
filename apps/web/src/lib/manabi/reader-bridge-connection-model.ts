/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { canonical } from './ttu-migration-format';
import type { ReaderBridgeSnapshot } from './reader-bridge-plan';

export const READER_BRIDGE_CONNECTION_LIMITS = Object.freeze({
  records: 1000,
  recordBytes: 32768,
  accountBytes: 2 * 1024 * 1024
});
export interface ReaderBridgeConnectionDescriptor {
  accountId: string;
  binding: string;
  title: string;
  fingerprint: string;
  characters: number;
  local: { bookId: number; identity: string };
  source: {
    provider: 'google';
    connection: string;
    generation: string;
    root: string;
    folder: string;
    packageId: string;
    profile: ReaderBridgeSnapshot['profile'];
    observedRevision: string;
    files: { role: 'book' | 'resume' | 'statistics'; id: string; version: string; md5: string }[];
  };
}
/** A linked record remembers an explicitly verified pair. Neither state grants
 * automatic receive, upload or scheduler authority. Restored local IDs are hints. */
export interface ReaderBridgeConnectionRecord {
  id: string;
  version: 1;
  revision: string;
  accountId: string;
  binding: string;
  bookId: number;
  state: 'linked' | 'restored';
  descriptor: ReaderBridgeConnectionDescriptor;
}
export class ReaderBridgeConnectionError extends Error {
  constructor(public readonly code: 'invalid' | 'changed' | 'exists' | 'capacity') {
    super(
      {
        invalid: 'The saved reader connection could not be verified.',
        changed: 'The book or connection changed. Compare the current copies again.',
        exists:
          'This book already has a different saved reader connection. Remove it before connecting another copy.',
        capacity:
          'Saved reader connection storage is full. Review your saved connections before adding another.'
      }[code]
    );
  }
}
const fail = (): never => {
  throw new ReaderBridgeConnectionError('invalid');
};
export const connectionUuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const digest = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const providerId = (value: unknown) =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(value);
const text = (value: unknown, max: number) =>
  typeof value === 'string' && !!value && value.length <= max;
const positive = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0;
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    fail();
  return value as Record<string, unknown>;
}
export const connectionBytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;
export function validateReaderBridgeConnectionDescriptor(
  input: unknown
): ReaderBridgeConnectionDescriptor {
  const v = object(input, [
    'accountId',
    'binding',
    'title',
    'fingerprint',
    'characters',
    'local',
    'source'
  ]);
  const local = object(v.local, ['bookId', 'identity']);
  const source = object(v.source, [
    'provider',
    'connection',
    'generation',
    'root',
    'folder',
    'packageId',
    'profile',
    'observedRevision',
    'files'
  ]);
  if (
    !text(v.accountId, 512) ||
    !text(v.title, 4096) ||
    !digest(v.binding) ||
    !digest(v.fingerprint) ||
    !Number.isSafeInteger(v.characters) ||
    Number(v.characters) < 0 ||
    !positive(local.bookId) ||
    !connectionUuid(local.identity) ||
    source.provider !== 'google' ||
    !connectionUuid(source.connection) ||
    !connectionUuid(source.generation) ||
    !providerId(source.root) ||
    !providerId(source.folder) ||
    source.root === source.folder ||
    !providerId(source.packageId) ||
    !digest(source.observedRevision) ||
    !['ttu-1-6', 'ttu-1-7', 'ttu-1-8', 'yatsu-1-11'].includes(String(source.profile)) ||
    !Array.isArray(source.files) ||
    source.files.length < 1 ||
    source.files.length > 3
  )
    fail();
  const roles = new Set(),
    ids = new Set();
  for (const item of source.files as unknown[]) {
    const file = object(item, ['role', 'id', 'version', 'md5']);
    if (
      !['book', 'resume', 'statistics'].includes(String(file.role)) ||
      roles.has(file.role) ||
      !providerId(file.id) ||
      ids.has(file.id) ||
      typeof file.version !== 'string' ||
      !/^\d{1,20}$/.test(file.version) ||
      typeof file.md5 !== 'string' ||
      !/^[a-f0-9]{32}$/.test(file.md5) ||
      (file.role === 'book' && file.id !== source.packageId)
    )
      fail();
    roles.add(file.role);
    ids.add(file.id);
  }
  if (!roles.has('book') || connectionBytes(v) > READER_BRIDGE_CONNECTION_LIMITS.recordBytes)
    fail();
  return structuredClone(v) as unknown as ReaderBridgeConnectionDescriptor;
}
export async function connectionDigest(value: unknown) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)))
    ),
    (byte) => byte.toString(16).padStart(2, '0')
  ).join('');
}
export async function verifyReaderBridgeConnectionDescriptor(input: unknown) {
  const value = validateReaderBridgeConnectionDescriptor(input);
  const source = value.source;
  if (
    value.binding !==
    (await connectionDigest([
      'google',
      value.accountId,
      source.connection,
      source.root,
      source.folder,
      source.packageId
    ]))
  )
    fail();
  return value;
}
export function validateReaderBridgeConnectionRecord(input: unknown): ReaderBridgeConnectionRecord {
  const value = object(input, [
    'id',
    'version',
    'revision',
    'accountId',
    'binding',
    'bookId',
    'state',
    'descriptor'
  ]);
  const descriptor = validateReaderBridgeConnectionDescriptor(value.descriptor);
  if (
    value.version !== 1 ||
    !connectionUuid(value.revision) ||
    !['linked', 'restored'].includes(String(value.state)) ||
    (value.state === 'linked'
      ? !connectionUuid(value.id)
      : typeof value.id !== 'string' || !/^recovery:[a-f0-9]{64}$/.test(value.id)) ||
    value.accountId !== descriptor.accountId ||
    value.binding !== descriptor.binding ||
    value.bookId !== descriptor.local.bookId
  )
    fail();
  return { ...value, descriptor } as unknown as ReaderBridgeConnectionRecord;
}
export function assertReaderBridgeConnectionCapacity(
  rows: readonly ReaderBridgeConnectionRecord[]
) {
  if (
    rows.length > READER_BRIDGE_CONNECTION_LIMITS.records ||
    rows.reduce((total, row) => total + connectionBytes(row), 0) >
      READER_BRIDGE_CONNECTION_LIMITS.accountBytes
  )
    throw new ReaderBridgeConnectionError('capacity');
}
