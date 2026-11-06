/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import React from 'react';
import { Button } from './primitives';
import type { DriveReaderPreview } from '$lib/manabi/reader-bridge-source';
import type { ReaderBridgeLocalReview } from '$lib/manabi/reader-bridge-local-state';

function position(value: Readonly<Record<string, unknown>> | undefined) {
  if (!value) return 'No saved position';
  if (typeof value.progress === 'number') return `${Math.round(value.progress * 100)}%`;
  if (typeof value.exploredCharCount === 'number')
    return `${value.exploredCharCount.toLocaleString()} characters explored`;
  return 'Saved text position';
}
function history(value: Readonly<Record<string, unknown>> | undefined) {
  if (!value) return 'No recorded reading';
  return `${Math.round(Number(value.readingTime) / 60)} min · ${Number(value.charactersRead).toLocaleString()} characters`;
}
function message(error: unknown, saving: boolean) {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
  if (code === 'unsupported-mapping')
    return 'This reader uses position or history details that cannot be saved here safely yet. Import and export remain available.';
  if (code === 'statistics-review')
    return 'Older or shared reading history needs review before this book can receive Drive changes.';
  if (['pending-sync', 'pending', 'recovery'].includes(String(code)))
    return 'This book has unfinished sync work to review. The sync recovery section keeps its saved evidence.';
  if (['changed', 'stale', 'conflict'].includes(String(code)))
    return 'One of these copies changed. Refresh the Drive preview and compare again before saving.';
  if (error instanceof Error && error.message.startsWith('A book is open'))
    return 'Return all reader tabs to the Library before saving these reading changes.';
  if (error instanceof Error && error.message.includes('requires Web Locks'))
    return 'This browser cannot safely apply reading changes across tabs. Import and local reading still work.';
  return saving
    ? 'The save could not be confirmed. Check Reader sync recovery before reviewing the current copies again.'
    : 'Reading changes could not be checked. Your reading data was kept. Try reviewing again.';
}
export function ReaderBridgeChanges({
  preview,
  comparison,
  onSaved
}: {
  preview: DriveReaderPreview;
  comparison: object;
  onSaved(): void;
}) {
  const [review, setReview] = React.useState<ReaderBridgeLocalReview | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState('');
  const [visible, setVisible] = React.useState(20);
  const pending = React.useRef<AbortController | null>(null);
  const heading = React.useId();
  const explanation = React.useId();
  const reviewHeading = React.useRef<HTMLHeadingElement>(null);
  React.useEffect(() => {
    setReview(null);
    setBusy(false);
    setNotice('');
    setVisible(20);
    return () => {
      pending.current?.abort();
      pending.current = null;
    };
  }, [preview, comparison]);
  React.useEffect(() => {
    if (review) reviewHeading.current?.focus();
  }, [review]);
  const run = async (save: boolean) => {
    if (pending.current) return;
    const operation = new AbortController();
    pending.current = operation;
    setBusy(true);
    setNotice('');
    try {
      const api = await import('$lib/manabi/reader-bridge-local');
      operation.signal.throwIfAborted();
      if (save && review) {
        await api.receiveDriveReaderChanges(
          review,
          review.plan.state === 'review' ? 'use-drive' : 'incoming',
          operation.signal
        );
        if (!operation.signal.aborted) onSaved();
      } else {
        const result = await api.reviewDriveReaderChanges(preview, comparison, operation.signal);
        if (!operation.signal.aborted) setReview(result);
      }
    } catch (error) {
      if (!operation.signal.aborted) setNotice(message(error, save));
    } finally {
      if (!operation.signal.aborted) setBusy(false);
      if (pending.current === operation) pending.current = null;
    }
  };
  const days = review
    ? [...new Set([...Object.keys(review.local.values), ...Object.keys(review.remote.values)])]
        .filter((key) => key.startsWith('statistics/'))
        .sort()
    : [];
  const canSave =
    review &&
    review.plan.state !== 'paused' &&
    !review.plan.conflicts.some((item) => item.reason === 'removed');
  return (
    <div aria-busy={busy} className="reader-bridge-changes">
      {!review ? (
        <Button variant="outline" disabled={busy} onClick={() => void run(false)}>
          {busy ? 'Checking reading changes…' : 'Review reading changes'}
        </Button>
      ) : (
        <>
          <h4 id={heading} ref={reviewHeading} tabIndex={-1}>
            Reading changes for {review.title}
          </h4>
          <div className="reader-bridge-table" role="region" aria-labelledby={heading} tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Reading data</th>
                  <th scope="col">This device</th>
                  <th scope="col">Google Drive</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Saved position</th>
                  <td>{position(review.local.values.resume)}</td>
                  <td>{position(review.remote.values.resume)}</td>
                </tr>
                {days.slice(0, visible).map((key) => (
                  <tr key={key}>
                    <th scope="row">{key.slice(11)}</th>
                    <td>{history(review.local.values[key])}</td>
                    <td>{history(review.remote.values[key])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {visible < days.length ? (
            <Button variant="outline" onClick={() => setVisible((count) => count + 20)}>
              Show more reading days ({days.length - visible} remaining)
            </Button>
          ) : null}
          <p id={explanation} className="reader-bridge-explanation">
            {review.plan.state === 'review'
              ? 'The copies differ. Choosing Google Drive replaces the differing saved position and daily totals shown here. Previous values are kept in sync recovery.'
              : 'Only incoming changes will be saved. Reading data found only on this device stays here.'}{' '}
            Google Drive will not be changed.
          </p>
          {canSave ? (
            <Button disabled={busy} aria-describedby={explanation} onClick={() => void run(true)}>
              {busy
                ? 'Saving on this device…'
                : review.plan.state === 'review'
                  ? 'Use Drive reading data on this device'
                  : 'Save reviewed changes on this device'}
            </Button>
          ) : (
            <p>
              Missing or unsupported reading records need review. No changes can be saved from this
              preview.
            </p>
          )}
        </>
      )}
      <div role="status" aria-live="polite" aria-atomic="true" className="reader-bridge-status">
        {notice ? <p>{notice}</p> : null}
      </div>
    </div>
  );
}
