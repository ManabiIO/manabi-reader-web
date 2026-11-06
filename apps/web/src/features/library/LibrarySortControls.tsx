/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { ComponentType } from 'react';
import { librarySortChoices, readLibrarySort, type LibrarySort } from './sort-options';

export interface SortChoice {
  value: string;
  label: string;
}
export interface SortChoicesProps {
  label: string;
  showHeading?: boolean;
  value: string;
  options: readonly SortChoice[];
  moreOptions?: readonly SortChoice[];
  onChange(value: string): void;
  disabled: boolean;
  compact: boolean;
}
export interface LibrarySortLayout {
  Choices: ComponentType<SortChoicesProps>;
  Separator: ComponentType;
}
const choices = librarySortChoices.map(({ property, label }) => ({ value: property, label }));
const directions = [
  { value: 'asc', label: 'Ascending' },
  { value: 'desc', label: 'Descending' }
];
const finishedDirections = [
  { value: 'desc', label: 'Newest first' },
  { value: 'asc', label: 'Oldest first' }
];

/** One sort inventory and interaction policy. Platform leaves retain browser
 * menu navigation or native wrapping choices; the caller owns every save. */
export function LibrarySortControls({
  layout: L,
  property,
  direction,
  finishedOrder,
  onSort,
  onFinishedOrder,
  disabled = false,
  compact = false
}: {
  layout: LibrarySortLayout;
  property: string;
  direction: 'asc' | 'desc';
  finishedOrder?: 'asc' | 'desc';
  onSort(property: LibrarySort, direction: 'asc' | 'desc'): void;
  onFinishedOrder(value: 'asc' | 'desc'): void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const sort = readLibrarySort({ property, direction });
  if (finishedOrder)
    return (
      <L.Choices
        label="Finished date"
        showHeading
        value={finishedOrder}
        options={finishedDirections}
        disabled={disabled}
        compact={compact}
        onChange={(value) => {
          if (!disabled && value !== finishedOrder && (value === 'asc' || value === 'desc'))
            onFinishedOrder(value);
        }}
      />
    );
  return (
    <>
      <L.Choices
        label="Sort by"
        value={sort.property}
        options={choices.slice(0, 4)}
        moreOptions={choices.slice(4)}
        disabled={disabled}
        compact={compact}
        onChange={(value) => {
          const choice = librarySortChoices.find((option) => option.property === value);
          if (!disabled && choice && choice.property !== sort.property)
            onSort(choice.property, sort.direction);
        }}
      />
      <L.Separator />
      <L.Choices
        label="Sort order"
        value={sort.direction}
        options={directions}
        disabled={disabled}
        compact={compact}
        onChange={(value) => {
          if (!disabled && value !== sort.direction && (value === 'asc' || value === 'desc'))
            onSort(sort.property, value);
        }}
      />
    </>
  );
}
