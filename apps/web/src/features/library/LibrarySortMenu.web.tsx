/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { ComponentProps } from 'react';
import { CaretDown, SortAscending, SortDescending } from '@phosphor-icons/react';
import { Button, Menu } from '../../library-react/primitives';
import { LibrarySortControls } from './LibrarySortControls';
import { directSortLayout } from './sort-layout.web';
import { librarySortChoices, readLibrarySort } from './sort-options';

type SortMenuProps = Omit<ComponentProps<typeof LibrarySortControls>, 'layout' | 'compact'>;

/** Browser menu/focus leaf; the common controls and existing owner retain all
 * choices, validation and persistence. The shelf exposes this without nesting. */
export function LibrarySortMenu(props: SortMenuProps) {
  const sort = readLibrarySort(props);
  const direction = props.finishedOrder ?? sort.direction;
  const label = props.finishedOrder
    ? direction === 'asc'
      ? 'Oldest first'
      : 'Newest first'
    : librarySortChoices.find((choice) => choice.property === sort.property)!.label;
  const description = props.finishedOrder
    ? `Finished date, ${label.toLowerCase()}`
    : `${label}, ${direction === 'asc' ? 'ascending' : 'descending'}`;
  const Icon = direction === 'asc' ? SortAscending : SortDescending;
  return (
    <Menu.Root>
      <Menu.Trigger
        child={({ props: trigger }: { props: Record<string, unknown> }) => (
          <Button
            {...trigger}
            variant="outline"
            disabled={props.disabled}
            aria-label={`Sort books: ${description}`}
            title="Sort books"
            className="library-sort-trigger"
          >
            <Icon aria-hidden="true" />
            <span className="library-sort-label">{label}</span>
            <CaretDown aria-hidden="true" />
          </Button>
        )}
      />
      <Menu.Content align="end" className="library-menu w-64" aria-label="Sort books">
        <LibrarySortControls {...props} layout={directSortLayout} />
      </Menu.Content>
    </Menu.Root>
  );
}
