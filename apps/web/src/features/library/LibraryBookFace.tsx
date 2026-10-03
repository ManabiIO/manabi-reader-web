/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { ComponentType, ReactNode } from 'react';
export interface LibraryBookFaceLayout {
  Face: ComponentType<{ grid: boolean; children: ReactNode }>;
  Thumbnail: ComponentType<{ grid: boolean; children: ReactNode }>;
  Copy: ComponentType<{ children: ReactNode }>;
  Title: ComponentType<{ children: ReactNode }>;
  Author: ComponentType<{ children: ReactNode }>;
  Detail: ComponentType<{ children: ReactNode }>;
  Unread: ComponentType;
  Selected: ComponentType;
}
/** Shared book-face hierarchy. File/cover ownership and open/selection admission
 * stay outside this presentation; no source path or mutation capability enters it. */
export function LibraryBookFace({
  layout: L,
  title,
  author,
  readingLabel,
  finishedDay,
  readingNow = false,
  selected = false,
  grid = false,
  cover
}: {
  layout: LibraryBookFaceLayout;
  title: string;
  author: string;
  readingLabel: string;
  finishedDay?: string;
  readingNow?: boolean;
  selected?: boolean;
  grid?: boolean;
  cover: ReactNode;
}) {
  return (
    <L.Face grid={grid}>
      <L.Thumbnail grid={grid}>
        {cover}
        {selected ? <L.Selected /> : null}
      </L.Thumbnail>
      <L.Copy>
        <L.Title>{title}</L.Title>
        {author ? <L.Author>{author}</L.Author> : null}
        <L.Detail>
          {readingLabel === 'Unread' ? <L.Unread /> : readingLabel}
          {readingLabel === 'Finished' && finishedDay
            ? ` · ${finishedDay}`
            : readingNow
              ? ' · Reading now'
              : null}
        </L.Detail>
      </L.Copy>
    </L.Face>
  );
}
