/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Dom, Button, Input } from '../../settings-react/primitives';
import type {
  WorkspaceFrameProps,
  WorkspaceSearchProps,
  WorkspaceCategoryProps,
  WorkspaceIntroductionProps
} from './workspace-layout';
import {
  SettingsGeometryContext,
  settingsWorkspaceGeometry,
  useSettingsGeometry
} from './workspace-geometry';
export function WorkspaceFrame({ children, rootRef }: WorkspaceFrameProps) {
  const root = useRef<HTMLElement | null>(null);
  const rem = useRef<HTMLSpanElement | null>(null);
  const [geometry, setGeometry] = useState(() => settingsWorkspaceGeometry(0, 1));
  useLayoutEffect(() => {
    const node = root.current;
    const probe = rem.current;
    if (!node || !probe) return;
    const measure = () => {
      const next = settingsWorkspaceGeometry(
        node.clientWidth,
        probe.getBoundingClientRect().width / 16
      );
      setGeometry((previous) =>
        previous.sidebar === next.sidebar && previous.gap === next.gap ? previous : next
      );
    };
    measure();
    // Observing a rem-sized element also catches text-only zoom without a
    // window resize, including stylesheet changes to the root font size.
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    observer.observe(probe);
    return () => observer.disconnect();
  }, []);
  return (
    <SettingsGeometryContext.Provider value={geometry}>
      <Dom
        as="div"
        elementRef={(value: HTMLElement | null) => {
          root.current = value;
          rootRef?.(value);
        }}
        data-settings-layout={geometry.sidebar ? 'sidebar' : 'compact'}
        className="settings-workspace relative grid min-w-0"
        style={{
          gridTemplateColumns: geometry.sidebar
            ? `${geometry.sidebarWidth}px minmax(0,1fr)`
            : 'minmax(0,1fr)',
          gap: geometry.gap
        }}
      >
        <span
          ref={rem}
          aria-hidden="true"
          style={{
            position: 'absolute',
            width: '1rem',
            height: 0,
            visibility: 'hidden',
            pointerEvents: 'none'
          }}
        />
        {children}
      </Dom>
    </SettingsGeometryContext.Provider>
  );
}
export function WorkspaceAside({ children }: { children?: ReactNode }) {
  const { sidebar } = useSettingsGeometry();
  return (
    <aside
      aria-label="Settings sections"
      className="min-w-0 self-start"
      style={sidebar ? { position: 'sticky', top: '5rem' } : undefined}
    >
      {children}
    </aside>
  );
}
export function WorkspaceSearch({ query, onSearch }: WorkspaceSearchProps) {
  return (
    <>
      <label htmlFor="settings-search" className="mb-2 block text-sm font-medium">
        Search settings
      </label>
      <Input
        id="settings-search"
        aria-describedby={query ? 'settings-search-results' : undefined}
        type="search"
        placeholder="Search all settings…"
        value={query}
        onInput={(event: React.FormEvent<HTMLInputElement>) => onSearch(event.currentTarget.value)}
      />
    </>
  );
}
export function WorkspaceNavigation({ children }: { children?: ReactNode }) {
  return (
    <nav aria-label="Settings categories" className="section-navigation mt-3">
      {children}
    </nav>
  );
}
export function WorkspaceCategory({ id, label, selected, onActivate }: WorkspaceCategoryProps) {
  return (
    <Button
      href={`#${id}`}
      variant="ghost"
      shape="rounded"
      data-section-link={true}
      aria-current={selected ? 'page' : undefined}
      onClick={onActivate}
      className="justify-start"
    >
      {label}
    </Button>
  );
}
export function WorkspaceMain({ children }: { children?: ReactNode }) {
  return (
    <main id="settings-content" className="min-w-0">
      {children}
    </main>
  );
}
export function WorkspaceIntroduction({
  title,
  description,
  saveDescription,
  resultText
}: WorkspaceIntroductionProps) {
  return (
    <div className="mb-5">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      <p className="mt-2 text-xs text-muted-foreground">{saveDescription}</p>
      {resultText !== undefined ? (
        <p
          id="settings-search-results"
          role="status"
          aria-label="Settings search results"
          className="mt-3 text-sm"
        >
          {resultText}
        </p>
      ) : null}
    </div>
  );
}
