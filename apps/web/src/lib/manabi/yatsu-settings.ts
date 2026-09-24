/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { canonical, MigrationConflict } from './ttu-migration-format';
import { previewYatsuSettings } from './yatsu-settings-format';
import { exclusive, metadata, setMetadata } from './persistence';
import { captureImportPreferences, applyImportPreferences } from './preferences';
import { currentUser } from './client';

export async function importYatsuSettings(value: unknown, replace: boolean, signal?: AbortSignal) {
  const preview = previewYatsuSettings(value);
  return exclusive('yatsu-settings-import', async () => {
    signal?.throwIfAborted();
    const owner = currentUser()?.id ?? null;
    const receiptKey = `yatsu-settings-v1/${owner ?? 'local'}`;
    const previous = (await metadata<Record<string, string>>(receiptKey)) ?? {};
    const before = captureImportPreferences(Object.keys(preview.values));
    const updates: Record<string, unknown> = {};
    const next = { ...previous };
    for (const [key, incoming] of Object.entries(preview.values)) {
      const serialized = canonical(incoming);
      if (previous[key] === serialized) continue;
      if (
        previous[key] !== undefined &&
        canonical(before[key]) !== previous[key] &&
        canonical(before[key]) !== serialized &&
        !replace
      )
        throw new MigrationConflict(
          `The setting ${key} was changed in Manabi. Keep your current settings or explicitly use the imported version.`
        );
      if (canonical(before[key]) !== serialized) updates[key] = incoming;
      next[key] = serialized;
    }
    signal?.throwIfAborted();
    if ((currentUser()?.id ?? null) !== owner)
      throw new Error('The account changed. Retry the settings import.');
    try {
      await applyImportPreferences(updates);
      await setMetadata(receiptKey, next);
    } catch (error) {
      // Roll back settings changed by this attempt. Do not overwrite concurrent user edits.
      const now = captureImportPreferences(Object.keys(updates));
      await applyImportPreferences(
        Object.fromEntries(
          Object.keys(updates)
            .filter((key) => canonical(now[key]) === canonical(updates[key]))
            .map((key) => [key, before[key]])
        )
      );
      throw error;
    }
    return {
      status: Object.keys(updates).length ? ('imported' as const) : ('unchanged' as const),
      title: 'Yatsu Settings',
      records: Object.keys(updates).length,
      details: `${Object.keys(preview.values).length} supported preferences; ${preview.skipped.length} source-only or security-sensitive settings left unchanged.`,
      skippedSettings: preview.skipped
    };
  });
}
