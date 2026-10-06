/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 *
 * Reader-owned adapter for the separately licensed GPL dictionary runtime.
 * Keep provider implementation source out of this repository; this file only
 * consumes the versioned public runtime surface.
 */

import { assets as base } from '$app/paths';
import version from './version.json';
import type {
  DictionaryClient,
  DictionaryResult,
  DictionaryRuntime,
  DictionaryStatus,
  RecommendedDictionary
} from '../../dictionary-provider';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function relativeAsset(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.startsWith('/') ||
    value.includes('\\') ||
    value.includes('?') ||
    value.includes('#') ||
    value.split('/').includes('..')
  )
    throw new Error('The dictionary runtime manifest contains an invalid asset path.');
  return value;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error('The dictionary returned invalid metadata.');
  return value;
}

function normalizeStatus(value: unknown): DictionaryStatus {
  if (!record(value) || !Array.isArray(value.dictionaries) || !record(value.preferences))
    throw new Error('The dictionary returned invalid status.');

  const disabled = value.preferences.disabled;
  if (!Array.isArray(disabled) || disabled.some((title) => typeof title !== 'string'))
    throw new Error('The dictionary returned invalid preferences.');

  return {
    dictionaries: value.dictionaries.map((item) => {
      if (!record(item) || typeof item.title !== 'string' || !item.title)
        throw new Error('The dictionary returned invalid installed-dictionary metadata.');
      return {
        title: item.title,
        revision: optionalString(item.revision),
        author: optionalString(item.author),
        description: optionalString(item.description)
      };
    }),
    preferences: { disabled: [...new Set(disabled)] }
  };
}

function normalizeSearch(value: unknown): DictionaryResult {
  if (
    !record(value) ||
    value.version !== 1 ||
    typeof value.query !== 'string' ||
    typeof value.matchedQuery !== 'string' ||
    typeof value.prefix !== 'boolean' ||
    !Number.isSafeInteger(value.dictionaryCount) ||
    Number(value.dictionaryCount) < 0 ||
    !record(value.preview) ||
    !Array.isArray(value.preview.items) ||
    typeof value.preview.hasMore !== 'boolean'
  )
    throw new Error('The dictionary returned an invalid search response.');

  const items = value.preview.items.map((item) => {
    if (
      !record(item) ||
      typeof item.id !== 'string' ||
      typeof item.term !== 'string' ||
      typeof item.reading !== 'string' ||
      !Array.isArray(item.senses)
    )
      throw new Error('The dictionary returned an invalid preview item.');

    return {
      id: item.id,
      term: item.term,
      reading: item.reading,
      senses: item.senses.map((sense) => {
        if (
          !record(sense) ||
          typeof sense.source !== 'string' ||
          typeof sense.text !== 'string' ||
          !Array.isArray(sense.tags) ||
          sense.tags.some((tag) => typeof tag !== 'string')
        )
          throw new Error('The dictionary returned an invalid preview sense.');
        return {
          source: sense.source,
          text: sense.text,
          tags: [...sense.tags] as string[]
        };
      })
    };
  });

  const result: DictionaryResult = {
    contractVersion: 1,
    query: value.query,
    matchedQuery: value.matchedQuery,
    prefix: value.prefix,
    dictionaryCount: Number(value.dictionaryCount),
    preview: { items, hasMore: value.preview.hasMore }
  };
  if (value.lookup !== undefined) {
    if (!record(value.lookup)) throw new Error('The dictionary returned an invalid full result.');
    result.lookup = value.lookup;
  }
  return result;
}

function normalizeImport(value: unknown) {
  if (
    !record(value) ||
    !record(value.summary) ||
    typeof value.summary.title !== 'string' ||
    !value.summary.title ||
    !Array.isArray(value.warnings) ||
    value.warnings.some((warning) => typeof warning !== 'string') ||
    typeof value.cancelledAfterCommit !== 'boolean'
  )
    throw new Error('The dictionary returned an invalid import result.');

  return {
    summary: { title: value.summary.title },
    warnings: [...value.warnings] as string[],
    cancelledAfterCommit: value.cancelledAfterCommit
  };
}

export async function openManabitanDictionaryProvider(): Promise<DictionaryRuntime> {
  const root = new URL(`${base}/manabitan/${version.revision}/`, location.href).href;
  const response = await fetch(`${root}manifest.json`, {
    credentials: 'omit',
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok)
    throw new Error(
      'The built-in dictionary assets are unavailable. Retry after reloading this Reader release.'
    );

  const manifest: unknown = await response.json();
  if (
    !record(manifest) ||
    version.repository !== 'ManabiIO/manabitan' ||
    manifest.apiVersion !== 1 ||
    manifest.searchVersion !== 1 ||
    manifest.revision !== version.revision ||
    !record(manifest.defaultDictionary) ||
    typeof manifest.defaultDictionary.fileName !== 'string' ||
    !/^[a-zA-Z0-9._-]+\.zip$/.test(manifest.defaultDictionary.fileName)
  )
    throw new Error('This Reader release needs its matching dictionary runtime.');

  const clientAsset = relativeAsset(manifest.client);
  const rendererAsset = relativeAsset(manifest.renderer);
  const presetsAsset = relativeAsset(manifest.presets);
  const styleAsset = relativeAsset(manifest.style);

  const [module, renderer, presets] = await Promise.all([
    import(/* @metro-ignore */ `${root}${clientAsset}`),
    import(/* @metro-ignore */ `${root}${rendererAsset}`),
    import(/* @metro-ignore */ `${root}${presetsAsset}`)
  ]);
  if (
    typeof module.ManabiTanWebClient !== 'function' ||
    typeof renderer.renderDictionaryResults !== 'function' ||
    typeof presets.downloadDefaultDictionary !== 'function'
  )
    throw new Error('The dictionary runtime does not expose the required adapter surface.');

  if (!document.querySelector('link[data-manabi-dictionary-style]')) {
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = `${root}${styleAsset}`;
    style.dataset.manabiDictionaryStyle = 'true';
    document.head.append(style);
  }

  const providerClient = new module.ManabiTanWebClient();
  try {
    normalizeStatus(await providerClient.open());
  } catch (error) {
    await providerClient.close().catch(() => {});
    throw error;
  }

  const client: DictionaryClient = {
    status: async (options) => normalizeStatus(await providerClient.status(options)),
    search: async (query, full, options) =>
      normalizeSearch(await providerClient.search(query, full, options)),
    importDictionary: async (blob, options) =>
      normalizeImport(await providerClient.importDictionary(blob, options)),
    deleteDictionary: async (title, options) =>
      normalizeStatus(await providerClient.deleteDictionary(title, options)),
    setEnabled: async (title, enabled) =>
      normalizeStatus(await providerClient.setEnabled(title, enabled)),
    recordDefaultInstall: async (title) =>
      normalizeStatus(await providerClient.setDefault('installed', title)),
    close: () => providerClient.close()
  };

  return {
    client,
    render: (container, result, lookup) =>
      renderer.renderDictionaryResults(container, result, providerClient, lookup),
    installDefault: (options) =>
      presets.downloadDefaultDictionary(
        new URL(
          `${base}/dictionary-archives/${manifest.defaultDictionary.fileName}`,
          location.href
        ),
        options
      ),
    recommendations: async ({ signal }) => {
      const response = await fetch(
        new URL(`${root}data/recommended-dictionaries.json`, location.href),
        {
          credentials: 'omit',
          signal,
          cache: 'force-cache'
        }
      );
      if (!response.ok) throw new Error('Recommended dictionaries are unavailable.');

      const catalog: unknown = await response.json();
      if (!record(catalog) || !record(catalog.ja))
        throw new Error('Japanese dictionary recommendations are unavailable.');

      const result: RecommendedDictionary[] = [];
      for (const category of ['terms', 'kanji', 'frequency'] as const) {
        const items = catalog.ja[category];
        if (!Array.isArray(items)) continue;
        for (const item of items) {
          if (
            !record(item) ||
            typeof item.name !== 'string' ||
            typeof item.description !== 'string' ||
            typeof item.homepage !== 'string' ||
            typeof item.downloadUrl !== 'string'
          )
            continue;

          let homepage: URL, download: URL;
          try {
            homepage = new URL(item.homepage);
            download = new URL(item.downloadUrl);
          } catch {
            continue;
          }
          if (
            homepage.protocol !== 'https:' ||
            download.protocol !== 'https:' ||
            homepage.username ||
            homepage.password ||
            download.username ||
            download.password
          )
            continue;

          result.push({
            name: item.name.slice(0, 256),
            description: item.description.slice(0, 2000),
            category,
            homepage: homepage.href,
            downloadUrl: download.href
          });
        }
      }
      return result;
    }
  };
}
