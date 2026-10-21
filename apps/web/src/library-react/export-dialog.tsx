/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useEffect } from 'react';
import { DialogTemplate } from '../ui/dialogs';
import { useStore } from '$runtime/use-store';
import { StorageKey } from '$lib/data/storage/storage-types';
import { isStorageSourceAvailable, storageSource$ } from '$lib/data/storage/storage-view';
import {
  fsStorageSource$,
  gDriveStorageSource$,
  oneDriveStorageSource$,
  isOnline$,
  lastExportedTarget$,
  lastExportedTypes$
} from '$lib/data/store';
import { isOnlineSourceAvailable } from '$lib/functions/utils';
import { executeReplicate$ } from '$lib/functions/replication/replication-progress';
import { Button } from './primitives';
import {
  BookExportContent,
  type BookExportContentLayout
} from '../features/library/BookExportContent';
const contentLayout: BookExportContentLayout = {
  Group: ({ children }) => (
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 12rem), 1fr))' }}
    >
      {children}
    </div>
  ),
  Choice: ({ value, label, checked, disabled, onChange }) => (
    <label className="flex min-h-11 min-w-0 items-center gap-3 rounded-xl px-2">
      <input
        className="shrink-0"
        type="checkbox"
        name={value}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span className="min-w-0 break-words">{label}</span>
    </label>
  )
};
export function BookExportDialog({ onClose }: { onClose?: () => void }) {
  const active = useStore(storageSource$),
    target = useStore(lastExportedTarget$),
    selected = useStore(lastExportedTypes$),
    online = useStore(isOnline$);
  const google = useStore(gDriveStorageSource$),
    onedrive = useStore(oneDriveStorageSource$),
    filesystem = useStore(fsStorageSource$);
  const targets = [
    { source: StorageKey.BACKUP, label: 'Zip File' },
    { source: StorageKey.BROWSER, label: 'Browser DB' },
    ...(
      [
        [StorageKey.GDRIVE, google, 'Google Drive'],
        [StorageKey.ONEDRIVE, onedrive, 'OneDrive'],
        [StorageKey.FS, filesystem, 'Filesystem']
      ] as const
    )
      .filter(([source, config]) => isStorageSourceAvailable(source, config, window))
      .map(([source, , label]) => ({ source, label }))
  ].filter((item) => item.source !== active);
  useEffect(() => {
    if (
      !targets.some((item) => item.source === target) ||
      !isOnlineSourceAvailable(online, target)
    ) {
      const next =
        targets.find((item) => item.source === StorageKey.BACKUP) ??
        targets.find((item) => item.source === StorageKey.BROWSER) ??
        targets[0];
      if (next) lastExportedTarget$.next(next.source);
    }
  }, [active, target, online, google, onedrive, filesystem]);
  return (
    <DialogTemplate
      title="Export books and reading data"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!selected.length}
            onClick={() => {
              executeReplicate$.next();
              onClose?.();
            }}
          >
            Start export
          </Button>
        </>
      }
    >
      <fieldset>
        <legend className="mb-3 text-lg font-semibold">Export target</legend>
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 12rem), 1fr))' }}
        >
          {targets.map((item) => (
            <Button
              variant="outline"
              key={item.source}
              aria-pressed={target === item.source}
              disabled={!isOnlineSourceAvailable(online, item.source)}
              onClick={() => lastExportedTarget$.next(item.source)}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </fieldset>
      <fieldset className="mt-6">
        <legend className="mb-3 text-lg font-semibold">Export content</legend>
        <BookExportContent
          layout={contentLayout}
          selected={selected}
          onChange={(parts) => lastExportedTypes$.next(parts)}
        />
      </fieldset>
    </DialogTemplate>
  );
}
