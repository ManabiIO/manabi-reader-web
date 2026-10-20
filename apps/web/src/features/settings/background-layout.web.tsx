/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { CSSProperties, ReactNode } from 'react';
import type {
  BackgroundFrameProps,
  BackgroundModeProps,
  BackgroundPreviewProps,
  BackgroundMessageProps
} from './background-layout';
export function BackgroundFrame({ label, busy, children }: BackgroundFrameProps) {
  return (
    <fieldset className="background-setting" aria-busy={busy}>
      <legend>{label}</legend>
      {children}
    </fieldset>
  );
}
export function BackgroundModes({ children }: { children?: ReactNode }) {
  return <div className="mode-grid">{children}</div>;
}
export function BackgroundModeFrame({ target, mode, children }: BackgroundModeProps) {
  const id = `${target}-${mode}-heading`;
  return (
    <section aria-labelledby={id} className="mode-image rounded-2xl bg-muted/40 p-3">
      <h3 id={id}>{mode === 'light' ? 'Light' : 'Dark'}</h3>
      {children}
    </section>
  );
}
export function BackgroundPreview({ target, mode, uri, fade }: BackgroundPreviewProps) {
  return (
    <div
      aria-hidden="true"
      className={mode === 'dark' ? 'background-preview dark-preview' : 'background-preview'}
      style={
        {
          backgroundImage: uri ? `url("${uri}")` : undefined,
          '--image-fade-color': mode === 'dark' ? '0 0 0' : '255 255 255',
          '--background-fade': fade
        } as CSSProperties
      }
    >
      {uri ? (
        <span className={target === 'reader' ? 'reader-preview' : undefined}>
          本を読む
          <br />
          <small>Read comfortably</small>
        </span>
      ) : (
        <span>No image</span>
      )}
    </div>
  );
}
export function BackgroundMessage({ kind, children }: BackgroundMessageProps) {
  return (
    <p
      className={kind === 'status' ? undefined : kind}
      role={kind === 'status' ? 'status' : kind === 'error' ? 'alert' : undefined}
    >
      {children}
    </p>
  );
}
export function BackgroundActions({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}
