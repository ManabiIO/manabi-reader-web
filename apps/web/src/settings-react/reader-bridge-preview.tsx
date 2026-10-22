/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import React from 'react';
import { Button } from './primitives';
import type {
  DriveReaderSelection,
  previewDriveReaderBridge
} from '$lib/manabi/reader-bridge-source';

type Preview = Awaited<ReturnType<typeof previewDriveReaderBridge>>;

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
        Preview only. Automatic sync is not connected yet; your files stay unchanged.
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
    </article>
  );
}
