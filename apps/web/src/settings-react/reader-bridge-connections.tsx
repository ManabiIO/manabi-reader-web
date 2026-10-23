/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import React from 'react';
import { Button } from './primitives';
import { ReaderBridgeChanges } from './reader-bridge-changes';
import type { ReaderBridgeConnectionRecord } from '$lib/manabi/reader-bridge-connection-model';

type Checked = Awaited<
  ReturnType<typeof import('$lib/manabi/reader-bridge-saved').checkSavedDriveReaderConnection>
>;

function SavedConnection({
  owner,
  record
}: {
  owner: string;
  record: ReaderBridgeConnectionRecord;
}) {
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState('');
  const [checked, setChecked] = React.useState<Checked | null>(null);
  const pending = React.useRef<AbortController | null>(null);
  const heading = React.useId();
  React.useLayoutEffect(() => () => pending.current?.abort(), []);
  const run = async (remove: boolean) => {
    if (pending.current) return;
    const operation = new AbortController();
    pending.current = operation;
    setBusy(true);
    setNotice('');
    setChecked(null);
    try {
      if (remove) {
        const api = await import('$lib/manabi/reader-bridge-local');
        operation.signal.throwIfAborted();
        await api.removeDriveReaderConnection(owner, record.id, record.revision, operation.signal);
      } else {
        const api = await import('$lib/manabi/reader-bridge-saved');
        operation.signal.throwIfAborted();
        const result = await api.checkSavedDriveReaderConnection(
          owner,
          record.id,
          record.revision,
          operation.signal
        );
        if (!operation.signal.aborted) setChecked(result);
      }
    } catch (error) {
      if (operation.signal.aborted) return;
      const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
      setNotice(
        remove
          ? 'The removal could not be confirmed. Refresh saved connections to check. Your book and reading data are kept.'
          : ['changed', 'conflict', 'exists'].includes(String(code))
            ? 'This saved pair changed. Preview the current Drive copy and compare it again before replacing the connection.'
            : 'Could not check Google Drive. Your book and reading data are saved on this device. Try again when connected.'
      );
    } finally {
      if (!operation.signal.aborted) setBusy(false);
      if (pending.current === operation) pending.current = null;
    }
  };
  return (
    <article className="reader-bridge-saved-book" aria-labelledby={heading} aria-busy={busy}>
      <h3 id={heading}>{record.descriptor.title}</h3>
      <p className="hint">
        {record.descriptor.source.profile.startsWith('yatsu-') ? 'Yatsu' : 'Ttsu'} · Google Drive ·{' '}
        {record.state === 'restored' ? 'Recovered connection · inactive' : 'Saved on this device'}
      </p>
      {record.state === 'restored' ? (
        <p>
          Choose this book in your Drive library and compare a local copy to connect it again.
          Recovery never reconnects a book automatically.
        </p>
      ) : (
        <Button variant="outline" disabled={busy} onClick={() => void run(false)}>
          {busy ? 'Checking…' : checked ? 'Check current copies again' : 'Check current copies'}
        </Button>
      )}
      <Button variant="outline" disabled={busy} onClick={() => void run(true)}>
        {record.state === 'restored'
          ? 'Forget recovered connection'
          : 'Forget this reader connection'}
      </Button>
      <div role="status" aria-live="polite">
        {notice ? <p>{notice}</p> : null}
      </div>
      {checked ? (
        <ReaderBridgeChanges
          preview={checked.preview}
          comparison={checked.comparison}
          onSaved={() => {
            setChecked(null);
            setNotice(
              'Reading changes saved on this device. Previous values are available in Reader sync recovery.'
            );
          }}
        />
      ) : null}
    </article>
  );
}

function ConnectionsForOwner({ owner }: { owner: string }) {
  const [records, setRecords] = React.useState<ReaderBridgeConnectionRecord[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [failed, setFailed] = React.useState(false);
  const [refresh, setRefresh] = React.useState(0);
  const heading = React.useId();
  React.useEffect(() => {
    let current = true;
    let serial = 0;
    let stop = () => {};
    const lifetime = new AbortController();
    const read = async () => {
      const generation = ++serial;
      setLoading(true);
      setFailed(false);
      try {
        const api = await import('$lib/manabi/reader-bridge-local');
        lifetime.signal.throwIfAborted();
        const result = await api.listDriveReaderConnections(owner, lifetime.signal);
        if (current && generation === serial) setRecords(result);
      } catch {
        if (current && generation === serial) {
          setRecords([]);
          setFailed(true);
        }
      } finally {
        if (current && generation === serial) setLoading(false);
      }
    };
    void (async () => {
      try {
        const { readerBridgeRecoveryChanges } = await import('$lib/manabi/reader-bridge-recovery');
        if (!current) return;
        const listener = () => void read();
        readerBridgeRecoveryChanges.addEventListener('change', listener);
        stop = () => readerBridgeRecoveryChanges.removeEventListener('change', listener);
        await read();
      } catch {
        if (current) {
          setFailed(true);
          setLoading(false);
        }
      }
    })();
    return () => {
      current = false;
      lifetime.abort();
      stop();
    };
  }, [owner, refresh]);
  return (
    <section aria-labelledby={heading}>
      <h2 id={heading}>Saved reader connections</h2>
      <p>
        Keep a verified pairing with a Ttsu or Yatsu book in Google Drive. Checks and reading
        changes are manual for now.
      </p>
      {loading ? <p role="status">Reading saved connections on this device…</p> : null}
      {failed ? (
        <p role="status">
          Saved connections could not be read. Your local books are still available.
        </p>
      ) : null}
      <Button variant="outline" disabled={loading} onClick={() => setRefresh((value) => value + 1)}>
        Refresh saved connections
      </Button>
      {!loading && !failed && !records.length ? (
        <p>
          No saved reader connections yet. Open a book folder in your Google Drive library, then
          preview and compare its local copy.
        </p>
      ) : null}
      {records.map((record) => (
        <SavedConnection
          key={JSON.stringify([record.id, record.revision])}
          owner={owner}
          record={record}
        />
      ))}
      {records.length ? (
        <p className="hint">
          Forgetting a connection keeps your book, reading data and sync recovery. It does not
          revoke Google access.
        </p>
      ) : null}
    </section>
  );
}

export function ReaderBridgeConnections({ owner }: { owner: string }) {
  return <ConnectionsForOwner key={owner} owner={owner} />;
}
