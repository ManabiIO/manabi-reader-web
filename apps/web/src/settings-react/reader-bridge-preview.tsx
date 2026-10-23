/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import React from 'react';
import { Button } from './primitives';
import { ReaderBridgeChanges } from './reader-bridge-changes';
import type {
  DriveReaderSelection,
  previewDriveReaderBridge
} from '$lib/manabi/reader-bridge-source';

type Preview = Awaited<ReturnType<typeof previewDriveReaderBridge>>;
type LocalComparison = Awaited<
  ReturnType<typeof import('$lib/manabi/reader-bridge-local').compareDriveReaderLocalBook>
>;

function LocalBookComparison({ preview }: { preview: Preview }) {
  const [choices, setChoices] = React.useState<readonly { id: number; title: string }[]>([]);
  const [selected, setSelected] = React.useState('');
  const [result, setResult] = React.useState<LocalComparison | null>(null);
  const [busy, setBusy] = React.useState(true);
  const [message, setMessage] = React.useState('');
  const pending = React.useRef<AbortController | null>(null);
  const selectId = React.useId();
  const labels = React.useMemo(() => {
    const totals = new Map<string, number>();
    const seen = new Map<string, number>();
    for (const book of choices) totals.set(book.title, (totals.get(book.title) ?? 0) + 1);
    return choices.map((book) => {
      const copy = (seen.get(book.title) ?? 0) + 1;
      seen.set(book.title, copy);
      return {
        ...book,
        label: totals.get(book.title)! > 1 ? `${book.title} — copy ${copy}` : book.title
      };
    });
  }, [choices]);
  React.useEffect(() => {
    const operation = new AbortController();
    pending.current = operation;
    void (async () => {
      try {
        const { listDriveReaderLocalBooks } = await import('$lib/manabi/reader-bridge-local');
        operation.signal.throwIfAborted();
        const books = await listDriveReaderLocalBooks(preview, operation.signal);
        if (!operation.signal.aborted) {
          setChoices(books);
          if (!books.length)
            setMessage('Import a local copy of this book to compare its reading data.');
        }
      } catch {
        if (!operation.signal.aborted)
          setMessage('Local books could not be checked. Refresh the preview to try again.');
      } finally {
        if (!operation.signal.aborted) setBusy(false);
        if (pending.current === operation) pending.current = null;
      }
    })();
    return () => {
      operation.abort();
      pending.current?.abort();
    };
  }, [preview]);
  const compare = async () => {
    if (!selected || pending.current) return;
    const operation = new AbortController();
    pending.current = operation;
    setBusy(true);
    setResult(null);
    setMessage('');
    try {
      const { compareDriveReaderLocalBook } = await import('$lib/manabi/reader-bridge-local');
      operation.signal.throwIfAborted();
      const value = await compareDriveReaderLocalBook(preview, Number(selected), operation.signal);
      if (!operation.signal.aborted) setResult(value);
    } catch (error) {
      if (operation.signal.aborted) return;
      const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
      setMessage(
        code === 'legacy-media'
          ? 'This older local copy needs its images saved in the current format before it can be checked for sync. You can keep reading it.'
          : code === 'changed'
            ? 'The local copy changed during the check. Compare it again to see the current copy.'
            : 'This local copy could not be checked. Refresh the preview to try again.'
      );
    } finally {
      if (!operation.signal.aborted) setBusy(false);
      if (pending.current === operation) pending.current = null;
    }
  };
  return (
    <div className="reader-bridge-comparison" aria-busy={busy}>
      {choices.length ? (
        <>
          <label htmlFor={selectId}>Local copy</label>
          <select
            id={selectId}
            className="settings-select"
            value={selected}
            disabled={busy}
            onChange={(event) => {
              setSelected(event.currentTarget.value);
              setResult(null);
              setMessage('');
            }}
          >
            <option value="">Choose a book on this device</option>
            {labels.map((book) => (
              <option key={book.id} value={book.id}>
                {book.label}
              </option>
            ))}
          </select>
          <Button variant="outline" disabled={!selected || busy} onClick={() => void compare()}>
            {busy ? 'Comparing local copy…' : 'Compare local copy'}
          </Button>
        </>
      ) : null}
      <div role="status" aria-live="polite">
        {message ? <p>{message}</p> : null}
        {result ? (
          <>
            <p>
              {result.matches
                ? 'The local text, images and layout match this Drive preview.'
                : 'These copies have different content or layout. Their reading data cannot be linked safely.'}
            </p>
            {result.matches ? (
              <p>
                {result.hasResume
                  ? result.progress === undefined
                    ? 'A local reading position is saved.'
                    : `Local saved position: ${Math.round(result.progress * 100)}%.`
                  : 'No local reading position is saved.'}{' '}
                No reading data has been changed.
              </p>
            ) : null}
          </>
        ) : null}
      </div>
      {result?.matches ? (
        <ReaderBridgeChanges
          key={selected}
          preview={preview}
          comparison={result}
          onSaved={() => {
            setResult(null);
            setMessage(
              'Reading changes saved on this device. Google Drive was not changed. Previous values are available in Reader sync recovery.'
            );
          }}
        />
      ) : null}
    </div>
  );
}

/** The parent keys this view to account generation and the complete selection. */
export function ReaderBridgePreview({
  selection,
  disabled = false
}: {
  selection: DriveReaderSelection;
  disabled?: boolean;
}) {
  const [result, setResult] = React.useState<Preview | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const pending = React.useRef<AbortController | null>(null);
  const heading = React.useId();
  React.useEffect(
    () => () => {
      pending.current?.abort();
    },
    []
  );
  const check = async () => {
    if (pending.current || disabled) return;
    const operation = new AbortController();
    pending.current = operation;
    setBusy(true);
    setMessage('');
    setResult(null);
    try {
      const { previewDriveReaderBridge } = await import('$lib/manabi/reader-bridge-source');
      operation.signal.throwIfAborted();
      const value = await previewDriveReaderBridge(selection, operation.signal);
      if (!operation.signal.aborted) setResult(value);
    } catch (error) {
      if (operation.signal.aborted) return;
      const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
      setMessage(
        code === 'conflict'
          ? 'This library changed while it was being checked. Preview it again to see the current copy.'
          : code === 'unsupported_reader_format'
            ? 'This reader format is not supported yet. The files in Google Drive were kept.'
            : 'The preview could not be completed. Your books and reading data were kept.'
      );
    } finally {
      if (!operation.signal.aborted) setBusy(false);
      if (pending.current === operation) pending.current = null;
    }
  };
  const progress = result?.projection.values.resume?.progress;
  const days = result
    ? Object.keys(result.projection.values).filter((key) => key.startsWith('statistics/')).length
    : 0;
  return (
    <article className="library" aria-labelledby={heading} aria-busy={busy}>
      <h3 id={heading}>{selection.profile.startsWith('yatsu-') ? 'Yatsu' : 'Ttsu'} reading data</h3>
      <p>Preview the reading position and history for this book in Google Drive.</p>
      <Button variant="outline" disabled={disabled || busy} onClick={() => void check()}>
        {busy ? 'Checking Google Drive…' : result ? 'Refresh preview' : 'Preview reading data'}
      </Button>
      <p className="hint">
        Automatic sync is not connected. You can review compatible reading changes before saving
        them on this device. Google Drive stays unchanged.
      </p>
      <div role="status" aria-live="polite">
        {message ? <p>{message}</p> : null}
        {result ? (
          <>
            <p>
              <strong>{result.title}</strong>
            </p>
            <p>
              {result.projection.values.resume
                ? typeof progress === 'number'
                  ? `Saved position: ${Math.round(progress * 100)}%.`
                  : 'A saved reading position is available.'
                : 'No saved reading position was found.'}{' '}
              {days} recorded reading {days === 1 ? 'day' : 'days'}.
            </p>
          </>
        ) : null}
      </div>
      {result ? <LocalBookComparison preview={result} /> : null}
    </article>
  );
}
