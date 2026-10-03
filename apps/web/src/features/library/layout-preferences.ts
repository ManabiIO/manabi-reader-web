/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export const libraryLayoutKeys = {
  library: 'manabi-library-layout',
  series: 'manabi-series-layout',
  finished: 'manabi-finished-layout'
} as const;
export type LibraryLayoutScope = keyof typeof libraryLayoutKeys;
export interface LibraryLayouts {
  library: 'grid' | 'list';
  series: 'grid' | 'list';
  finished: 'grid' | 'timeline';
}
export function libraryLayoutScope(view: {
  series?: string;
  collection?: string;
}): LibraryLayoutScope {
  return view.series ? 'series' : view.collection === 'finished' ? 'finished' : 'library';
}
export function readLibraryLayouts(value?: Partial<LibraryLayouts>): LibraryLayouts {
  return {
    library: value?.library === 'list' ? 'list' : 'grid',
    series: value?.series === 'grid' ? 'grid' : 'list',
    finished: value?.finished === 'grid' ? 'grid' : 'timeline'
  };
}
/** Call only in the existing DOM storage owner. Denied storage reads retain defaults. */
export function loadLibraryLayouts(storage: Pick<Storage, 'getItem'>): LibraryLayouts {
  try {
    return readLibraryLayouts({
      library: storage.getItem(libraryLayoutKeys.library) as LibraryLayouts['library'],
      series: storage.getItem(libraryLayoutKeys.series) as LibraryLayouts['series'],
      finished: storage.getItem(libraryLayoutKeys.finished) as LibraryLayouts['finished']
    });
  } catch {
    return readLibraryLayouts();
  }
}
