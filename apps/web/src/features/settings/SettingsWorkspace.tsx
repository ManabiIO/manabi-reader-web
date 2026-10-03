/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { ReactNode } from 'react';
import { settingCategories } from './categories';
import type { SettingsWorkspaceFilter } from './workspace-state';
import type { WorkspaceColors } from './workspace-layout';

type WorkspaceLayout = Pick<
  typeof import('./workspace-layout'),
  | 'WorkspaceFrame'
  | 'WorkspaceAside'
  | 'WorkspaceSearch'
  | 'WorkspaceNavigation'
  | 'WorkspaceCategory'
  | 'WorkspaceMain'
  | 'WorkspaceIntroduction'
>;
export interface SettingsWorkspaceProps {
  layout: WorkspaceLayout;
  filter: SettingsWorkspaceFilter;
  onSearch(query: string): void;
  onCategory(category: string, event?: unknown): void;
  rootRef?(value: unknown): void;
  resultText: string;
  saveDescription: string;
  colors?: WorkspaceColors;
  children?: ReactNode;
}
/** One category/search/content composition; leaves own only native controls or HTML semantics. */
export function SettingsWorkspace({
  layout,
  filter,
  onSearch,
  onCategory,
  rootRef,
  resultText,
  saveDescription,
  colors,
  children
}: SettingsWorkspaceProps) {
  const {
    WorkspaceFrame,
    WorkspaceAside,
    WorkspaceSearch,
    WorkspaceNavigation,
    WorkspaceCategory,
    WorkspaceMain,
    WorkspaceIntroduction
  } = layout;
  const selected =
    settingCategories.find((item) => item.id === filter.category) ?? settingCategories[0];
  return (
    <WorkspaceFrame rootRef={rootRef}>
      <WorkspaceAside>
        <WorkspaceSearch query={filter.query} onSearch={onSearch} colors={colors} />
        <WorkspaceNavigation>
          {settingCategories.map((item) => (
            <WorkspaceCategory
              key={item.id}
              id={item.id}
              label={item.label}
              selected={filter.category === item.id && !filter.query}
              onActivate={(event) => onCategory(item.id, event)}
              colors={colors}
            />
          ))}
        </WorkspaceNavigation>
      </WorkspaceAside>
      <WorkspaceMain>
        <WorkspaceIntroduction
          title={filter.query ? 'Search results' : selected.label}
          description={
            filter.query ? 'Results across every settings section.' : selected.description
          }
          saveDescription={saveDescription}
          resultText={filter.query ? resultText : undefined}
          colors={colors}
        />
        {children}
      </WorkspaceMain>
    </WorkspaceFrame>
  );
}
