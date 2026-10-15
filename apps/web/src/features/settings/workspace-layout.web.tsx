/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { ReactNode } from 'react';
import { Dom, Button, Input } from '../../settings-react/primitives';
import type {
  WorkspaceFrameProps,
  WorkspaceSearchProps,
  WorkspaceCategoryProps,
  WorkspaceIntroductionProps
} from './workspace-layout';
export function WorkspaceFrame({ children, rootRef }: WorkspaceFrameProps) {
  return (
    <Dom
      as="div"
      elementRef={rootRef}
      className="settings-workspace grid min-w-0 grid-cols-1 gap-6 md:grid-cols-[14rem_minmax(0,1fr)]"
    >
      {children}
    </Dom>
  );
}
export function WorkspaceAside({ children }: { children?: ReactNode }) {
  return (
    <aside aria-label="Settings sections" className="min-w-0 self-start md:sticky md:top-20">
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
    <nav
      aria-label="Settings categories"
      className="section-navigation section-navigation-sidebar mt-3"
    >
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
