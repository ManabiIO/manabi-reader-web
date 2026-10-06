/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import React from 'react';
import { useReaderController } from './controller';
import { Dom, ReaderScope, useLatest, useReaderBindings, type ReaderViewProps } from './dom';
import { createHighlights, type HighlightsProps } from './highlights-controller';

export function ReaderHighlights(props: Partial<HighlightsProps> & ReaderViewProps) {
  const latest = useLatest(props);
  const c = useReaderController(
    () =>
      createHighlights(props as HighlightsProps, (name, detail) =>
        latest.current.events?.[name]?.({ detail })
      ),
    props
  );
  useReaderBindings(c, props);
  if (!c) return null;
  return (
    <ReaderScope name="react-reader-highlights">
      {(c.boxes ?? []).map((box, index0) => (
        <React.Fragment key={index0}>
          <Dom
            as="div"
            aria-hidden={'true'}
            className={[box.kind === 'active' && 'active', 'reader-highlight']
              .filter(Boolean)
              .join(' ')}
            style={{
              left: `${box.left}px`,
              top: `${box.top}px`,
              width: `${box.width}px`,
              height: `${box.height}px`,
              '--highlight-color':
                box.color === 'blue'
                  ? 'rgba(61, 139, 230, .36)'
                  : box.color === 'green'
                    ? 'rgba(80, 181, 116, .32)'
                    : box.color === 'pink'
                      ? 'rgba(226, 103, 151, .31)'
                      : box.color === 'purple'
                        ? 'rgba(151, 111, 214, .31)'
                        : 'rgba(242, 191, 62, .34)'
            }}
          ></Dom>
        </React.Fragment>
      ))}
    </ReaderScope>
  );
}
