/* SPDX-License-Identifier: GPL-3.0-or-later */
/** Reader's narrow boundary to the independently versioned ManabiTan web artifact. */
export type Provider = 'builtin' | 'extension' | 'off';
export type DefaultChoice = 'unasked' | 'declined' | 'installed' | 'deleted';
export interface DictionaryStatus {
  dictionaries: Array<{ title: string; revision: string; importSuccess?: boolean }>;
  preferences: { disabled: string[]; defaultChoice: DefaultChoice; defaultTitle: string | null };
  counts: { counts: Array<{ terms?: number; termMeta?: number; kanji?: number; kanjiMeta?: number }> };
  storage: { usage?: number; quota?: number; persisted: boolean };
}
export interface Result { dictionaryEntries: unknown[]; originalTextLength?: number }
export interface OperationOptions { signal?: AbortSignal; onProgress?: (value: unknown) => void }
export interface WebClient {
  open(): Promise<DictionaryStatus>;
  close(): Promise<void>;
  status(options?: OperationOptions): Promise<DictionaryStatus>;
  lookup(text: string, options?: OperationOptions): Promise<Result>;
  importDictionary(archive: Blob, options?: OperationOptions): Promise<{
    summary: { title: string }; status: DictionaryStatus; warnings: string[]; cancelledAfterCommit: boolean
  }>;
  setEnabled(title: string, enabled: boolean): Promise<DictionaryStatus>;
  deleteDictionary(title: string, options?: OperationOptions): Promise<DictionaryStatus>;
  setDefault(choice: Exclude<DefaultChoice, 'unasked'>, title?: string): Promise<DictionaryStatus>;
}
export interface Scanner { start(): void; stop(): void }
export interface Recommended { name: string; description: string; homepage: string; downloadUrl: string; category: string }
export interface Runtime {
  Client: { new (): WebClient; apiVersion: number };
  createScanner(client: WebClient, node: HTMLElement, callbacks: {
    onResult(result: Result): void; onError(error: Error): void; includeSelector?: string
  }): Scanner;
  render(node: HTMLElement, result: Result, client: WebClient, lookup: (text: string) => void): () => void;
  presets: {
    DEFAULT_DICTIONARY: { name: string; version: string; fileName: string; bytes: number; notices: string };
    downloadDefaultDictionary(url: URL, options?: { signal?: AbortSignal; onProgress?: (bytes: number, total: number) => void }): Promise<Blob>;
    recommendedDictionaries(): Promise<Recommended[]>;
  };
  offlineReady: boolean;
}
