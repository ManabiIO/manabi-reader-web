/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { ComponentType, ReactNode } from 'react';
import { bookExportOptions, type BookExportPart } from './export-options';

export interface BookExportContentLayout {
  Group: ComponentType<{ children: ReactNode }>;
  Choice: ComponentType<{
    value: BookExportPart;
    label: string;
    checked: boolean;
    disabled: boolean;
    onChange(checked: boolean): void;
  }>;
}

/** Common content inventory and toggling; owners retain destination/persistence. */
export function BookExportContent({
  layout: { Group, Choice },
  selected,
  disabled = false,
  onChange
}: {
  layout: BookExportContentLayout;
  selected: readonly string[];
  disabled?: boolean;
  onChange(parts: BookExportPart[]): void;
}) {
  return (
    <Group>
      {bookExportOptions.map(([value, label]) => (
        <Choice
          key={value}
          value={value}
          label={label}
          checked={selected.includes(value)}
          disabled={disabled}
          onChange={(checked) =>
            onChange(
              bookExportOptions
                .map(([part]) => part)
                .filter((part) => (part === value ? checked : selected.includes(part)))
            )
          }
        />
      ))}
    </Group>
  );
}
