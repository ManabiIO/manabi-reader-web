/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { openDictionaryProvider } from './dictionary-provider-selection';
import type { DictionaryRuntime } from './dictionary-provider';

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

async function open(): Promise<DictionaryRuntime> {
  await retirement;
  return openDictionaryProvider();
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
