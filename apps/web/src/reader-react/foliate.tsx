/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useReaderController } from './controller';
import { Dom, ReaderScope, useLatest, useReaderBindings, type ReaderViewProps } from './dom';
import { createFoliate, type FoliateProps } from './foliate-controller';

export function BookReaderFoliatePaginated(props: Partial<FoliateProps> & ReaderViewProps) {
  const latest = useLatest(props);
  const c = useReaderController(
    () =>
      createFoliate(props as FoliateProps, (name, detail) =>
        latest.current.events?.[name]?.({ detail })
      ),
    props
  );
  useReaderBindings(c, props);
  if (!c) return null;
  return (
    <ReaderScope name="react-reader-foliate">
      <Dom
        as="div"
        elementRef={(value) => {
          c.host = value;
        }}
        aria-label={'EPUB reader'}
        aria-busy={c.loadingState}
        className={['foliate-reader book-content'].filter(Boolean).join(' ')}
        style={{
          '--reader-page-overlay': c.$resolvedMode$ === 'dark' ? 'white' : 'black',
          width: c.width ? `${c.width}px` : '100%',
          height: c.height ? `${c.height}px` : '100%'
        }}
      ></Dom>
    </ReaderScope>
  );
}
