/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { writable, derived, get } from '$lib/state/store';
export const account = writable({ status: 'available', session: null as any });
export const localUser = derived(account, (s) => s.session?.user ?? null);
let generation = 0;
export function changeUser(id: string | null) {
  generation++;
  account.set({ status: 'available', session: id ? { user: { id, username: id } } : null });
}
export function accountScope() {
  return { userId: get(localUser)?.id, generation };
}
export function scope() {
  const current = generation,
    owner = get(localUser) ? `account:${get(localUser).id}` : 'local';
  return {
    owner,
    guard() {
      if (current !== generation) throw new Error('The account changed.');
    }
  };
}
export const providerLabels: Record<string, string> = {
  google: 'Google Drive',
  dropbox: 'Dropbox'
};
export const snippetItems = writable<any[]>([]);
export const snippetStatus = writable({ busy: false, remaining: 0, issues: [] });
export const organization = writable({ collections: [] });
export const watchOrganization = () => () => {};
export const setMembershipMany = async () => {};
export const createCollection = async () => {};
export const memory = {
  sources: [] as any[],
  entries: [] as any[],
  folderReads: [] as any[],
  appends: [] as any[],
  progress: [] as any[],
  permissions: 0,
  mounts: 0,
  failFolders: false,
  beforeProgress: undefined as (() => Promise<void>) | undefined,
  beforeFolders: undefined as (() => Promise<void>) | undefined,
  beforeMkdir: undefined as (() => Promise<void>) | undefined
};
export const sourceDescriptors = async () => memory.sources;
export const capability = async () => ({ write: true });
export const folders = async (source: any, path: string, guard: () => void) => {
  memory.folderReads.push({ source, path });
  await memory.beforeFolders?.();
  guard();
  if (memory.failFolders) throw new Error('Cannot browse this source.');
  return memory.entries;
};
export const makeFolder = async (_dest: any, name: string, guard: () => void) => {
  await memory.beforeMkdir?.();
  guard();
  return `created-${name}`;
};
export const requestDocumentWriteAccess = async () => {
  memory.permissions++;
};
export const reconnectLocalLibrary = async () => {};
export const integrationDB = async () => ({ get: async () => undefined });
export const appendToSnippet = async (...args: any[]) => {
  memory.appends.push(args);
};
export const flushSnippets = async () => {};
export const refreshSnippet = async () => undefined;
export const refreshSnippets = async () => {};
export const reloadSnippets = async () => {};
export const suggestedDestination = async () => undefined;
export const rememberDestination = async () => {};
export const trashSnippet = async () => {};
export const resolveConflict = async () => {};
export const commitSnippet = async () => {};
export const currentTransfer = async () => undefined;
export const moveSnippet = async () => {};
export const resumeTransfer = async () => {};
export const keepBoth = async () => {};
export const saveProgress = async (...args: any[]) => {
  memory.progress.push(args);
  await memory.beforeProgress?.();
};
export const syncReading = async () => {};
export const touchReading = async () => {
  memory.mounts++;
};
export const searchBodies = (_query: string, _ids: string[], _scope: any, publish: any) => {
  publish({ hits: new Map(), busy: false, failed: 0, truncated: false });
  return () => {};
};
export const exportSnippets = async () => {};
export const restoreBackup = async () => ({ imported: 0 });
export const download = () => {};
export const MAX_BACKUP_BYTES = 32 * 1024 * 1024;
