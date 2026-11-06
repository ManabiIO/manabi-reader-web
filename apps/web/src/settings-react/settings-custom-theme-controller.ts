/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { ToggleOption } from '$lib/components/button-toggle-group/toggle-option';
import { customThemes$, theme$ } from '$lib/data/store';
import { themeForMode, type ThemeOption } from '$lib/data/theme-option';
import { resolvedMode$ } from '$lib/appearance/state';
import { ReaderController, writeStore } from '../reader-react/controller';
import { themeCopyOptions, themeNameError } from '../features/settings/theme-editor';

export interface SettingsCustomThemeProps {
  selectedTheme?: string;
  existingThemes?: ToggleOption<string>[];
}

/** Browser owner adapter only. The shared editor owns draft and presentation. */
export function createSettingsCustomTheme(props: SettingsCustomThemeProps) {
  const controller = new ReaderController();
  let custom = controller.read(customThemes$);
  let mode = controller.read(resolvedMode$);
  const activeTheme = controller.read(theme$);
  const previousName = props.selectedTheme ?? '';
  let existingThemes = props.existingThemes ?? [];
  const initialPalette = Object.hasOwn(custom, previousName)
    ? custom[previousName]
    : themeForMode(activeTheme, mode, custom);
  controller.observeSource(
    () => customThemes$,
    (value) => {
      custom = value;
    }
  );
  controller.observeSource(
    () => resolvedMode$,
    (value) => {
      mode = value;
    }
  );
  return {
    controller,
    initialPalette,
    activeTheme,
    previousName,
    get existingNames() {
      return Object.keys(custom);
    },
    get options() {
      return themeCopyOptions(existingThemes, mode, custom);
    },
    save(name: string, palette: ThemeOption): boolean | string {
      // Recheck the live catalog at the write boundary, not just the rendered draft.
      const error = themeNameError(name, previousName, Object.keys(custom));
      if (error) return error;
      const themes = { ...custom, [name]: palette };
      if (previousName && previousName !== name) delete themes[previousName];
      writeStore(customThemes$, themes);
      writeStore(theme$, name);
      return true;
    },
    updateProps(next: Record<string, unknown>) {
      if (next.existingThemes !== undefined) {
        existingThemes = next.existingThemes as ToggleOption<string>[];
        controller.invalidate();
      }
    }
  };
}
