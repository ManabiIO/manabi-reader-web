/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { MouseEvent, ReactNode } from 'react';
import { Menu, Button } from './primitives';
import { CaretDown, List } from '@phosphor-icons/react';
import { goto } from '$app/navigation';
import { base } from '$app/paths';
export function ActionMenu({
  label,
  title,
  iconOnly,
  children
}: {
  label: string;
  title?: string;
  iconOnly?: boolean;
  children?: ReactNode;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        child={({ props }: { props: Record<string, any> }) => (
          <Button
            {...props}
            variant="outline"
            className={iconOnly ? 'size-[44px] min-h-[44px] rounded-full p-0' : 'min-h-9'}
            aria-label={title || label}
            title={title || label}
          >
            {!iconOnly && label}
            <CaretDown className={iconOnly ? 'size-[24px]' : 'size-3.5'} aria-hidden="true" />
          </Button>
        )}
      />
      <Menu.Content className="w-72">{children}</Menu.Content>
    </Menu.Root>
  );
}
/** Preserve the Library's original wrapping section links and native link gestures. */
export function LibraryTabs() {
  const navigate = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    void goto(event.currentTarget.href);
  };
  return (
    <nav aria-label="Library sections" className="media-library-tabs">
      <a href={`${base}/manage`} aria-current="page" onClick={navigate}>
        Books
      </a>
      <a href={`${base}/videos`} onClick={navigate}>
        Videos
      </a>
    </nav>
  );
}
export function AppNav() {
  return (
    <Menu.Root>
      <Menu.Trigger
        child={({ props }: { props: Record<string, any> }) => (
          <Button {...props} variant="ghost" aria-label="Navigation">
            <List size={24} />
          </Button>
        )}
      />
      <Menu.Content className="w-64">
        {[
          ['Library', '/manage'],
          ['Snippets', '/snippets'],
          ['Accounts and Libraries', '/connections'],
          ['Statistics', '/statistics'],
          ['Settings', '/settings'],
          ['Shared Libraries', '/shared-library']
        ].map(([name, path]) => (
          <Menu.Item key={path} onSelect={() => goto(path)}>
            {name}
          </Menu.Item>
        ))}
      </Menu.Content>
    </Menu.Root>
  );
}
