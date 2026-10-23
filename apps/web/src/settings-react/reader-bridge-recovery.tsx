/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import React from 'react';
import { Button } from './primitives';
import type { readDriveReaderRecovery } from '$lib/manabi/reader-bridge-recovery';
type Rows = Awaited<ReturnType<typeof readDriveReaderRecovery>>;

export function ReaderBridgeRecovery({ owner }: { owner: string }) {
  const [rows, setRows] = React.useState<Rows>([]);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState('');
  const lifetime = React.useRef(new AbortController());
  const pending = React.useRef(false);
  const downloadUrls = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());
  React.useEffect(() => {
    const operation = new AbortController();
    lifetime.current = operation;
    let unsubscribe = () => {};
    void (async () => {
      const api = await import('$lib/manabi/reader-bridge-recovery');
      if (operation.signal.aborted) return;
      let sequence = 0;
      const refresh = () => {
        const current = ++sequence;
        void api
          .readDriveReaderRecovery(owner, operation.signal)
          .then((value) => {
            if (!operation.signal.aborted && current === sequence) setRows(value);
          })
          .catch(() => {
            if (!operation.signal.aborted)
              setNotice('Sync recovery could not be read. Try opening this page again.');
          });
      };
      api.readerBridgeRecoveryChanges.addEventListener('change', refresh);
      unsubscribe = () => api.readerBridgeRecoveryChanges.removeEventListener('change', refresh);
      refresh();
    })();
    return () => {
      operation.abort();
      unsubscribe();
      for (const [url, timer] of downloadUrls.current) {
        clearTimeout(timer);
        URL.revokeObjectURL(url);
      }
      downloadUrls.current.clear();
    };
  }, [owner]);
  const run = async (
    work: (
      api: typeof import('$lib/manabi/reader-bridge-recovery'),
      signal: AbortSignal
    ) => Promise<string>
  ) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setNotice('');
    const signal = lifetime.current.signal;
    try {
      const api = await import('$lib/manabi/reader-bridge-recovery');
      signal.throwIfAborted();
      const result = await work(api, signal);
      if (!signal.aborted) setNotice(result);
    } catch {
      if (!signal.aborted)
        setNotice(
          'Sync recovery could not be updated. Existing reading data and recovery records were kept.'
        );
    } finally {
      pending.current = false;
      if (!signal.aborted) setBusy(false);
    }
  };
  const save = () =>
    run(async (api, signal) => {
      const json = await api.exportDriveReaderRecovery(owner, signal);
      signal.throwIfAborted();
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'manabi-reader-sync-recovery.json';
      anchor.click();
      downloadUrls.current.set(
        url,
        setTimeout(() => {
          URL.revokeObjectURL(url);
          downloadUrls.current.delete(url);
        }, 60000)
      );
      return 'Recovery download started. Keep the file with your book backups; it contains reading history and no sign-in credentials.';
    });
  const load = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    void run(async (api, signal) => {
      if (file.size > 64 * 1024 * 1024) throw new Error('Recovery file too large.');
      const json = await file.text();
      signal.throwIfAborted();
      const count = await api.restoreDriveReaderRecovery(owner, json, signal);
      return `${count} recovery ${count === 1 ? 'record' : 'records'} added for inspection. Reading data and active connections were not changed.`;
    });
  };
  const active = rows.filter((row) => !['abandoned', 'superseded'].includes(row.phase));
  return (
    <section aria-label="Reader sync recovery" aria-busy={busy}>
      <details>
        <summary>Reader sync recovery{rows.length ? ` (${rows.length})` : ''}</summary>
        <p>
          Keep a copy of saved sync decisions and previous reading values. Restoring this file adds
          inactive evidence for review; it does not change your reading data or reconnect Google
          Drive.
        </p>
        <Button variant="outline" disabled={busy || !rows.length} onClick={() => void save()}>
          Download sync recovery
        </Button>
        <label>
          Restore sync recovery
          <input type="file" accept=".json,application/json" disabled={busy} onChange={load} />
        </label>
        {active.map((row) => (
          <article className="library" key={row.id}>
            <strong>{row.title}</strong>
            <p>
              {row.phase === 'accepted'
                ? 'Saved reading change'
                : row.phase === 'restored'
                  ? 'Recovered evidence · inactive'
                  : row.phase === 'uncertain'
                    ? 'Outcome needs inspection'
                    : 'Unfinished sync decision'}
            </p>
            {['prepared', 'review', 'paused'].includes(row.phase) ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async (api, signal) => {
                    await api.abandonDriveReaderDraft(owner, row.id, row.revision, signal);
                    return 'The unfinished decision was set aside, with its evidence kept. Refresh the Drive preview to review the current copies.';
                  })
                }
              >
                Keep current reading data and review again
              </Button>
            ) : null}
          </article>
        ))}
      </details>
      <div role="status" aria-live="polite">
        {notice ? <p>{notice}</p> : null}
      </div>
    </section>
  );
}
