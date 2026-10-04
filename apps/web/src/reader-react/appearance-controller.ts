/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { appearance$, resolvedMode$, theme$ } from '$lib/appearance/state';
import { type AppearanceMode } from '$lib/data/theme-option';
import { LocalFont } from '$lib/data/fonts';
import { effectivePrimaryReaderFont } from '$lib/data/reader-typography';
import {
  fontSize$,
  fontFamilyGroupOne$,
  lineHeight$,
  viewMode$,
  yuKyokashoAvailable$
} from '$lib/data/store';
import { ReaderController, type StoreValue } from './controller';
export interface AppearanceProps {
  open?: boolean;
  showLayout?: boolean;
  returnFocus?: HTMLElement | undefined;
  description?: string;
}

export function createAppearance(
  props: AppearanceProps,
  emit: (name: string, detail?: unknown) => void = () => {}
) {
  const __readerController = new ReaderController();
  let currentFont: string;
  let availableFonts: string[];
  let $fontFamilyGroupOne$: StoreValue<typeof fontFamilyGroupOne$> =
    __readerController.read(fontFamilyGroupOne$);
  let $yuKyokashoAvailable$: StoreValue<typeof yuKyokashoAvailable$> =
    __readerController.read(yuKyokashoAvailable$);
  let $fontSize$: StoreValue<typeof fontSize$> = __readerController.read(fontSize$);
  let $appearance$: StoreValue<typeof appearance$> = __readerController.read(appearance$);
  let $resolvedMode$: StoreValue<typeof resolvedMode$> = __readerController.read(resolvedMode$);
  let $theme$: StoreValue<typeof theme$> = __readerController.read(theme$);
  let $lineHeight$: StoreValue<typeof lineHeight$> = __readerController.read(lineHeight$);
  let $viewMode$: StoreValue<typeof viewMode$> = __readerController.read(viewMode$);
  let open = props.open !== undefined ? props.open : false;
  let showLayout = props.showLayout !== undefined ? props.showLayout : true;
  let returnFocus: HTMLElement | undefined =
    props.returnFocus !== undefined ? props.returnFocus : undefined;
  let description =
    props.description !== undefined
      ? props.description
      : 'Adjust text and appearance without leaving your book.';
  const dispatch = (name: string, detail?: unknown) => emit(name, detail);
  const modes: AppearanceMode[] = ['system', 'light', 'dark'];
  const themes = [
    'manabi-theme',
    'light-theme',
    'ecru-theme',
    'water-theme',
    'gray-theme',
    'dark-theme'
  ];
  const fonts = [
    LocalFont.KLEEONE,
    LocalFont.NOTOSERIFJP,
    LocalFont.KZUDMINCHO,
    LocalFont.SHIPPORIMINCHO,
    LocalFont.GENEI,
    LocalFont.SERIF
  ];
  __readerController.effect(
    () => [$fontFamilyGroupOne$, $yuKyokashoAvailable$],
    () => {
      __readerController.changed(
        (currentFont = effectivePrimaryReaderFont($fontFamilyGroupOne$, $yuKyokashoAvailable$))
      );
    }
  );
  __readerController.effect(
    () => [$yuKyokashoAvailable$, currentFont, fonts],
    () => {
      __readerController.changed(
        (availableFonts = [
          ...new Set([
            ...($yuKyokashoAvailable$ ? [LocalFont.YUKYOKASHO] : []),
            currentFont,
            ...fonts
          ])
        ])
      );
    }
  );
  function changeSize(delta: number) {
    fontSize$.next(Math.max(8, Math.min(72, $fontSize$ + delta)));
  }
  __readerController.observeSource(
    () => fontFamilyGroupOne$,
    (value) => {
      $fontFamilyGroupOne$ = value;
    }
  );
  __readerController.observeSource(
    () => yuKyokashoAvailable$,
    (value) => {
      $yuKyokashoAvailable$ = value;
    }
  );
  __readerController.observeSource(
    () => fontSize$,
    (value) => {
      $fontSize$ = value;
    }
  );
  __readerController.observeSource(
    () => appearance$,
    (value) => {
      $appearance$ = value;
    }
  );
  __readerController.observeSource(
    () => resolvedMode$,
    (value) => {
      $resolvedMode$ = value;
    }
  );
  __readerController.observeSource(
    () => theme$,
    (value) => {
      $theme$ = value;
    }
  );
  __readerController.observeSource(
    () => lineHeight$,
    (value) => {
      $lineHeight$ = value;
    }
  );
  __readerController.observeSource(
    () => viewMode$,
    (value) => {
      $viewMode$ = value;
    }
  );
  const api = {
    controller: __readerController,
    changeSize,
    get open() {
      return open;
    },
    set open(nextValue: typeof open) {
      if (Object.is(open, nextValue)) return;
      open = nextValue;
      __readerController.invalidate();
    },
    get showLayout() {
      return showLayout;
    },
    set showLayout(nextValue: typeof showLayout) {
      if (Object.is(showLayout, nextValue)) return;
      showLayout = nextValue;
      __readerController.invalidate();
    },
    get returnFocus() {
      return returnFocus;
    },
    set returnFocus(nextValue: typeof returnFocus) {
      if (Object.is(returnFocus, nextValue)) return;
      returnFocus = nextValue;
      __readerController.invalidate();
    },
    get description() {
      return description;
    },
    set description(nextValue: typeof description) {
      if (Object.is(description, nextValue)) return;
      description = nextValue;
      __readerController.invalidate();
    },
    get dispatch() {
      return dispatch;
    },
    get modes() {
      return modes;
    },
    get themes() {
      return themes;
    },
    get fonts() {
      return fonts;
    },
    get currentFont() {
      return currentFont;
    },
    set currentFont(nextValue: typeof currentFont) {
      if (Object.is(currentFont, nextValue)) return;
      currentFont = nextValue;
      __readerController.invalidate();
    },
    get availableFonts() {
      return availableFonts;
    },
    set availableFonts(nextValue: typeof availableFonts) {
      if (Object.is(availableFonts, nextValue)) return;
      availableFonts = nextValue;
      __readerController.invalidate();
    },
    get $fontFamilyGroupOne$() {
      return $fontFamilyGroupOne$;
    },
    get $yuKyokashoAvailable$() {
      return $yuKyokashoAvailable$;
    },
    get $fontSize$() {
      return $fontSize$;
    },
    get $appearance$() {
      return $appearance$;
    },
    get $resolvedMode$() {
      return $resolvedMode$;
    },
    get $theme$() {
      return $theme$;
    },
    get $lineHeight$() {
      return $lineHeight$;
    },
    get $viewMode$() {
      return $viewMode$;
    },
    updateProps(next: Record<string, unknown>) {
      if ('open' in next) api.open = next.open as typeof open;
      if ('showLayout' in next) api.showLayout = next.showLayout as typeof showLayout;
      if ('returnFocus' in next) api.returnFocus = next.returnFocus as typeof returnFocus;
      if ('description' in next) api.description = next.description as typeof description;
    }
  };
  return api;
}
