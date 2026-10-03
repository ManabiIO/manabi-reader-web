/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { dialogManager } from '$lib/data/dialog-manager';
import { sanitizeDialogHtml } from '$lib/functions/book-security/dialog-content-security';
import { logger } from '$lib/data/logger';
import { useStore } from '../runtime/use-store';
import { hideExternalReadHint$, skipKeyDownListener$ } from '$lib/data/store';
import { decrypt, type StorageUnlockAction } from '$lib/data/storage/storage-source-manager';

type Close = { onClose?: () => void };
export function DialogTemplate({
  title,
  children,
  footer
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex max-h-[calc(90dvh-60px)] min-h-0 min-w-0 flex-col">
      <header className="min-w-0 shrink-0 px-[24px] pb-[12px]">
        <h2 id="manabi-dialog-title" className="text-xl font-semibold [overflow-wrap:anywhere]">
          {title}
        </h2>
      </header>
      <section
        data-dialog-scroll
        className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain px-[24px] pb-[24px]"
      >
        {children}
      </section>
      {footer && (
        <footer className="flex min-w-0 shrink-0 flex-wrap justify-end gap-[8px] border-t p-[16px]">
          {footer}
        </footer>
      )}
    </div>
  );
}
const buttonClass =
  'inline-flex min-h-[44px] items-center justify-center rounded-xl border px-[12px] py-[8px] font-medium disabled:opacity-50';
/** Resolver ownership is per mounted dialog, including escape/back/unmount. */
function useResolution<T>(resolver: (value: T) => void, cancelled: T, onClose?: () => void) {
  const settled = useRef(false);
  const active = useRef(true);
  const generation = useRef(0);
  const resolverRef = useRef(resolver);
  resolverRef.current = resolver;
  const cancelledRef = useRef(cancelled);
  cancelledRef.current = cancelled;
  useEffect(() => {
    active.current = true;
    generation.current++;
    return () => {
      active.current = false;
      const retired = ++generation.current;
      // Strict Mode replays setup synchronously. Only an actual retired
      // lifetime may cancel a still-pending resolver in the following turn.
      queueMicrotask(() => {
        if (generation.current !== retired || active.current || settled.current) return;
        settled.current = true;
        resolverRef.current(cancelledRef.current);
      });
    };
  }, []);
  return (value: T) => {
    if (!active.current || settled.current) return;
    settled.current = true;
    resolverRef.current(value);
    onClose?.();
  };
}
export function ConfirmDialog({
  dialogHeader,
  dialogMessage,
  showCancel = true,
  resolver,
  onClose
}: Close & {
  dialogHeader: string;
  dialogMessage: string;
  showCancel?: boolean;
  contentStyles?: string;
  resolver: (cancelled: boolean) => void;
}) {
  const finish = useResolution<boolean>(resolver, true, onClose);
  return (
    <DialogTemplate
      title={dialogHeader}
      footer={
        <>
          {showCancel && (
            <button data-variant="secondary" className={buttonClass} onClick={() => finish(true)}>
              Cancel
            </button>
          )}
          <button
            data-variant="default"
            className={`${buttonClass} bg-primary text-primary-foreground`}
            onClick={() => finish(false)}
          >
            Confirm
          </button>
        </>
      }
    >
      <p className="[overflow-wrap:anywhere]">{dialogMessage}</p>
    </DialogTemplate>
  );
}
export function NumberDialog({
  dialogHeader,
  showCancel = true,
  minValue = 1,
  maxValue = 1,
  resolver,
  onClose
}: Close & {
  dialogHeader: string;
  showCancel?: boolean;
  minValue?: number;
  maxValue?: number;
  resolver: (position: number | undefined) => void;
}) {
  const [value, setValue] = useState(String(minValue));
  const [error, setError] = useState('');
  const finish = useResolution<number | undefined>(resolver, undefined, onClose);
  function submit() {
    const number = value === '' ? NaN : Number(value);
    if (!Number.isSafeInteger(minValue) || !Number.isSafeInteger(maxValue) || minValue > maxValue)
      return setError('Position range is unavailable.');
    if (!Number.isSafeInteger(number) || number < minValue || number > maxValue)
      return setError(`Enter a whole number between ${minValue} and ${maxValue}.`);
    finish(number);
  }
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <DialogTemplate
        title={dialogHeader}
        footer={
          <>
            {showCancel && (
              <button
                data-variant="secondary"
                type="button"
                className={buttonClass}
                onClick={() => finish(undefined)}
              >
                Cancel
              </button>
            )}
            <button data-variant="default" className={buttonClass} type="submit">
              Confirm
            </button>
          </>
        }
      >
        <input
          className="min-h-11 w-full rounded-xl border bg-background p-3"
          aria-label={dialogHeader}
          aria-invalid={!!error}
          aria-describedby={`number-dialog-help${error ? ' number-dialog-error' : ''}`}
          type="number"
          inputMode="numeric"
          min={minValue}
          max={maxValue}
          step={1}
          required
          value={value}
          onChange={(e) => {
            setValue(e.currentTarget.value);
            setError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault();
          }}
        />
        <p id="number-dialog-help">
          Enter a position between {minValue} and {maxValue}.
        </p>
        {error && (
          <p id="number-dialog-error" role="alert">
            {error}
          </p>
        )}
      </DialogTemplate>
    </form>
  );
}
export function MessageDialog({
  title,
  message,
  onClose
}: Close & { title: string; message: string }) {
  return (
    <DialogTemplate
      title={title}
      footer={
        <button className={buttonClass} onClick={onClose}>
          Close
        </button>
      }
    >
      <p className="[overflow-wrap:anywhere]">{message}</p>
    </DialogTemplate>
  );
}
export function LogReportDialog({ title = 'Error', message }: { title?: string; message: string }) {
  const report = JSON.stringify(
    {
      userAgent: navigator.userAgent,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      languages: navigator.languages,
      viewport: { width: innerWidth, height: innerHeight },
      log: logger.history
    },
    null,
    2
  );
  return (
    <DialogTemplate
      title={title}
      footer={
        <>
          <a
            className={buttonClass}
            href="https://github.com/ManabiIO/manabi-reader-web"
            target="_blank"
            rel="noreferrer"
          >
            Open Repository
          </a>
          <a
            className={buttonClass}
            href={`data:text/json;charset=utf-8,${encodeURIComponent(report)}`}
            download="log.json"
          >
            Download Report
          </a>
        </>
      }
    >
      <p>{message}</p>
      <p>
        The diagnostic report is generated in this browser. Review the downloaded file before
        sharing it.
      </p>
    </DialogTemplate>
  );
}
export function ExternalReadDialog({
  resolver,
  onClose
}: Close & { resolver: (value: string) => void }) {
  const finish = useResolution<string>(resolver, 'cancel', onClose);
  const hide = useStore(hideExternalReadHint$);
  return (
    <DialogTemplate
      title="Read from external storage"
      footer={
        <>
          <button className={buttonClass} onClick={() => finish('cancel')}>
            Cancel
          </button>
          <button className={buttonClass} onClick={() => finish('export')}>
            Open Export
          </button>
          <button className={buttonClass} onClick={() => finish('')}>
            Continue
          </button>
        </>
      }
    >
      <p>
        This book is stored outside the browser. Opening it downloads the complete book again and
        can interact with your configured sync target.
      </p>
      <p>
        Export a browser copy if you want to avoid downloading the source again on future reads.
      </p>
      <label>
        <input
          type="checkbox"
          checked={hide}
          onChange={(e) => hideExternalReadHint$.next(e.currentTarget.checked)}
        />{' '}
        Remember my choice and hide this message
      </label>
    </DialogTemplate>
  );
}
export function StorageUnlock({
  description,
  action,
  requiresSecret = true,
  showCancel = false,
  forwardSecret = false,
  encryptedData,
  resolver,
  onClose
}: Close & {
  description: string;
  action: string;
  requiresSecret?: boolean;
  showCancel?: boolean;
  forwardSecret?: boolean;
  encryptedData?: ArrayBuffer;
  resolver: (value: StorageUnlockAction | undefined) => void;
}) {
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const active = useRef(true);
  const running = useRef(false);
  const finish = useResolution<StorageUnlockAction | undefined>(resolver, undefined, onClose);
  useEffect(() => {
    active.current = true;
    skipKeyDownListener$.next(true);
    return () => {
      active.current = false;
      skipKeyDownListener$.next(false);
    };
  }, []);
  async function unlock() {
    if (running.current || !active.current) return;
    running.current = true;
    setPending(true);
    setError('');
    try {
      let result: StorageUnlockAction;
      if (encryptedData) {
        const decoded = JSON.parse(
          new TextDecoder().decode(await decrypt(window, encryptedData, secret))
        ) as StorageUnlockAction;
        result = { ...decoded, ...(forwardSecret ? { secret } : {}) };
      } else if (requiresSecret) throw new Error('No encrypted data is available.');
      else result = { clientId: '', clientSecret: '' };
      if (active.current) finish(result);
    } catch (cause) {
      if (active.current)
        setError(
          cause instanceof Error
            ? `Could not unlock data: ${cause.message}`
            : 'Could not unlock data.'
        );
    } finally {
      running.current = false;
      if (active.current) setPending(false);
    }
  }
  return (
    <form
      className="w-full min-w-0"
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        void unlock();
      }}
    >
      <DialogTemplate
        title={requiresSecret ? 'Unlock storage source' : 'Continue to sign in'}
        footer={
          <>
            {(requiresSecret || showCancel) && (
              <button
                type="button"
                disabled={pending}
                className={buttonClass}
                onClick={() => finish(undefined)}
              >
                Cancel
              </button>
            )}
            <button type="submit" disabled={pending} className={buttonClass}>
              {pending
                ? requiresSecret
                  ? 'Unlocking…'
                  : 'Continuing…'
                : requiresSecret
                  ? 'Unlock'
                  : 'Continue'}
            </button>
          </>
        }
      >
        <p>{description}</p>
        <p>{action}</p>
        {requiresSecret && (
          <label className="grid min-w-0 gap-[8px]">
            Password
            <input
              className="min-h-[44px] w-full min-w-0 rounded-xl border border-input bg-background px-[12px] py-[8px]"
              autoFocus
              type="password"
              autoComplete="current-password"
              required
              disabled={pending}
              value={secret}
              onChange={(e) => {
                setSecret(e.currentTarget.value);
                setError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault();
              }}
            />
          </label>
        )}
        {error && <p role="alert">{error}</p>}
      </DialogTemplate>
    </form>
  );
}
const dialogIdentities = new WeakMap<object, number>();
let nextDialogIdentity = 0;
function dialogIdentity(dialog: object) {
  let identity = dialogIdentities.get(dialog);
  if (identity === undefined) {
    identity = ++nextDialogIdentity;
    dialogIdentities.set(dialog, identity);
  }
  return identity;
}
export function DialogHost() {
  const dialogs = useStore(dialogManager.dialogs$);
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const close = () => dialogManager.dialogs$.next(dialogManager.dialogs$.getValue().slice(1));
  useEffect(() => {
    if (dialogs.length && !ref.current?.open) {
      returnFocus.current = document.activeElement as HTMLElement;
      ref.current?.showModal();
    }
    if (!dialogs.length && ref.current?.open) {
      ref.current.close();
      const previous = returnFocus.current;
      requestAnimationFrame(() => {
        const target =
          document.querySelector<HTMLElement>('button[data-reader-controls]') ?? previous;
        if (target?.isConnected) target.focus({ preventScroll: true });
      });
    }
  }, [dialogs.length]);
  const current = dialogs[0];
  const Component = current?.component;
  const markup = useMemo(
    () =>
      typeof Component === 'string'
        ? { __html: sanitizeDialogHtml(Component, document) }
        : undefined,
    [Component]
  );
  return (
    <dialog
      ref={ref}
      data-slot={current ? 'dialog-content' : undefined}
      role={current ? 'dialog' : undefined}
      aria-modal={current ? true : undefined}
      aria-labelledby="manabi-dialog-title"
      className="m-auto max-h-[90dvh] w-[min(96vw,48rem)] max-w-[calc(100vw-16px)] overflow-hidden rounded-2xl border border-border bg-background p-0 pt-[60px] text-foreground shadow-xl writing-horizontal-tb backdrop:bg-black/40"
      onCancel={(e) => {
        e.preventDefault();
        if (!current?.disableCloseOnClick) close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !current?.disableCloseOnClick) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            close();
        }
      }}
    >
      {current && (
        <>
          {!current.disableCloseOnClick && (
            <button
              className="absolute top-[12px] right-[12px] min-h-[44px] min-w-[44px] rounded-full border"
              data-modal-dismiss=""
              data-shape="circle"
              aria-label="Close"
              onClick={close}
            >
              ×
            </button>
          )}
          {typeof Component === 'string' ? (
            <>
              <h2 id="manabi-dialog-title" className="sr-only">
                Reader dialog
              </h2>
              <div dangerouslySetInnerHTML={markup} />
            </>
          ) : Component ? (
            <Component key={dialogIdentity(current)} {...current.props} onClose={close} />
          ) : null}
        </>
      )}
    </dialog>
  );
}
