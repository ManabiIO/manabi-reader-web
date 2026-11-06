/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { openDictionaryProvider } from './dictionary-provider-selection';
import type { DictionaryRuntime } from './dictionary-provider';
import { validateDictionaryRuntime } from './validate-dictionary-provider';

export type {
  DictionaryPreview,
  DictionaryResult,
  DictionaryRuntime,
  DictionaryStatus,
  RecommendedDictionary
} from './dictionary-provider';

let active: Promise<DictionaryRuntime> | undefined;
let retirement = Promise.resolve();
let leases = 0;

async function closeRuntime(runtime: DictionaryRuntime | undefined) {
  try {
    await runtime?.preprocessor?.dispose();
  } finally {
    await runtime?.client?.close?.();
  }
}

async function open(isCurrent: () => boolean): Promise<DictionaryRuntime> {
  await retirement;
  // A consumer can time out while waiting for the previous owner's disposal.
  // Do not start a new storage owner after every lease for this attempt left.
  if (!isCurrent()) throw new DOMException('Dictionary search is closed.', 'AbortError');
  const runtime = await openDictionaryProvider();
  try {
    validateDictionaryRuntime(runtime);
    return runtime;
  } catch (error) {
    try {
      await closeRuntime(runtime);
    } catch {
      /* Preserve admission failure. */
    }
    throw error;
  }
}

/** One local-storage owner per tab; retiring owners finish before a new one opens. */
export function dictionaryLease() {
  leases++;
  let released = false;
  return {
    get() {
      if (released) return Promise.reject(new Error('Dictionary search is closed.'));
      if (!active) {
        const pending = open(() => active === pending && leases > 0);
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
          await closeRuntime(runtime);
        })
        .catch(() => {});
    }
  };
}
