/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { Fragment, type ComponentType, type KeyboardEventHandler, type ReactNode } from 'react';

export interface SelectionAction {
  label: string;
  onActivate(): void;
  disabled?: boolean;
  destructive?: boolean;
  bookmark?: 'outline' | 'filled';
}
export interface LibrarySelectionLayout {
  Frame: ComponentType<{
    compact: boolean;
    onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
    children: ReactNode;
  }>;
  Button: ComponentType<
    SelectionAction & {
      kind: 'cancel' | 'all' | 'export';
      compact: boolean;
    }
  >;
  Status: ComponentType<{ compact: boolean; children: ReactNode }>;
  Menu: ComponentType<{
    compact: boolean;
    disabled: boolean;
    children(close: () => void): ReactNode;
  }>;
  Item: ComponentType<SelectionAction>;
  Separator: ComponentType;
  Notice: ComponentType<{ children: ReactNode }>;
}

/** Shared selection hierarchy and action grouping. Owners keep selection scope,
 * capabilities, confirmations and persistence; leaves supply platform controls. */
export function LibrarySelectionToolbar({
  layout,
  count,
  scope,
  compact,
  busy = false,
  selectLabel,
  onCancel,
  onSelect,
  onKeyDown,
  exportAction,
  groups,
  notice
}: {
  layout: LibrarySelectionLayout;
  count: number;
  scope?: string;
  compact: boolean;
  busy?: boolean;
  selectLabel: string;
  onCancel(): void;
  onSelect(): void;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  exportAction?: SelectionAction;
  groups: readonly (readonly SelectionAction[])[];
  notice?: string;
}) {
  const { Frame, Button, Status, Menu, Item, Separator, Notice } = layout;
  const availableGroups = groups.filter((group) => group.length > 0);
  return (
    <Frame compact={compact} onKeyDown={onKeyDown}>
      <Button
        kind="cancel"
        compact={compact}
        label="Cancel selection"
        disabled={busy}
        onActivate={onCancel}
      />
      <Status compact={compact}>{`${count} selected${scope ? ` ${scope}` : ''}`}</Status>
      <Button
        kind="all"
        compact={compact}
        label={selectLabel}
        disabled={busy}
        onActivate={onSelect}
      />
      {count > 0 && exportAction && (
        <Button
          {...exportAction}
          kind="export"
          compact={compact}
          disabled={busy || exportAction.disabled}
        />
      )}
      {count > 0 && availableGroups.length > 0 && (
        <Menu compact={compact} disabled={busy}>
          {(close) =>
            availableGroups.map((group, index) => (
              <Fragment key={index}>
                {index > 0 && <Separator />}
                {group.map((action) => (
                  <Item
                    {...action}
                    key={action.label}
                    disabled={busy || action.disabled}
                    onActivate={() => {
                      close();
                      action.onActivate();
                    }}
                  />
                ))}
              </Fragment>
            ))
          }
        </Menu>
      )}
      {notice && <Notice>{notice}</Notice>}
    </Frame>
  );
}
