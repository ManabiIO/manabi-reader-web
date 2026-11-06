/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { DictionaryRuntime } from './dictionary-provider';

/** Admission checks the selected implementation; there is no fallback provider. */
export function validateDictionaryRuntime(value: unknown): asserts value is DictionaryRuntime {
  if (!value || typeof value !== 'object') throw new Error('Missing dictionary provider.');
  const runtime = value as Record<string, unknown>;
  for (const name of ['render', 'installDefault', 'recommendations'])
    if (typeof runtime[name] !== 'function')
      throw new Error(`Dictionary provider is missing ${name}.`);
  if (!runtime.client || typeof runtime.client !== 'object')
    throw new Error('Missing dictionary client.');
  const client = runtime.client as Record<string, unknown>;
  for (const name of [
    'status',
    'search',
    'importDictionary',
    'deleteDictionary',
    'setEnabled',
    'recordDefaultInstall',
    'close'
  ])
    if (typeof client[name] !== 'function')
      throw new Error(`Dictionary client is missing ${name}.`);
  if (runtime.attachChapter !== undefined && typeof runtime.attachChapter !== 'function')
    throw new Error('Invalid dictionary chapter interaction.');
}
