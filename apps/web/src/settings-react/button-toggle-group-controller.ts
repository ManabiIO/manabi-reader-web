/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { SETTINGS_FIELD } from '$lib/components/settings/settings-context';
import type { ToggleOption } from '../lib/components/button-toggle-group/toggle-option';

import { ReaderController } from '../reader-react/controller';
import { type SettingsContextValue } from './context';

export interface ButtonToggleGroupProps {
  options: ToggleOption<any>[];
  selectedOptionId: any;
  invertColors?: boolean;
}

export function createButtonToggleGroup(
  props: ButtonToggleGroupProps,
  emit: (name: string, detail?: unknown) => void = () => {},
  componentContext: SettingsContextValue
) {
  const __readerController = new ReaderController();
  let isBoolean: any;

  let options: ToggleOption<any>[] = props.options;
  let selectedOptionId: any = props.selectedOptionId;
  let invertColors = props.invertColors !== undefined ? props.invertColors : false;
  const fieldName = componentContext.getContext<() => string>(SETTINGS_FIELD) ?? (() => 'Option');
  const dispatch = (name: string, detail?: unknown) => emit(name, detail);
  __readerController.effect(
    () => [options],
    () => {
      __readerController.changed(
        (isBoolean =
          options.length === 2 &&
          options.some((o) => o.id === true) &&
          options.some((o) => o.id === false))
      );
    }
  );
  function styles(style: Record<string, any> | undefined) {
    return style
      ? Object.entries(style)
          .map(([key, value]) => `${key}: ${value}`)
          .join(';')
      : '';
  }

  const api = {
    controller: __readerController,
    styles,
    get options() {
      return options;
    },
    set options(nextValue: typeof options) {
      if (Object.is(options, nextValue)) return;
      options = nextValue;
      __readerController.invalidate();
    },
    get selectedOptionId() {
      return selectedOptionId;
    },
    set selectedOptionId(nextValue: typeof selectedOptionId) {
      if (Object.is(selectedOptionId, nextValue)) return;
      selectedOptionId = nextValue;
      __readerController.invalidate();
    },
    get invertColors() {
      return invertColors;
    },
    set invertColors(nextValue: typeof invertColors) {
      if (Object.is(invertColors, nextValue)) return;
      invertColors = nextValue;
      __readerController.invalidate();
    },
    get fieldName() {
      return fieldName;
    },
    get dispatch() {
      return dispatch;
    },
    get isBoolean() {
      return isBoolean;
    },
    set isBoolean(nextValue: typeof isBoolean) {
      if (Object.is(isBoolean, nextValue)) return;
      isBoolean = nextValue;
      __readerController.invalidate();
    },
    updateProps(next: Record<string, unknown>) {
      if ('options' in next) api.options = next.options as typeof options;
      if ('selectedOptionId' in next)
        api.selectedOptionId = next.selectedOptionId as typeof selectedOptionId;
      if ('invertColors' in next && next.invertColors !== undefined)
        api.invertColors = next.invertColors as typeof invertColors;
    }
  };
  return api;
}
