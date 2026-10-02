/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { ReactNode } from 'react';
import { Menu, Button } from './primitives';
import { DotsThree, List } from '@phosphor-icons/react';
import { goto } from '$app/navigation';
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
          <Button {...props} variant="outline" aria-label={label} title={title}>
            {iconOnly ? <DotsThree size={24} /> : label}
          </Button>
        )}
      />
      <Menu.Content className="w-72">{children}</Menu.Content>
    </Menu.Root>
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
