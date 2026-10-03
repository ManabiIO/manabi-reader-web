/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 *
 * Reader-owned adapter for the separately licensed GPL dictionary runtime.
 * Keep provider implementation source out of this repository; this file only
 * consumes the versioned public runtime surface.
 */

import { base } from '$app/paths';
import version from './version.json';
import type {
  DictionaryClient,
  DictionaryRuntime,
  RecommendedDictionary
} from '../../dictionary-provider';

export async function openManabitanDictionaryProvider(): Promise<DictionaryRuntime> {
  const root = `${base}/dictionary-runtime/${version.revision}/`;
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
    version.repository !== 'ManabiIO/manabitan' ||
    manifest.apiVersion !== 1 ||
    manifest.searchVersion !== 1 ||
    manifest.revision !== version.revision
  )
    throw new Error('This Reader release needs its matching dictionary runtime.');

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

  const providerClient = new module.ManabiTanWebClient();
  try {
    await providerClient.open();
  } catch (error) {
    await providerClient.close().catch(() => {});
    throw error;
  }

  const client: DictionaryClient = {
    status: (options) => providerClient.status(options),
    search: (query, full, options) => providerClient.search(query, full, options),
    importDictionary: (blob, options) => providerClient.importDictionary(blob, options),
    deleteDictionary: (title, options) => providerClient.deleteDictionary(title, options),
    setEnabled: (title, enabled) => providerClient.setEnabled(title, enabled),
    setDefault: (choice, title) => providerClient.setDefault(choice, title),
    close: () => providerClient.close()
  };

  return {
    client,
    render: (container, result, lookup) =>
      renderer.renderDictionaryResults(container, result, providerClient, lookup),
    installDefault: (options) =>
      presets.downloadDefaultDictionary(
        new URL(
          `${base}/dictionary-archives/${presets.DEFAULT_DICTIONARY.fileName}`,
          location.origin
        ),
        options
      ),
    recommendations: async ({ signal }) => {
      const response = await fetch(
        new URL(`${root}data/recommended-dictionaries.json`, location.origin),
        {
          credentials: 'omit',
          signal,
          cache: 'force-cache'
        }
      );
      if (!response.ok) throw new Error('Recommended dictionaries are unavailable.');

      const catalog: unknown = await response.json();
      if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog))
        throw new Error('Recommended dictionary catalog is invalid.');

      const japanese = (catalog as Record<string, unknown>).ja;
      if (!japanese || typeof japanese !== 'object' || Array.isArray(japanese))
        throw new Error('Japanese dictionary recommendations are unavailable.');

      const result: RecommendedDictionary[] = [];
      for (const category of ['terms', 'kanji', 'frequency'] as const) {
        const items = (japanese as Record<string, unknown>)[category];
        if (!Array.isArray(items)) continue;
        for (const item of items) {
          if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
          const record = item as Record<string, unknown>;
          if (
            typeof record.name !== 'string' ||
            typeof record.description !== 'string' ||
            typeof record.homepage !== 'string' ||
            typeof record.downloadUrl !== 'string'
          )
            continue;

          let homepage: URL, download: URL;
          try {
            homepage = new URL(record.homepage);
            download = new URL(record.downloadUrl);
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
            name: record.name.slice(0, 256),
            description: record.description.slice(0, 2000),
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
