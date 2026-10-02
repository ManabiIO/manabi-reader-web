/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useReaderController } from './controller';
import {
  Dom,
  SurfaceEvents,
  ReaderScope,
  useLatest,
  useReaderBindings,
  type ReaderViewProps
} from './dom';
import { createConfetti, type ConfettiProps } from './confetti-controller';

export function BookCompletionConfetti(props: Partial<ConfettiProps> & ReaderViewProps) {
  const latest = useLatest(props);
  const c = useReaderController(
    () =>
      createConfetti(props as ConfettiProps, (name, detail) =>
        latest.current.events?.[name]?.({ detail })
      ),
    props
  );
  useReaderBindings(c, props);
  if (!c) return null;
  return (
    <ReaderScope name="react-reader-confetti">
      <Dom
        as="canvas"
        data-book-completion-confetti={true}
        styleText={`max-width: calc(100vw - ${c.confettiWidthModifier}rem);`}
        elementRef={(value) => {
          c.confettiCanvasElement = value;
        }}
        className={[c.reducedMotion && 'hidden', 'fixed top-0 right-0 flex h-full w-full']
          .filter(Boolean)
          .join(' ')}
      ></Dom>
      <SurfaceEvents
        target="window"
        events={{
          resize: () => {
            if (c.reducedMotion || !c.motionReady) return;
            c.hideConfetti();
            c.setupCanvas();
            c.updateConfetti();
            c.confettiLoop();
          }
        }}
      ></SurfaceEvents>
    </ReaderScope>
  );
}
