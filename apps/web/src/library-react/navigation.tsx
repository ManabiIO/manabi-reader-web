/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { type MouseEvent, type ReactNode } from 'react';
import { Menu, Button } from './primitives';
import {
  BookOpen,
  BookOpenText,
  CaretDown,
  ChartBar,
  Cloud,
  FileArrowUp,
  FolderOpen,
  Gear,
  DotsThree
} from '@phosphor-icons/react';
import { goto } from '$app/navigation';
import { base, resolve } from '$app/paths';
import { page } from '$app/stores';
import { useStore } from '$runtime/use-store';
import { USER_GUIDE_URL } from '$lib/components/navigation/docs-link';
import { contextualDestinations } from '../shared-ui/navigation-context';
import './navigation.css';
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
const destinations = [
  {
    path: '/manage',
    label: 'Library',
    icon: BookOpen,
    detail: 'Books and snippets across your connected storage'
  },
  {
    path: '/snippets',
    label: 'Snippets',
    icon: BookOpenText,
    detail: 'Read, edit, and collect short texts'
  },
  {
    path: '/statistics',
    label: 'Statistics',
    icon: ChartBar,
    detail: 'Reading time, characters, and activity'
  },
  {
    path: '/settings',
    label: 'Settings',
    icon: Gear,
    detail: 'Appearance, reading, data, and goals'
  },
  {
    path: '/connections',
    label: 'Accounts and libraries',
    icon: Cloud,
    detail: 'Manabi account, cloud drives, and local folders'
  },
  {
    path: '/shared-library',
    label: 'Shared libraries',
    icon: FolderOpen,
    detail: 'Manage shared local-folder libraries'
  },
  {
    path: '/import-ttu',
    label: 'Import from Ttu Ebook Reader',
    icon: FileArrowUp,
    detail: 'Bring books, bookmarks, and reading data'
  }
] as const;
/** Contextual overflow belongs to this screen, not a duplicate set of global tabs. */
export function AppNav({
  iconOnly = false,
  compact = false
}: {
  iconOnly?: boolean;
  compact?: boolean;
}) {
  const pathname = useStore(page).url.pathname;
  const path = pathname.startsWith(base + '/') ? pathname.slice(base.length) : pathname;
  const allowed = contextualDestinations(path);
  const screenTitle = destinations.find((item) => item.path === path)?.label ?? 'Page';
  return (
    <div
      className={['app-navigation', compact && 'app-navigation-compact'].filter(Boolean).join(' ')}
    >
      <Menu.Root>
        <Menu.Trigger
          child={({ props }: { props: Record<string, any> }) => (
            <Button
              {...props}
              data-navigation-trigger=""
              data-icon-only="true"
              variant="ghost"
              size="icon-lg"
              shape="rounded"
              aria-label={iconOnly ? 'Main menu' : `${screenTitle} actions`}
              title="More actions"
            >
              <DotsThree size={24} weight="bold" aria-hidden="true" />
            </Button>
          )}
        />
        <Menu.Content aria-label="Page actions" className="app-context-menu w-72">
          {destinations
            .filter((item) => allowed.some((next) => next.path === item.path))
            .map((item) => (
              <Menu.Link key={item.path} href={resolve(item.path)} aria-label={item.label}>
                <item.icon aria-hidden="true" />
                {item.label}
              </Menu.Link>
            ))}
          {!!allowed.length && <Menu.Separator />}
          <Menu.Link
            href={USER_GUIDE_URL}
            aria-label="User guide"
            target="_blank"
            rel="noopener noreferrer"
          >
            <BookOpenText aria-hidden="true" />
            User guide
          </Menu.Link>
        </Menu.Content>
      </Menu.Root>
    </div>
  );
}
