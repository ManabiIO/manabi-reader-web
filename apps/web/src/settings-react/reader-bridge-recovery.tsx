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
  // Account changes start a new lifetime, including pending reads and downloads.
  return <AccountReaderBridgeRecovery key={owner} owner={owner} />;
}

function AccountReaderBridgeRecovery({ owner }: { owner: string }) {
  const [rows, setRows] = React.useState<Rows>([]);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState('');
  const [readError, setReadError] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [refreshAttempt, setRefreshAttempt] = React.useState(0);
  const [visible, setVisible] = React.useState(10);
  const fileId = React.useId();
  const explanation = React.useId();
  const lifetime = React.useRef(new AbortController());
  const pending = React.useRef(false);
  const downloadUrls = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());
  React.useEffect(() => {
    const operation = new AbortController();
    lifetime.current = operation;
    let unsubscribe = () => {};
    setLoading(true);
    setReadError('');
    void (async () => {
      try {
        const api = await import('$lib/manabi/reader-bridge-recovery');
        if (operation.signal.aborted) return;
        let sequence = 0;
        const refresh = () => {
          const current = ++sequence;
          setLoading(true);
          void api
            .readDriveReaderRecovery(owner, operation.signal)
            .then((value) => {
              if (!operation.signal.aborted && current === sequence) {
                setRows(value);
                setReadError('');
              }
            })
            .catch(() => {
              if (!operation.signal.aborted && current === sequence)
                setReadError('Sync recovery could not be read. Try again.');
            })
            .finally(() => {
              if (!operation.signal.aborted && current === sequence) setLoading(false);
            });
        };
        api.readerBridgeRecoveryChanges.addEventListener('change', refresh);
        unsubscribe = () => api.readerBridgeRecoveryChanges.removeEventListener('change', refresh);
        refresh();
      } catch {
        if (!operation.signal.aborted) {
          setReadError('Sync recovery could not be opened. Try again.');
          setLoading(false);
        }
      }
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
  }, [owner, refreshAttempt]);
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
    if (!file || pending.current) return;
    if (file.size > 64 * 1024 * 1024) {
      setNotice('This file is too large. Choose a sync recovery JSON file smaller than 64 MB.');
      return;
    }
    void run(async (api, signal) => {
      const json = await file.text();
      signal.throwIfAborted();
      const count = await api.restoreDriveReaderRecovery(owner, json, signal);
      return `${count} recovery ${count === 1 ? 'record' : 'records'} added for inspection. Reading data and active connections were not changed.`;
    });
  };
  const active = rows.filter((row) => !['abandoned', 'superseded'].includes(row.phase));
  const older = rows.length - active.length;
  return (
    <section
      aria-label="Reader sync recovery"
      aria-busy={busy || loading}
      className="reader-bridge-recovery"
    >
      <details>
        <summary>Reader sync recovery{rows.length ? ` (${rows.length})` : ''}</summary>
        <p id={explanation} className="reader-bridge-explanation">
          Keep a copy of saved reader connections, sync decisions and previous reading values.
          Restoring this file adds inactive evidence for review; it does not change your reading
          data or reconnect Google Drive.
        </p>
        <div className="reader-bridge-recovery-actions">
          <Button
            variant="outline"
            disabled={busy || loading || !rows.length}
            onClick={() => void save()}
          >
            Download sync recovery
          </Button>
          <div className="reader-bridge-recovery-file">
            <label htmlFor={fileId}>Restore sync recovery</label>
            <input
              id={fileId}
              type="file"
              accept=".json,application/json"
              disabled={busy}
              aria-describedby={explanation}
              onChange={load}
            />
          </div>
        </div>
        {loading && !rows.length ? <p className="hint">Checking saved decisions…</p> : null}
        {!loading && !readError && !rows.length ? (
          <p className="hint">No saved sync decisions on this device yet.</p>
        ) : null}
        {active.slice(0, visible).map((row) => (
          <article className="reader-bridge-recovery-record" key={row.id}>
            <h4>{row.title}</h4>
            <p className="hint">
              {row.phase === 'accepted'
                ? 'Saved reading change'
                : row.phase === 'connection'
                  ? 'Saved reader connection'
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
        {visible < active.length ? (
          <Button variant="outline" onClick={() => setVisible((count) => count + 10)}>
            Show more saved decisions ({active.length - visible} remaining)
          </Button>
        ) : null}
        {older ? (
          <p className="hint">
            {older} older {older === 1 ? 'decision is' : 'decisions are'} also kept in the recovery
            download.
          </p>
        ) : null}
      </details>
      <div role="status" aria-live="polite" aria-atomic="true" className="reader-bridge-status">
        {readError ? <p>{readError}</p> : null}
        {notice ? <p>{notice}</p> : null}
      </div>
      {readError ? (
        <Button
          variant="outline"
          disabled={busy || loading}
          onClick={() => setRefreshAttempt((attempt) => attempt + 1)}
        >
          Try reading sync recovery again
        </Button>
      ) : null}
    </section>
  );
}
