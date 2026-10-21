/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { Menu } from '../../library-react/primitives';
import type { LibrarySortLayout, SortChoicesProps } from './LibrarySortControls';

function Choices({
  label,
  showHeading,
  value,
  options,
  moreOptions,
  onChange,
  disabled,
  compact
}: SortChoicesProps) {
  const group = (items: SortChoicesProps['options']) => (
    <Menu.RadioGroup value={value} onValueChange={onChange}>
      {items.map((choice) => (
        <Menu.RadioItem key={choice.value} value={choice.value} disabled={disabled}>
          {choice.label}
        </Menu.RadioItem>
      ))}
    </Menu.RadioGroup>
  );
  return (
    <>
      {showHeading && <Menu.Label>{label}</Menu.Label>}
      {group(options)}
      {!!moreOptions?.length && (
        <Menu.Sub>
          <Menu.SubTrigger disabled={disabled}>More Sort Options</Menu.SubTrigger>
          <Menu.SubContent
            side={compact ? 'bottom' : 'right'}
            align="end"
            collisionPadding={8}
            className="library-menu w-52"
          >
            {group(moreOptions)}
          </Menu.SubContent>
        </Menu.Sub>
      )}
    </>
  );
}
export const sortLayout: LibrarySortLayout = { Choices, Separator: Menu.Separator };
