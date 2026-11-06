/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { BookmarkSimple, FileArrowUp, SelectionAll, X } from '@phosphor-icons/react';
import { Button, Menu } from '../../library-react/primitives';
import { ActionMenu } from '../../library-react/navigation';
import type { LibrarySelectionLayout } from './LibrarySelectionToolbar';

export const selectionLayout: LibrarySelectionLayout = {
  Frame: ({ compact, onKeyDown, children }) => (
    <div
      role="toolbar"
      aria-label="Book selection"
      onKeyDown={onKeyDown}
      className={[
        compact ? 'compact-selection' : '',
        'library-selection-toolbar mx-auto flex min-h-14 max-w-6xl flex-wrap items-center gap-2 border-t border-border/60 px-[16px] py-[8px] sm:px-[24px]'
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  ),
  Button: ({ kind, compact, label, disabled, onActivate }) => {
    const Icon = kind === 'cancel' ? X : kind === 'all' ? SelectionAll : FileArrowUp;
    return (
      <Button
        variant={kind === 'cancel' ? 'ghost' : kind === 'all' ? 'outline' : 'secondary'}
        aria-label={label}
        disabled={disabled}
        onClick={onActivate}
        className="selection-action"
      >
        {compact ? <Icon aria-hidden="true" className="size-[24px]" /> : label}
      </Button>
    );
  },
  Status: ({ children }) => (
    <span role="status" aria-live="polite" aria-atomic="true" className="text-sm whitespace-nowrap">
      {children}
    </span>
  ),
  Menu: ({ compact, disabled, children }) => (
    <ActionMenu
      label="Actions"
      title="Selected book actions"
      iconOnly={compact}
      disabled={disabled}
    >
      {children(() => {})}
    </ActionMenu>
  ),
  Item: ({ label, disabled, destructive, bookmark, onActivate }) => (
    <Menu.Item
      disabled={disabled}
      variant={destructive ? 'destructive' : undefined}
      onSelect={onActivate}
    >
      {bookmark && (
        <BookmarkSimple weight={bookmark === 'filled' ? 'fill' : 'regular'} aria-hidden="true" />
      )}
      {label}
    </Menu.Item>
  ),
  Separator: Menu.Separator,
  Notice: ({ children }) => <p className="basis-full text-sm text-muted-foreground">{children}</p>
};
