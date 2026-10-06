/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export interface SnippetAuthority {
  key: string;
  signal: AbortSignal;
  assertCurrent(): void;
}
export interface NativeSnippetRow {
  key: string;
  title: string;
  excerpt: string;
  modifiedAt: number;
  trashed: boolean;
  pending: boolean;
  conflicts: number;
  issue?: string;
  destination: string;
}
export interface NativeSnippetSource {
  key: string;
  name: string;
  provider: string;
  writable: boolean;
  reason?: string;
}
export interface NativeSnippetRun {
  key: string;
  block: string;
  text: string;
  ruby?: string;
  marks: string[];
  empty?: boolean;
}
export interface NativeSnippetEditor {
  key: string;
  token: string;
  title: string;
  runs: NativeSnippetRun[];
  source: { title: string; url: string };
  destination: string;
  destinationKey?: string;
  canChooseDestination: boolean;
  hasConflict: boolean;
  notice: string;
}
export interface NativeSnippetsState {
  token: string;
  items: NativeSnippetRow[];
  total: number;
  page: number;
  pages: number;
  drafts: { key: string; title: string; updatedAt: number }[];
  sources: NativeSnippetSource[];
  searchComplete: boolean;
  notices: string[];
}
export interface NativeSnippetPatch {
  title: string;
  runs: { key: string; text: string; ruby?: string }[];
  source: { title: string; url: string };
  append?: string;
  destinationKey?: string | null;
}
export interface NativeSnippetFolders {
  destinationKey: string;
  name: string;
  folders: { key: string; name: string }[];
}
export interface NativeSnippetResult {
  editor?: NativeSnippetEditor;
  saved?: boolean;
  folders?: NativeSnippetFolders;
  readerId?: string;
  readerRevision?: string;
}
export type NativeSnippetAction =
  | { type: 'new'; token: string }
  | { type: 'edit' | 'duplicate' | 'trash' | 'restore' | 'read'; token: string; key: string }
  | { type: 'resume'; token: string; key: string }
  | {
      type: 'checkpoint' | 'save' | 'save-copy';
      token: string;
      key: string;
      patch: NativeSnippetPatch;
    }
  | { type: 'discard'; token: string; key: string }
  | { type: 'browse'; token: string; key: string };
export interface NativeSnippetsClient {
  request(
    method: 'snippets.state' | 'snippets.action',
    payload: Record<string, unknown>
  ): Promise<unknown>;
}
