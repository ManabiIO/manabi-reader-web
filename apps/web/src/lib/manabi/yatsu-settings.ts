/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import * as reader from '$lib/data/store';
import { parseYatsuSettings } from './yatsu-settings-format';
import { canonical, MigrationConflict } from './ttu-migration-format';
import { localProfileUser } from './client';
import { exclusive } from './persistence';
interface Subject {
  getValue(): unknown;
  next(value: unknown): void;
}
const key = 'manabi-yatsu-settings-receipt-v1';
/** Called only from the explicitly selected settings row. Source auth/auto-sync is never applied. */
export async function importYatsuSettings(value: unknown, replace = false, signal?: AbortSignal) {
  const parsed = parseYatsuSettings(value),
    owner = localProfileUser()?.id ?? null;
  return exclusive('yatsu-settings', async () => {
    signal?.throwIfAborted();
    const oldText = localStorage.getItem(key);
    const prior: Record<string, unknown> = oldText ? JSON.parse(oldText) : {};
    const subjects: Record<string, Subject> = {};
    const before: Record<string, unknown> = {},
      changes: Record<string, unknown> = {};
    for (const [name, incoming] of Object.entries(parsed.values)) {
      const subject = (reader as unknown as Record<string, Subject>)[`${name}$`];
      if (!subject || typeof subject.getValue !== 'function' || typeof subject.next !== 'function')
        throw new Error(`Unsupported destination preference ${name}.`);
      subjects[name] = subject;
      before[name] = subject.getValue();
      if (canonical(prior[name]) === canonical(incoming)) continue; // repeat never undoes later local edits
      if (
        Object.hasOwn(prior, name) &&
        canonical(before[name]) !== canonical(prior[name]) &&
        canonical(before[name]) !== canonical(incoming) &&
        !replace
      )
        throw new MigrationConflict(
          `The local ${name} preference changed after the last import. Review before replacing it.`
        );
      changes[name] = incoming;
    }
    signal?.throwIfAborted();
    if ((localProfileUser()?.id ?? null) !== owner)
      throw new Error('Account changed during settings import.');
    try {
      for (const [name, incoming] of Object.entries(changes)) subjects[name].next(incoming);
      localStorage.setItem(key, JSON.stringify({ ...prior, ...parsed.values }));
    } catch (error) {
      for (const [name, previous] of Object.entries(before)) subjects[name].next(previous);
      if (oldText === null) localStorage.removeItem(key);
      else localStorage.setItem(key, oldText);
      throw error;
    }
    return {
      status: Object.keys(changes).length ? ('imported' as const) : ('unchanged' as const),
      title: 'Safe reader settings',
      records: Object.keys(changes).length,
      warning: parsed.skipped.length
        ? `${parsed.skipped.length} unsupported or nonportable setting(s) were left in the original ZIP; no credentials or sync settings were applied.`
        : undefined
    };
  });
}
