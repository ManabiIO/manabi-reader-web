/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import React from 'react';
import { Button } from './primitives';
import { CheckboxField } from '../shared-ui/Fields';
import { ReaderBridgeChanges } from './reader-bridge-changes';
import { useStore } from '../runtime/use-store';
import { readerBridgeAutomaticStatus } from '$lib/manabi/reader-bridge-automatic';
import type { ReaderBridgeConnectionRecord } from '$lib/manabi/reader-bridge-connection-model';

type Checked = Awaited<
  ReturnType<typeof import('$lib/manabi/reader-bridge-saved').checkSavedDriveReaderConnection>
>;
type ConnectionAction =
  | { kind: 'check' | 'remove' }
  | { kind: 'automatic' | 'receive'; enabled: boolean };
const automaticMessages = {
  checking: 'Checking Google Drive…',
  unchanged: 'No new reading changes found.',
  changed: 'New reading changes are available to review.',
  received: 'Reading changes saved on this device. Google Drive was not changed.',
  review: 'Some reading changes need your review. Your local changes have been kept.',
  retry: 'Google Drive could not be checked just now. We’ll try again while the app is open.',
  paused: 'Automatic updates are paused. Check the current copies when you’re ready.'
};

function SavedConnection({
  owner,
  record,
  onChanged
}: {
  owner: string;
  record: ReaderBridgeConnectionRecord;
  onChanged(record: ReaderBridgeConnectionRecord): void;
}) {
  const [action, setAction] = React.useState<ConnectionAction['kind'] | null>(null);
  const busy = action !== null;
  const [automatic, setAutomatic] = React.useState(record.automaticChecks === true);
  const [receive, setReceive] = React.useState(record.automaticReceive === true);
  const [notice, setNotice] = React.useState('');
  const [checked, setChecked] = React.useState<Checked | null>(null);
  const pending = React.useRef<AbortController | null>(null);
  const heading = React.useId();
  const automaticHint = React.useId();
  const receiveHint = React.useId();
  const runtime = useStore(readerBridgeAutomaticStatus);
  const observed = runtime.owner === owner ? runtime.records[record.id] : undefined;
  const status =
    record.state === 'linked' &&
    record.automaticChecks === true &&
    observed?.revision === record.revision
      ? observed
      : undefined;
  React.useEffect(() => {
    // A newer background result supersedes an old completed action message.
    // Keep the message for a preference or manual check that is still saving.
    if (status && !pending.current) setNotice('');
    if (status?.state === 'received') setChecked(null);
  }, [status?.state, status?.observedAt]);
  React.useLayoutEffect(() => {
    setAction(null);
    setAutomatic(record.automaticChecks === true);
    setReceive(record.automaticReceive === true);
    setNotice('');
    setChecked(null);
    return () => {
      pending.current?.abort();
      pending.current = null;
    };
  }, [record.revision]);
  const run = async (request: ConnectionAction) => {
    if (pending.current || (request.kind !== 'remove' && record.state !== 'linked')) return;
    const operation = new AbortController();
    pending.current = operation;
    setAction(request.kind);
    if (request.kind === 'automatic') {
      setAutomatic(request.enabled);
      if (!request.enabled) setReceive(false);
    } else if (request.kind === 'receive') {
      setReceive(request.enabled);
      if (request.enabled) setAutomatic(true);
    }
    setNotice(
      request.kind === 'automatic'
        ? 'Saving automatic check preference…'
        : request.kind === 'receive'
          ? 'Saving automatic receive preference…'
          : ''
    );
    setChecked(null);
    try {
      if (request.kind === 'automatic' || request.kind === 'receive') {
        const api = await import('$lib/manabi/reader-bridge-local');
        operation.signal.throwIfAborted();
        const save =
          request.kind === 'receive'
            ? api.setDriveReaderAutomaticReceive
            : api.setDriveReaderAutomaticChecks;
        const updated = await save(
          owner,
          record.id,
          record.revision,
          request.enabled,
          operation.signal
        );
        if (!operation.signal.aborted) {
          setAutomatic(updated.automaticChecks === true);
          setReceive(updated.automaticReceive === true);
          setNotice('');
          onChanged(updated);
        }
      } else if (request.kind === 'remove') {
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
      if (request.kind === 'automatic' || request.kind === 'receive') {
        setAutomatic(record.automaticChecks === true);
        setReceive(record.automaticReceive === true);
        setNotice(
          code === 'changed'
            ? 'This book or connection changed. Refresh saved connections before trying again.'
            : request.kind === 'receive'
              ? 'The automatic receive preference could not be confirmed. Refresh saved connections to see the saved setting.'
              : 'The automatic check preference could not be confirmed. Refresh saved connections to see the saved setting.'
        );
        return;
      }
      setNotice(
        request.kind === 'remove'
          ? 'The removal could not be confirmed. Refresh saved connections to check. Your book and reading data are kept.'
          : ['changed', 'conflict', 'exists'].includes(String(code))
            ? 'This saved pair changed. Preview the current Drive copy and compare it again before replacing the connection.'
            : 'Could not check Google Drive. Your book and reading data are saved on this device. Try again when connected.'
      );
    } finally {
      if (!operation.signal.aborted) setAction(null);
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
        <>
          <div className="reader-bridge-automatic-checks">
            <CheckboxField
              label="Check Google Drive automatically"
              value={automatic}
              disabled={busy}
              accessibilityDescribedBy={automaticHint}
              onValueChange={(enabled) => void run({ kind: 'automatic', enabled })}
            />
            <p className="hint" id={automaticHint}>
              Checks this book while the app is open. Turning this off also turns off automatic
              reading updates.
            </p>
            <CheckboxField
              label="Receive safe reading changes automatically"
              value={receive}
              disabled={busy}
              accessibilityDescribedBy={receiveHint}
              onValueChange={(enabled) => void run({ kind: 'receive', enabled })}
            />
            <p className="hint" id={receiveHint}>
              Uses the last accepted reading state to save compatible Drive changes on this device.
              Your local changes are kept. Conflicts, including different starting positions, need
              your review. Turning this on also enables automatic checks. Google Drive is never
              changed.
            </p>
          </div>
          <Button variant="outline" disabled={busy} onClick={() => void run({ kind: 'check' })}>
            {action === 'check'
              ? 'Checking…'
              : checked
                ? 'Check current copies again'
                : 'Check current copies'}
          </Button>
        </>
      )}
      <Button variant="outline" disabled={busy} onClick={() => void run({ kind: 'remove' })}>
        {record.state === 'restored'
          ? 'Forget recovered connection'
          : 'Forget this reader connection'}
      </Button>
      <div role="status" aria-live="polite" aria-atomic="true">
        {notice ? <p>{notice}</p> : null}
        {!notice && status ? <p className="hint">{automaticMessages[status.state]}</p> : null}
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
        Keep a verified pairing with a Ttsu or Yatsu book in Google Drive. You can check each book
        yourself or turn on automatic checks and safe reading updates. Differences that need a
        decision stay available for review.
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
          key={record.id}
          owner={owner}
          record={record}
          onChanged={(updated) =>
            setRecords((current) =>
              current.map((item) =>
                item.id === record.id && item.revision === record.revision ? updated : item
              )
            )
          }
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
