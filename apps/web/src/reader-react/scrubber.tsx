/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useReaderController } from './controller';
import { Dom, ReaderScope, Sheet, useLatest, useReaderBindings, type ReaderViewProps } from './dom';
import { createScrubber, type ScrubberProps } from './scrubber-controller';

export function ReaderScrubber(props: Partial<ScrubberProps> & ReaderViewProps) {
  const latest = useLatest(props);
  const c = useReaderController(
    () =>
      createScrubber(props as ScrubberProps, (name, detail) =>
        latest.current.events?.[name]?.({ detail })
      ),
    props
  );
  useReaderBindings(c, props);
  if (!c) return null;
  return (
    <ReaderScope name="react-reader-scrubber">
      <Sheet.Root open={c.open} onOpenChange={(next) => (c.open = next)}>
        <Sheet.Content
          side={'bottom'}
          showCloseButton={true}
          onCloseAutoFocus={(event) => {
            const controls = document.querySelector<HTMLButtonElement>(
              'button[data-reader-controls]'
            );
            if (controls) {
              event.preventDefault();
              controls.focus({ preventScroll: true });
            }
          }}
          className={[
            'writing-horizontal-tb mx-auto max-w-3xl rounded-t-3xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]'
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <Sheet.Header className={['p-0'].filter(Boolean).join(' ')}>
            <Sheet.Title>{'Browse Book'}</Sheet.Title>
            <Sheet.Description>
              {
                'Preview a position, then release to open it. Your saved reading position stays put until you continue there.'
              }
            </Sheet.Description>
          </Sheet.Header>
          <Dom as="div" className={['my-6 grid gap-3'].filter(Boolean).join(' ')}>
            <Dom
              as="label"
              htmlFor={'reader-scrubber'}
              className={['text-sm'].filter(Boolean).join(' ')}
            >
              {c.preview}
            </Dom>
            <Dom
              as="input"
              id={'reader-scrubber'}
              type={'range'}
              min={'0'}
              max={'1000'}
              step={'1'}
              value={c.value}
              aria-label={'Book position'}
              aria-valuetext={c.preview}
              disabled={!c.resources.length || !c.bookKey}
              onInput={(event) => {
                // A new drag supersedes a locator still preparing for the previous release.
                c.selection.invalidate();
                // Read the input value before queued controlled-prop updates settle.
                c.value = event.currentTarget.valueAsNumber;
                c.selectionError = '';
                c.updatePreview();
              }}
              events={{ change: c.choose }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  c.open = false;
                }
              }}
              className={['h-11 w-full accent-primary'].filter(Boolean).join(' ')}
              bindings={{
                value: (value) => {
                  c.value = value;
                }
              }}
            />
          </Dom>
          {c.selectionError ? (
            <>
              <Dom
                as="p"
                role={'alert'}
                className={['text-sm text-destructive'].filter(Boolean).join(' ')}
              >
                {c.selectionError}
              </Dom>
            </>
          ) : null}
        </Sheet.Content>
      </Sheet.Root>
    </ReaderScope>
  );
}
