/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useEffect } from 'react';
import { DialogTemplate } from '../ui/dialogs';
import { useStore } from '$runtime/use-store';
import { StorageDataType, StorageKey } from '$lib/data/storage/storage-types';
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
  const content = [
    [StorageDataType.DATA, 'Book data'],
    [StorageDataType.PROGRESS, 'Reading position'],
    [StorageDataType.STATISTICS, 'Statistics'],
    [StorageDataType.AUDIOBOOK, 'Audiobook'],
    [StorageDataType.SUBTITLE, 'Subtitles']
  ] as const;
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
        <div className="grid grid-cols-2 gap-3">
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
        <div className="grid grid-cols-2 gap-2">
          {content.map(([value, label]) => (
            <label key={value} className="flex min-h-11 items-center gap-3 rounded-xl px-2">
              <input
                type="checkbox"
                name={value}
                value={value}
                checked={selected.includes(value)}
                onChange={(event) =>
                  lastExportedTypes$.next(
                    event.currentTarget.checked
                      ? [...selected, value]
                      : selected.filter((type) => type !== value)
                  )
                }
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
    </DialogTemplate>
  );
}
