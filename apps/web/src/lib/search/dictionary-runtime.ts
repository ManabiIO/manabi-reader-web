/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { base } from '$app/paths';
import version from './manabitan-version.json';
export interface DictionaryPreview {
  id: string;
  term: string;
  reading: string;
  senses: { source: string; text: string; tags: string[] }[];
}
export interface DictionaryResult {
  version: 1;
  query: string;
  matchedQuery: string;
  /** True when the pinned runtime produced prefix-derived results. */
  prefix: boolean;
  dictionaryCount: number;
  preview: { items: DictionaryPreview[]; hasMore: boolean };
  lookup?: { dictionaryEntries: unknown[] };
}
export interface DictionaryStatus {
  dictionaries: {
    title: string;
    revision?: string;
    author?: string;
    description?: string;
  }[];
  preferences: { disabled: string[] };
}
interface Client {
  open(): Promise<DictionaryStatus>;
  status(options?: { signal?: AbortSignal }): Promise<DictionaryStatus>;
  search(query: string, full: boolean, options: { signal: AbortSignal }): Promise<DictionaryResult>;
  importDictionary(
    blob: Blob,
    options: { signal: AbortSignal; onProgress: (value: unknown) => void }
  ): Promise<{ summary: { title: string }; warnings: string[]; cancelledAfterCommit: boolean }>;
  deleteDictionary(
    title: string,
    options?: { signal?: AbortSignal }
  ): Promise<DictionaryStatus>;
  setEnabled(title: string, enabled: boolean): Promise<DictionaryStatus>;
  setDefault(choice: string, title?: string): Promise<DictionaryStatus>;
  close(): Promise<void>;
}
export interface DictionaryRuntime {
  client: Client;
  render: (
    container: HTMLElement,
    result: NonNullable<DictionaryResult['lookup']>,
    client: Client,
    lookup: (query: string) => void
  ) => () => void;
  installDefault: (options: {
    signal: AbortSignal;
    onProgress: (loaded: number, total: number) => void;
  }) => Promise<Blob>;
}
let active: Promise<DictionaryRuntime> | undefined;
let retirement = Promise.resolve();
let leases = 0;
async function open(): Promise<DictionaryRuntime> {
  await retirement;
  const root = `${base}/manabitan/${version.revision}/`;
  const response = await fetch(`${root}manifest.json`, {
    credentials: 'omit',
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok)
    throw new Error(
      'The built-in dictionary assets are unavailable. Retry after reloading this Reader release.'
    );
  const manifest = await response.json();
  if (
    manifest.apiVersion !== 1 ||
    manifest.searchVersion !== 1 ||
    manifest.revision !== version.revision
  )
    throw new Error('This Reader release needs its matching Manabitan search runtime.');
  // Module paths are pinned by Reader, never supplied by a dictionary or URL query.
  const [module, renderer, presets] = await Promise.all([
    import(/* @vite-ignore */ `${root}web/client.js`),
    import(/* @vite-ignore */ `${root}web/render.js`),
    import(/* @vite-ignore */ `${root}web/presets.js`)
  ]);
  if (!document.querySelector('link[data-manabi-dictionary-style]')) {
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = `${root}css/structured-content.css`;
    style.dataset.manabiDictionaryStyle = 'true';
    document.head.append(style);
  }
  const client: Client = new module.ManabiTanWebClient();
  try {
    await client.open();
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  }
  return {
    client,
    render: renderer.renderDictionaryResults,
    installDefault: (options) =>
      presets.downloadDefaultDictionary(
        new URL(
          `${base}/dictionary-archives/${presets.DEFAULT_DICTIONARY.fileName}`,
          location.origin
        ),
        options
      )
  };
}
/** One local-storage owner per tab; retiring owners finish before a new one opens. */
export function dictionaryLease() {
  leases++;
  let released = false;
  return {
    get() {
      if (released) return Promise.reject(new Error('Dictionary search is closed.'));
      if (!active) {
        const pending = open();
        active = pending;
        void pending.catch(() => {
          if (active === pending) active = undefined;
        });
      }
      return active;
    },
    release() {
      if (released) return;
      released = true;
      if (--leases !== 0) return;
      const previous = active;
      active = undefined;
      retirement = retirement
        .then(async () => {
          const runtime = await previous;
          await runtime?.client.close();
        })
        .catch(() => {});
    }
  };
}
