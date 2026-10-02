/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useEffect } from 'react';
import { useStore } from './use-store';
import { base } from './paths';
import { retireImportBootstrapOutsideRoute } from './import-bootstrap';
import { refreshAccount } from '$lib/manabi/client';
import { startPreferenceSync } from '$lib/manabi/preferences';
import { startBookSync, bookSyncStatus } from '$lib/manabi/books';
import { personalSyncStatus } from '$lib/manabi/personal-sync';
import { startSnippets } from '$lib/snippets/service';
import { derived } from '$lib/state/store';
import { page } from './stores';
import { isSnippetLibraryPath } from '$lib/snippets/discovery';
import {
  appearance$,
  resolvedMode$,
  startAppearanceSync,
  libraryBackgroundOptions$,
  readerBackgroundOptions$
} from '$lib/appearance/state';
import { backgrounds, startBackgrounds } from '$lib/appearance/backgrounds';
import {
  theme$,
  customThemes$,
  userFonts$,
  yuKyokashoAvailable$,
  fontFamilyGroupOne$,
  isOnline$
} from '$lib/data/store';
import { availableThemes, themeProperties } from '$lib/data/theme-option';
import {
  detectYuKyokashoAvailability,
  LEGACY_SYSTEM_JAPANESE,
  YU_KYOKASHO
} from '$lib/data/reader-typography';
import { userFontsCacheName } from '$lib/data/fonts';
import { buildLocalFontStyleSheet } from '$lib/functions/book-security/local-media';
import { DialogHost } from '../ui/dialogs';
import { bundledFontCSS } from './font-assets';
import { SnippetCapture } from '../snippets-react';

export function BrowserRuntime({ embedded = false }: { embedded?: boolean }) {
  const appearance = useStore(appearance$);
  const mode = useStore(resolvedMode$);
  const theme = useStore(theme$);
  const custom = useStore(customThemes$);
  const fonts = useStore(userFonts$);
  const sets = useStore(backgrounds);
  const libraryOptions = useStore(libraryBackgroundOptions$);
  const readerOptions = useStore(readerBackgroundOptions$);
  const location = useStore(page);
  useEffect(retireImportBootstrapOutsideRoute, [location.url.pathname]);
  const personal = useStore(personalSyncStatus);
  const books = useStore(bookSyncStatus);
  useEffect(() => {
    const fontStyle = document.createElement('style');
    fontStyle.id = 'manabi-packaged-fonts';
    fontStyle.textContent = bundledFontCSS;
    document.head.append(fontStyle);
    if (fontFamilyGroupOne$.getValue() === LEGACY_SYSTEM_JAPANESE)
      fontFamilyGroupOne$.next(YU_KYOKASHO);
    let active = true;
    void detectYuKyokashoAvailability().then((value) => {
      if (active) yuKyokashoAvailable$.next(value);
    });
    const stops = [
      startAppearanceSync(),
      startBackgrounds(),
      startPreferenceSync(),
      startBookSync(),
      startSnippets(derived(page, (current) => isSnippetLibraryPath(current.url.pathname, base)))
    ];
    let lastRefresh = 0;
    const refresh = (force = false) => {
      const now = Date.now();
      if (!force && now - lastRefresh < 30000) return;
      lastRefresh = now;
      void refreshAccount(force);
    };
    const online = () => {
      isOnline$.next(navigator.onLine);
      refresh(true);
    };
    const offline = () => isOnline$.next(false);
    const focus = () => refresh();
    refresh();
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    window.addEventListener('focus', focus);
    if (!embedded && 'serviceWorker' in navigator && process.env.NODE_ENV === 'production')
      void navigator.serviceWorker
        .register(`${base}/service-worker.js`, { scope: `${base}/` })
        .catch((error) => console.warn('Offline shell could not be registered', error));
    return () => {
      fontStyle.remove();
      active = false;
      stops.forEach((stop) => stop());
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      window.removeEventListener('focus', focus);
    };
  }, [embedded]);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.appearance = appearance;
    root.dataset.theme = availableThemes.has(theme) ? theme : 'custom';
    for (const m of ['light', 'dark'] as const)
      for (const [key, value] of Object.entries(themeProperties(theme, m, custom ?? {})))
        root.style.setProperty(`--${m}-${key}`, value);
    document
      .querySelector('meta[name="color-scheme"]')
      ?.setAttribute('content', appearance === 'system' ? 'light dark' : appearance);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', themeProperties(theme, mode, custom ?? {}).background);
  }, [appearance, mode, theme, custom]);
  useEffect(() => {
    const css = buildLocalFontStyleSheet(fonts);
    let style = document.getElementById(userFontsCacheName);
    if (!css) {
      style?.remove();
      return;
    }
    if (!style) {
      style = document.createElement('style');
      style.id = userFontsCacheName;
      document.head.append(style);
    }
    style.textContent = css;
  }, [fonts]);
  const path = location.url.pathname.slice(base.length).replace(/\/$/, '');
  const target = path === '/manage' ? 'library' : path === '/b' ? 'reader' : undefined;
  const background = target ? sets[target]?.[mode] : undefined;
  const options = target === 'reader' ? readerOptions : libraryOptions;
  const attention =
    ['conflict', 'legacy_statistics'].includes(personal.state) ||
    Object.values(books).some((status) =>
      ['conflict', 'needs_reconnect', 'permission_required', 'unauthorized'].includes(status.state)
    );
  return (
    <>
      {background?.url && (
        <div
          className="page-background"
          data-background={target}
          data-background-mode={mode}
          style={
            {
              backgroundImage: `url("${background.url}")`,
              '--background-fade': options.fade ? options.amount / 100 : 0
            } as React.CSSProperties
          }
          aria-hidden="true"
        />
      )}
      {attention && path !== '/connections' && (
        <aside
          role="status"
          className="fixed right-4 bottom-14 z-30 max-w-sm rounded-lg border bg-card p-3"
        >
          <a href={`${base}/connections`}>
            Reading sync needs attention. Your local reading data is safe.
          </a>
        </aside>
      )}
      <SnippetCapture />
      <DialogHost />
    </>
  );
}
