/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { afterNavigate, goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { writable } from '$lib/state/store';
import { SETTINGS_FILTER } from '../lib/components/settings/settings-context';
import {
  ReaderController,
  readerTick,
  writeStore,
  type StoreValue
} from '../reader-react/controller';
import { type SettingsContextValue } from './context';

export type SettingsWorkspaceProps = Record<string, unknown>;

export function createSettingsWorkspace(
  props: SettingsWorkspaceProps,
  _emit: (name: string, detail?: unknown) => void = () => {},
  componentContext: SettingsContextValue
) {
  const __readerController = new ReaderController();
  let selected: any;
  let $filter: StoreValue<typeof filter> = undefined as never;
  const categories = [
    {
      id: 'appearance',
      label: 'Appearance',
      description: 'Theme, light and dark mode, and background images'
    },
    {
      id: 'typography',
      label: 'Fonts & text',
      description: 'Typography, spacing, and Japanese font options'
    },
    {
      id: 'layout',
      label: 'Page layout',
      description: 'Writing direction, pagination, and margins'
    },
    {
      id: 'reading',
      label: 'Reading controls',
      description: 'Bookmarks, navigation, furigana, and images'
    },
    {
      id: 'library',
      label: 'Library & sync',
      description: 'Storage sources, import, export, and backups'
    },
    {
      id: 'tracking',
      label: 'Tracking & goals',
      description: 'Reading statistics, session behavior, and goals'
    },
    {
      id: 'all',
      label: 'All settings',
      description: 'Every available setting, grouped in one place'
    }
  ];
  const initialCategory = typeof location === 'undefined' ? '' : location.hash.slice(1);
  const filter = writable({
    category: categories.some((item) => item.id === initialCategory)
      ? initialCategory
      : 'appearance',
    query: ''
  });
  componentContext.setContext(SETTINGS_FILTER, filter);
  let root: HTMLElement | null = null;
  let visibleCount = 0;
  __readerController.effect(
    () => [categories, $filter],
    () => {
      __readerController.changed(
        (selected =
          categories.find((category) => category.id === $filter.category) ?? categories[0])
      );
    }
  );
  __readerController.onDestroy(
    afterNavigate(({ to }) => {
      const category = to?.url.hash.slice(1);
      filter.set({
        category:
          category && categories.some((item) => item.id === category) ? category : 'appearance',
        query: ''
      });
    })
  );
  __readerController.onMount(() => {
    const restoreCategory = () => {
      const category = window.location.hash.slice(1);
      filter.set({
        category: categories.some((item) => item.id === category) ? category : 'appearance',
        query: ''
      });
    };
    window.addEventListener('popstate', restoreCategory);
    window.addEventListener('hashchange', restoreCategory);
    const countVisibleSettings = () => {
      if (root?.isConnected)
        __readerController.changed(
          (visibleCount = root.querySelectorAll('[data-setting]:not([hidden])').length)
        );
    };
    const stop = filter.subscribe(() => {
      void readerTick().then(countVisibleSettings);
    });
    // Enabling tracking or changing writing mode mounts conditional fields even
    // when the search hasn't changed. Count those real fields, not stale results.
    const observer = new MutationObserver(countVisibleSettings);
    if (root)
      observer.observe(root, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['hidden']
      });
    countVisibleSettings();
    return () => {
      window.removeEventListener('popstate', restoreCategory);
      window.removeEventListener('hashchange', restoreCategory);
      stop();
      observer.disconnect();
    };
  });
  function choose(category: string) {
    filter.set({ category, query: '' });
    if (typeof window === 'undefined' || window.location.hash === `#${category}`) return;
    void goto(resolve(`/settings#${category}`), {
      keepFocus: true,
      noScroll: true
    });
  }
  function handleCategoryClick(
    event: Pick<
      MouseEvent,
      'button' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'preventDefault'
    >,
    category: string
  ) {
    if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
      return;
    event.preventDefault();
    choose(category);
  }
  $filter = __readerController.read(filter);
  __readerController.observeSource(
    () => filter,
    (value) => {
      $filter = value;
    }
  );
  const api = {
    controller: __readerController,
    choose,
    handleCategoryClick,
    get categories() {
      return categories;
    },
    get filter() {
      return filter;
    },
    get root() {
      return root;
    },
    set root(nextValue: typeof root) {
      if (Object.is(root, nextValue)) return;
      root = nextValue;
      __readerController.invalidate();
    },
    get visibleCount() {
      return visibleCount;
    },
    set visibleCount(nextValue: typeof visibleCount) {
      if (Object.is(visibleCount, nextValue)) return;
      visibleCount = nextValue;
      __readerController.invalidate();
    },
    get selected() {
      return selected;
    },
    set selected(nextValue: typeof selected) {
      if (Object.is(selected, nextValue)) return;
      selected = nextValue;
      __readerController.invalidate();
    },
    get $filter() {
      return $filter;
    },
    set $filter(nextValue: typeof $filter) {
      writeStore(filter, nextValue);
    },
    updateProps(_next: Record<string, unknown>) {}
  };
  return api;
}
