/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useReaderController } from './controller';
import {
  Dom,
  ReaderScope,
  Icon,
  Button,
  useLatest,
  useReaderBindings,
  type ReaderViewProps
} from './dom';
import { createLineGuide, type LineGuideProps } from './line-guide-controller';

export function ReaderLineGuide(props: Partial<LineGuideProps> & ReaderViewProps) {
  const latest = useLatest(props);
  const c = useReaderController(
    () =>
      createLineGuide(props as LineGuideProps, (name, detail) =>
        latest.current.events?.[name]?.({ detail })
      ),
    props
  );
  useReaderBindings(c, props);
  if (!c) return null;
  return (
    <ReaderScope name="react-reader-line-guide">
      {c.enabled ? (
        <>
          {c.aperture ? (
            <>
              {(() => {
                const padding = 5;
                return (
                  <>
                    <Dom
                      as="div"
                      className={['guide-dim'].filter(Boolean).join(' ')}
                      style={{
                        height: `${Math.max(0, c.aperture.top - padding)}px`,
                        '--guide-dim': c.dimming
                      }}
                    ></Dom>
                    <Dom
                      as="div"
                      className={['guide-dim'].filter(Boolean).join(' ')}
                      style={{ top: `${c.aperture.bottom + padding}px`, '--guide-dim': c.dimming }}
                    ></Dom>
                    <Dom
                      as="div"
                      className={['guide-dim'].filter(Boolean).join(' ')}
                      style={{
                        top: `${Math.max(0, c.aperture.top - padding)}px`,
                        bottom: `${Math.max(0, innerHeight - c.aperture.bottom - padding)}px`,
                        width: `${Math.max(0, c.aperture.left - padding)}px`,
                        '--guide-dim': c.dimming
                      }}
                    ></Dom>
                    <Dom
                      as="div"
                      className={['guide-dim'].filter(Boolean).join(' ')}
                      style={{
                        top: `${Math.max(0, c.aperture.top - padding)}px`,
                        bottom: `${Math.max(0, innerHeight - c.aperture.bottom - padding)}px`,
                        left: `${c.aperture.right + padding}px`,
                        '--guide-dim': c.dimming
                      }}
                    ></Dom>
                  </>
                );
              })()}
            </>
          ) : null}
          <Dom
            as="div"
            className={[
              'guide-controls writing-horizontal-tb fixed bottom-4 left-4 z-20 flex items-center gap-1 rounded-full border border-border bg-background p-1 shadow-sm'
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <Button
              variant={'ghost'}
              size={'icon'}
              aria-label={'Previous line'}
              disabled={!c.lines.length || c.active === 0}
              onClick={() => c.move(-1)}
              className={['size-11'].filter(Boolean).join(' ')}
            >
              <Icon name="CaretLeft" aria-hidden={'true'}></Icon>
            </Button>
            <Dom
              as="span"
              className={['min-w-14 text-center text-xs text-muted-foreground']
                .filter(Boolean)
                .join(' ')}
            >
              {'Line '}
              {c.lines.length ? c.active + 1 : 0}
            </Dom>
            <Button
              variant={'ghost'}
              size={'icon'}
              aria-label={'Next line'}
              disabled={!c.lines.length || c.active === c.lines.length - 1}
              onClick={() => c.move(1)}
              className={['size-11'].filter(Boolean).join(' ')}
            >
              <Icon name="CaretRight" aria-hidden={'true'}></Icon>
            </Button>
            <Button
              variant={'ghost'}
              aria-label={'Visible lines'}
              onClick={() => {
                c.visibleLines = c.visibleLines === 1 ? 3 : 1;
                c.updateAperture();
              }}
              className={['min-h-11 px-3 text-xs'].filter(Boolean).join(' ')}
            >
              {c.visibleLines}
              {c.visibleLines === 1 ? 'line' : 'lines'}
            </Button>
            <Dom
              as="label"
              htmlFor={'line-guide-dimming'}
              className={['sr-only'].filter(Boolean).join(' ')}
            >
              {'Line Guide dimming'}
            </Dom>
            <Dom
              as="input"
              id={'line-guide-dimming'}
              type={'range'}
              min={'0.1'}
              max={'0.6'}
              step={'0.05'}
              value={c.dimming}
              aria-label={'Line Guide dimming'}
              className={['w-16 accent-primary'].filter(Boolean).join(' ')}
              bindings={{
                value: (value) => {
                  c.dimming = value;
                }
              }}
            />
            <Button
              variant={'ghost'}
              size={'icon'}
              aria-label={'Close Line Guide'}
              onClick={() => (c.enabled = false)}
              className={['size-11'].filter(Boolean).join(' ')}
            >
              <Icon name="X" aria-hidden={'true'}></Icon>
            </Button>
          </Dom>
        </>
      ) : null}
    </ReaderScope>
  );
}
