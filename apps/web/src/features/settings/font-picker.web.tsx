/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { Menu, Button } from '../../library-react/primitives';
import { CaretDown } from '@phosphor-icons/react';
import type { FontPickerProps } from './font-picker';

/** Retain the released radio menu, keyboard navigation and trigger focus return.
 * No preference, catalog or fallback decisions live in this browser leaf. */
export function FontPicker({ label, options, value, disabled, onValueChange }: FontPickerProps) {
  return (
    <Menu.Root>
      <Menu.Trigger
        child={({ props }: { props: Record<string, unknown> }) => (
          <Button
            {...props}
            variant="outline"
            className="min-h-9"
            disabled={disabled}
            aria-label={label}
            title={label}
          >
            Choose font
            <CaretDown className="size-3.5" aria-hidden="true" />
          </Button>
        )}
      />
      <Menu.Content className="w-72">
        <Menu.Label>Available fonts</Menu.Label>
        <Menu.RadioGroup value={value} onValueChange={onValueChange}>
          {options.map((option) => (
            <Menu.RadioItem key={option.value} value={option.value} disabled={disabled}>
              <span
                title={option.value}
                style={{
                  minWidth: 0,
                  overflowWrap: 'anywhere',
                  display: '-webkit-box',
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden'
                }}
              >
                {option.label}
              </span>
            </Menu.RadioItem>
          ))}
        </Menu.RadioGroup>
      </Menu.Content>
    </Menu.Root>
  );
}
