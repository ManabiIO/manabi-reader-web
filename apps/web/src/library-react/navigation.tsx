/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useId, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Menu, Button, CloseButton, Dialog } from './primitives';
import {
  BookOpen,
  BookOpenText,
  CaretDown,
  ChartBar,
  Cloud,
  FileArrowUp,
  FolderOpen,
  Gear,
  List
} from '@phosphor-icons/react';
import { goto } from '$app/navigation';
import { base, resolve } from '$app/paths';
import { page } from '$app/stores';
import { useStore } from '$runtime/use-store';
import { USER_GUIDE_URL } from '$lib/components/navigation/docs-link';
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
const primaryDestinations = destinations.slice(0, 4);

/** Shared, responsive site navigation. Native links retain modified-click gestures. */
export function AppNav({
  iconOnly = false,
  compact = false
}: {
  iconOnly?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLElement>(null);
  const dialogId = useId();
  const pathname = useStore(page).url.pathname;
  const navigate = (event: MouseEvent<HTMLAnchorElement>) => {
    setOpen(false);
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
    <div
      className={['app-navigation', compact && 'app-navigation-compact'].filter(Boolean).join(' ')}
    >
      {!iconOnly && (
        <nav aria-label="Primary navigation" className="app-navigation-primary">
          {primaryDestinations.map((destination) => (
            <Button
              key={destination.path}
              href={resolve(destination.path)}
              variant="ghost"
              size="sm"
              shape="rounded"
              aria-current={pathname === base + destination.path ? 'page' : undefined}
            >
              {destination.label}
            </Button>
          ))}
        </nav>
      )}
      <Button
        ref={trigger}
        data-navigation-trigger=""
        data-icon-only={iconOnly || undefined}
        variant="ghost"
        size={iconOnly ? 'icon' : 'default'}
        aria-label={iconOnly ? 'Main menu' : 'Navigate'}
        title={iconOnly ? 'Main menu' : undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        onClick={() => setOpen(true)}
      >
        <List aria-hidden="true" />
        {!iconOnly && <span className="navigation-label">Navigate</span>}
      </Button>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Content
          id={dialogId}
          role="dialog"
          aria-modal="true"
          data-side={iconOnly ? 'left' : 'right'}
          className="app-navigation-sheet"
          showCloseButton={false}
          onOpenAutoFocus={(event: { preventDefault(): void }) => {
            event.preventDefault();
            document
              .getElementById(dialogId)
              ?.querySelector<HTMLButtonElement>('.app-navigation-close')
              ?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={(event: { preventDefault(): void }) => {
            if (!trigger.current?.isConnected) return;
            event.preventDefault();
            trigger.current.focus({ preventScroll: true });
          }}
        >
          <CloseButton className="app-navigation-close" onClick={() => setOpen(false)} />
          <Dialog.Header className="app-navigation-header">
            <Dialog.Title>Manabi Reader</Dialog.Title>
            <Dialog.Description>Your books. Your reading space.</Dialog.Description>
          </Dialog.Header>
          <nav aria-label="Main navigation" className="app-navigation-destinations">
            {destinations.map((destination) => (
              <a
                key={destination.path}
                href={resolve(destination.path)}
                aria-label={destination.label}
                aria-current={pathname === base + destination.path ? 'page' : undefined}
                onClick={navigate}
              >
                <destination.icon aria-hidden="true" />
                <span>
                  <span className="app-navigation-label">{destination.label}</span>
                  <span className="app-navigation-detail">{destination.detail}</span>
                </span>
              </a>
            ))}
            <div className="app-navigation-separator" role="separator" />
            <a
              href={USER_GUIDE_URL}
              aria-label="User guide"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
            >
              <BookOpenText aria-hidden="true" />
              <span>
                <span className="app-navigation-label">User guide</span>
                <span className="app-navigation-detail">Reading, libraries, and data</span>
              </span>
            </a>
          </nav>
        </Dialog.Content>
      </Dialog.Root>
    </div>
  );
}
