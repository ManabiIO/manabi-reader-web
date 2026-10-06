/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import React from 'react';
import { useReaderController } from '../reader-react/controller';
import {
  Dom,
  Button,
  Switch,
  useLatest,
  useReaderBindings,
  slotContent,
  type ReaderViewProps
} from './primitives';
import { SettingsContext, useSettingsContext } from './context';
import {
  createButtonToggleGroup,
  type ButtonToggleGroupProps
} from './button-toggle-group-controller';

import { availableThemes } from '$lib/data/theme-option';
export function ButtonToggleGroup(
  props: Partial<ButtonToggleGroupProps> &
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
      createButtonToggleGroup(
        props as ButtonToggleGroupProps,
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
      <div className="react-settings-button-toggle-group" style={{ display: 'contents' }}>
        {c.isBoolean ? (
          <>
            <Dom as="div" className={['flex min-h-9 items-center gap-3'].filter(Boolean).join(' ')}>
              <Switch
                aria-label={c.fieldName()}
                checked={c.selectedOptionId === true}
                onCheckedChange={(value) => c.controller.changed((c.selectedOptionId = value))}
              ></Switch>
              <Dom
                as="span"
                className={['text-sm text-muted-foreground'].filter(Boolean).join(' ')}
              >
                {c.selectedOptionId ? 'On' : 'Off'}
              </Dom>
            </Dom>
          </>
        ) : (
          <>
            {' '}
            <Dom
              as="div"
              role={'group'}
              aria-label={c.fieldName()}
              className={['flex flex-wrap gap-2', c.invertColors && 'legacy-invert']
                .filter(Boolean)
                .join(' ')}
            >
              {(c.options ?? []).map((option, _index0) => (
                <React.Fragment key={option.id}>
                  <Dom
                    as="div"
                    className={['flex flex-wrap items-center gap-1'].filter(Boolean).join(' ')}
                  >
                    <Button
                      title={String(option.id)}
                      variant={option.id === c.selectedOptionId ? 'secondary' : 'outline'}
                      aria-pressed={option.id === c.selectedOptionId}
                      styleText={c.styles(option.style)}
                      onClick={() => c.controller.changed((c.selectedOptionId = option.id))}
                      className={[
                        option.id === c.selectedOptionId
                          ? 'border-2 border-primary'
                          : 'border-border'
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {option.text}
                    </Button>
                    {option.showIcons &&
                    option.id === c.selectedOptionId &&
                    !availableThemes.has(option.id) ? (
                      <>
                        <Button
                          variant={'ghost'}
                          aria-label={`Edit ${option.text} theme`}
                          onClick={() => c.dispatch('edit', option.id)}
                        >
                          {'Edit'}
                        </Button>
                        <Button
                          variant={'ghost'}
                          aria-label={`Delete ${option.text} theme`}
                          onClick={() => c.dispatch('delete', option.id)}
                        >
                          {'Delete'}
                        </Button>
                      </>
                    ) : null}
                  </Dom>
                </React.Fragment>
              ))}
              {slotContent(props.children, undefined)}
            </Dom>
          </>
        )}
      </div>
    </SettingsContext.Provider>
  );
}
