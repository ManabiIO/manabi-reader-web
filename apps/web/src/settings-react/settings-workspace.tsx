/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import React from 'react';
import { useReaderController } from '../reader-react/controller';
import { useLatest, useReaderBindings, slotContent, type ReaderViewProps } from './primitives';
import { SettingsContext, useSettingsContext } from './context';
import {
  createSettingsWorkspace,
  type SettingsWorkspaceProps
} from './settings-workspace-controller';

import { SettingsOfflineStatus } from './settings-offline-status';
import { SettingsItemGroup } from './settings-item-group';
import { PageTurnEffectSelect } from './page-turn-effect-select';
import { SettingsWorkspace as SharedSettingsWorkspace } from '../features/settings/SettingsWorkspace';
import * as workspaceLayout from '../features/settings/workspace-layout.web';

export function SettingsWorkspace(
  props: Partial<SettingsWorkspaceProps> &
    ReaderViewProps & {
      children?: React.ReactNode;
      onClose?: () => void;
      slot?: string;
    }
) {
  const latest = useLatest(props);
  const context = useSettingsContext();
  const c = useReaderController(
    () =>
      createSettingsWorkspace(
        props as SettingsWorkspaceProps,
        (name, detail) => {
          latest.current.events?.[name]?.({ detail });
          if (name === 'close') latest.current.onClose?.();
        },
        context
      ),
    props
  );
  useReaderBindings(c, props);
  if (!c) return null;
  return (
    <SettingsContext.Provider value={context}>
      <div className="react-settings-settings-workspace" style={{ display: 'contents' }}>
        <SharedSettingsWorkspace
          layout={workspaceLayout}
          filter={c.$filter}
          rootRef={(value) => c.controller.changed((c.root = value as HTMLElement | null))}
          onSearch={(query) => c.filter.update((value) => ({ ...value, query }))}
          onCategory={(category, event) =>
            c.handleCategoryClick(event as Parameters<typeof c.handleCategoryClick>[0], category)
          }
          saveDescription=" Changes save automatically. Reading goals have separate Save and Cancel actions. "
          resultText={
            c.visibleCount
              ? `${c.visibleCount} matching settings`
              : 'No matching settings. Try a different search.'
          }
        >
          <SettingsOfflineStatus></SettingsOfflineStatus>
          <SettingsItemGroup
            settingId={'page-turn-effect'}
            category={'layout'}
            keywords={'pageTurnEffect slide none animation pagination'}
            title={'Page turn effect'}
            showHeading={false}
          >
            <PageTurnEffectSelect></PageTurnEffectSelect>
          </SettingsItemGroup>
          {slotContent(props.children, undefined)}
        </SharedSettingsWorkspace>
      </div>
    </SettingsContext.Provider>
  );
}
