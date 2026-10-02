/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import React from 'react';
import { useReaderController } from '../reader-react/controller';
import {
  Dom,
  AppIcon,
  Button,
  Input,
  useLatest,
  useReaderBindings,
  type ReaderViewProps
} from './primitives';
import { SettingsContext, useSettingsContext } from './context';
import { createSettingsContent, type SettingsContentProps } from './settings-content-controller';
import { browser } from '$app/environment';

import { TrackerAutoPause } from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker';
import { optionsForToggle } from '$lib/components/button-toggle-group/toggle-option';
import { inputClasses } from '$lib/css-classes';

import { dialogManager } from '$lib/data/dialog-manager';
import { LocalFont } from '$lib/data/fonts';
import { effectivePrimaryReaderFont } from '$lib/data/reader-typography';

import { ImportHTMLFixMode } from '$lib/data/import-html-fix-mode';

import {
  database,
  fontFamilyGroupOne$,
  fontFamilyGroupTwo$,
  horizontalCustomReadingPosition$,
  verticalCustomReadingPosition$
} from '$lib/data/store';

import { ViewMode } from '$lib/data/view-mode';

import {
  MAX_TRACKER_IDLE_MINUTES,
  trackerIdleSecondsFromMinutes
} from '$lib/components/settings/settings-number-policy';

import { MessageDialog } from '../ui/dialogs';
import { SettingsItemGroup } from './settings-item-group';
import { AppearanceSettings } from './appearance-settings';
import { ButtonToggleGroup } from './button-toggle-group';
import { SettingsFontSelector } from './settings-font-selector';
import { SettingsDimensionPopover } from './settings-dimension-popover';
import { SettingsStorageSourceList } from './settings-storage-source-list';
import { SettingsReadingGoals } from './settings-reading-goals';
import { SettingsCustomTheme } from './settings-custom-theme';
import { SettingsUserFontDialog } from './settings-user-font-dialog';
const faSpinner = 'faSpinner';
export function SettingsContent(
  props: Partial<SettingsContentProps> &
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
      createSettingsContent(
        props as SettingsContentProps,
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
      <div className="react-settings-settings-content" style={{ display: 'contents' }}>
        <Dom
          as="div"
          className={['settings-grid grid grid-cols-1 items-start gap-4 xl:grid-cols-2']
            .filter(Boolean)
            .join(' ')}
        >
          {c.activeSettings === 'Reader' || c.activeSettings === 'All' ? (
            <>
              <SettingsItemGroup
                title={'Appearance'}
                settingId={'appearance'}
                category={'appearance'}
                showHeading={false}
                keywords={'wallpaper background image light dark system dim fade'}
              >
                <AppearanceSettings></AppearanceSettings>
              </SettingsItemGroup>
              <SettingsItemGroup
                settingId={'selected-theme'}
                category={'appearance'}
                keywords={'selectedTheme'}
                title={'Theme'}
              >
                <ButtonToggleGroup
                  options={c.optionsForTheme}
                  selectedOptionId={c.selectedTheme}
                  events={{
                    edit: ({ detail }) =>
                      dialogManager.dialogs$.next([
                        {
                          component: SettingsCustomTheme,
                          props: { selectedTheme: detail, existingThemes: c.optionsForTheme }
                        }
                      ]),
                    delete: ({ detail }) => {
                      c.controller.changed((c.$theme$ = 'manabi-theme'));
                      delete c.$customThemes$[detail];
                      c.controller.changed((c.$customThemes$ = { ...c.$customThemes$ }));
                    }
                  }}
                  bindings={{
                    selectedOptionId: (value: typeof c.selectedTheme) => {
                      c.controller.changed((c.selectedTheme = value));
                    }
                  }}
                >
                  {browser ? (
                    <>
                      <Button
                        aria-label={'Add custom theme'}
                        variant={'outline'}
                        size={'lg'}
                        onClick={() =>
                          dialogManager.dialogs$.next([
                            {
                              component: SettingsCustomTheme,
                              props: { existingThemes: c.optionsForTheme }
                            }
                          ])
                        }
                        className={['m-1 text-lg'].filter(Boolean).join(' ')}
                      >
                        {' Add custom theme '}
                      </Button>
                    </>
                  ) : null}
                </ButtonToggleGroup>
              </SettingsItemGroup>
              <SettingsItemGroup
                settingId={'view-mode'}
                category={'layout'}
                keywords={'viewMode'}
                title={'View mode'}
              >
                <ButtonToggleGroup
                  options={c.optionsForViewMode}
                  selectedOptionId={c.viewMode}
                  bindings={{
                    selectedOptionId: (value: typeof c.viewMode) => {
                      c.controller.changed((c.viewMode = value));
                    }
                  }}
                ></ButtonToggleGroup>
              </SettingsItemGroup>
              <SettingsItemGroup
                title={'Japanese font defaults'}
                settingId={'font-defaults'}
                category={'typography'}
              >
                <Dom as="p" className={['text-sm text-muted-foreground'].filter(Boolean).join(' ')}>
                  {
                    ' YuKyokasho is the default when this browser can use it: Yoko for horizontal text and the standard face for vertical text. It is hidden when unavailable; Klee One becomes the default fallback. Optional fonts download only when used and can remain available offline when browser storage permits. Existing explicit font choices are kept. '
                  }
                </Dom>
              </SettingsItemGroup>
              <SettingsItemGroup
                settingId={'primary-font-input'}
                category={'typography'}
                keywords={'primaryFontInput'}
                title={'Primary / Serif font'}
              >
                <Dom
                  as="div"
                  slot={'header'}
                  className={['flex items-center'].filter(Boolean).join(' ')}
                >
                  <SettingsFontSelector
                    label={'Show available primary / serif fonts'}
                    availableFonts={c.availablePrimaryFonts}
                    selectedFont={effectivePrimaryReaderFont(
                      c.fontFamilyGroupOne,
                      c.yuKyokashoAvailable
                    )}
                    fontValue={c.fontFamilyGroupOne}
                    bindings={{
                      fontValue: (value: typeof c.fontFamilyGroupOne) => {
                        c.controller.changed((c.fontFamilyGroupOne = value));
                      }
                    }}
                  ></SettingsFontSelector>
                  {c.fontCacheSupported ? (
                    <>
                      <Button
                        variant={'link'}
                        size={'sm'}
                        onClick={() =>
                          dialogManager.dialogs$.next([
                            {
                              component: SettingsUserFontDialog,
                              props: { fontFamily: fontFamilyGroupOne$ }
                            }
                          ])
                        }
                      >
                        {'Custom fonts'}
                      </Button>
                    </>
                  ) : null}
                </Dom>
                <Input
                  type={'text'}
                  aria-label={'Primary / Serif font'}
                  placeholder={c.yuKyokashoAvailable === false ? 'Klee One' : 'YuKyokasho'}
                  value={c.primaryFontInput}
                  onFocus={c.beginPrimaryFontEdit}
                  onBlur={c.commitPrimaryFont}
                  onKeyDown={c.handlePrimaryFontKeydown}
                  className={[inputClasses].filter(Boolean).join(' ')}
                  bindings={{
                    value: (value: typeof c.primaryFontInput) => {
                      c.controller.changed((c.primaryFontInput = value));
                    }
                  }}
                ></Input>
              </SettingsItemGroup>
              <SettingsItemGroup
                settingId={'font-family-group-two'}
                category={'typography'}
                keywords={'fontFamilyGroupTwo'}
                title={'Sans-serif font'}
              >
                <Dom
                  as="div"
                  slot={'header'}
                  className={['flex items-center'].filter(Boolean).join(' ')}
                >
                  <SettingsFontSelector
                    label={'Show available sans-serif fonts'}
                    availableFonts={[
                      LocalFont.SYSTEMSANS,
                      LocalFont.NOTOSANSJP,
                      LocalFont.KZUDGOTHIC,
                      LocalFont.SANSSERIF
                    ]}
                    fontValue={c.fontFamilyGroupTwo}
                    bindings={{
                      fontValue: (value: typeof c.fontFamilyGroupTwo) => {
                        c.controller.changed((c.fontFamilyGroupTwo = value));
                      }
                    }}
                  ></SettingsFontSelector>
                  {c.fontCacheSupported ? (
                    <>
                      <Button
                        variant={'link'}
                        size={'sm'}
                        onClick={() =>
                          dialogManager.dialogs$.next([
                            {
                              component: SettingsUserFontDialog,
                              props: { fontFamily: fontFamilyGroupTwo$ }
                            }
                          ])
                        }
                      >
                        {'Custom fonts'}
                      </Button>
                    </>
                  ) : null}
                </Dom>
                <Input
                  type={'text'}
                  aria-label={'Sans-serif font'}
                  placeholder={'System Sans'}
                  value={c.fontFamilyGroupTwo}
                  className={[inputClasses].filter(Boolean).join(' ')}
                  bindings={{
                    value: (value: typeof c.fontFamilyGroupTwo) => {
                      c.controller.changed((c.fontFamilyGroupTwo = value));
                    }
                  }}
                ></Input>
              </SettingsItemGroup>
              <SettingsItemGroup
                settingId={'font-weight'}
                category={'typography'}
                keywords={'fontWeight'}
                title={'Font Weight'}
                tooltip={'Sets a font weight - leave empty to fallback to default'}
              >
                <Input
                  aria-label={'Font Weight'}
                  type={'number'}
                  placeholder={'default'}
                  step={'100'}
                  min={'100'}
                  max={'1000'}
                  value={c.fontWeight}
                  onChange={() => {
                    if (c.fontWeight === null) {
                      return;
                    }
                    if (c.fontWeight < 100) {
                      c.controller.changed((c.fontWeight = 100));
                    } else if (c.fontWeight > 1000) {
                      c.controller.changed((c.fontWeight = 1000));
                    }
                  }}
                  className={[inputClasses].filter(Boolean).join(' ')}
                  bindings={{
                    value: (value: typeof c.fontWeight) => {
                      c.controller.changed((c.fontWeight = value));
                    }
                  }}
                ></Input>
              </SettingsItemGroup>
              <SettingsItemGroup
                settingId={'font-size'}
                category={'typography'}
                keywords={'fontSize'}
                title={'Font size'}
              >
                <Input
                  aria-label={'Font size'}
                  type={'number'}
                  step={'1'}
                  min={'1'}
                  value={c.fontSize}
                  className={[inputClasses].filter(Boolean).join(' ')}
                  bindings={{
                    value: (value: typeof c.fontSize) => {
                      c.controller.changed((c.fontSize = value));
                    }
                  }}
                ></Input>
              </SettingsItemGroup>
              <SettingsItemGroup
                settingId={'line-height'}
                category={'typography'}
                keywords={'lineHeight'}
                title={'Line Height'}
              >
                <Input
                  aria-label={'Line Height'}
                  type={'number'}
                  step={'0.05'}
                  min={'1'}
                  value={c.lineHeight}
                  onChange={() => {
                    if (!c.lineHeight || c.lineHeight < 1) {
                      c.controller.changed((c.lineHeight = 1.65));
                    }
                  }}
                  className={[inputClasses].filter(Boolean).join(' ')}
                  bindings={{
                    value: (value: typeof c.lineHeight) => {
                      c.controller.changed((c.lineHeight = value));
                    }
                  }}
                ></Input>
              </SettingsItemGroup>
              <SettingsItemGroup
                settingId={'text-indentation'}
                category={'typography'}
                keywords={'textIndentation'}
                title={'Paragraph Indentation'}
                tooltip={'# of rem added as text indentation of new paragraphs'}
              >
                <Input
                  aria-label={'Paragraph Indentation'}
                  type={'number'}
                  step={'.5'}
                  min={'0'}
                  value={c.textIndentation}
                  onBlur={() => {
                    const newValue = Number.parseFloat(`${c.textIndentation ?? 0}`);
                    if (isNaN(newValue) || newValue < 1) {
                      c.controller.changed((c.textIndentation = 0));
                    }
                  }}
                  className={[inputClasses].filter(Boolean).join(' ')}
                  bindings={{
                    value: (value: typeof c.textIndentation) => {
                      c.controller.changed((c.textIndentation = value));
                    }
                  }}
                ></Input>
              </SettingsItemGroup>
              {c.textMarginMode === 'manual' ? (
                <>
                  <SettingsItemGroup
                    settingId={'text-margin-value'}
                    category={'typography'}
                    keywords={'textMarginValue'}
                    title={'Paragraph Margins'}
                    tooltip={'# of rem added as margin to paragraphs'}
                  >
                    <Input
                      aria-label={'Paragraph Margins'}
                      type={'number'}
                      step={'.5'}
                      min={'0'}
                      value={c.textMarginValue}
                      onBlur={() => {
                        const newValue = Number.parseFloat(`${c.textMarginValue ?? 0}`);
                        if (isNaN(newValue) || newValue < 1) {
                          c.controller.changed((c.textMarginValue = 0));
                        }
                      }}
                      className={[inputClasses].filter(Boolean).join(' ')}
                      bindings={{
                        value: (value: typeof c.textMarginValue) => {
                          c.controller.changed((c.textMarginValue = value));
                        }
                      }}
                    ></Input>
                  </SettingsItemGroup>
                </>
              ) : null}
              <SettingsItemGroup
                settingId={'first-dimension-margin'}
                category={'layout'}
                keywords={'firstDimensionMargin'}
                title={c.verticalMode ? 'Reader Left/right margin' : 'Reader Top/bottom margin'}
              >
                <SettingsDimensionPopover
                  slot={'header'}
                  isFirstDimension={true}
                  isVertical={c.verticalMode}
                  dimensionValue={c.firstDimensionMargin}
                  bindings={{
                    dimensionValue: (value: typeof c.firstDimensionMargin) => {
                      c.controller.changed((c.firstDimensionMargin = value));
                    }
                  }}
                ></SettingsDimensionPopover>
                <Input
                  aria-label={
                    c.verticalMode ? 'Reader Left/right margin' : 'Reader Top/bottom margin'
                  }
                  type={'number'}
                  step={'1'}
                  min={'0'}
                  value={c.firstDimensionMargin}
                  className={[inputClasses].filter(Boolean).join(' ')}
                  bindings={{
                    value: (value: typeof c.firstDimensionMargin) => {
                      c.controller.changed((c.firstDimensionMargin = value));
                    }
                  }}
                ></Input>
              </SettingsItemGroup>
              <SettingsItemGroup
                settingId={'second-dimension-max-value'}
                category={'layout'}
                keywords={'secondDimensionMaxValue'}
                title={c.verticalMode ? 'Reader Max height' : 'Reader Max width'}
              >
                <SettingsDimensionPopover
                  slot={'header'}
                  isVertical={c.verticalMode}
                  dimensionValue={c.secondDimensionMaxValue}
                  bindings={{
                    dimensionValue: (value: typeof c.secondDimensionMaxValue) => {
                      c.controller.changed((c.secondDimensionMaxValue = value));
                    }
                  }}
                ></SettingsDimensionPopover>
                <Input
                  aria-label={c.verticalMode ? 'Reader Max height' : 'Reader Max width'}
                  type={'number'}
                  step={'1'}
                  min={'0'}
                  value={c.secondDimensionMaxValue}
                  className={[inputClasses].filter(Boolean).join(' ')}
                  bindings={{
                    value: (value: typeof c.secondDimensionMaxValue) => {
                      c.controller.changed((c.secondDimensionMaxValue = value));
                    }
                  }}
                ></Input>
              </SettingsItemGroup>
              <SettingsItemGroup
                settingId={'swipe-threshold'}
                category={'reading'}
                keywords={'swipeThreshold'}
                title={'Swipe Threshold'}
                tooltip={'Distance which you need to swipe in order trigger a navigation'}
              >
                <Input
                  aria-label={'Swipe Threshold'}
                  type={'number'}
                  step={'1'}
                  min={'10'}
                  value={c.swipeThreshold}
                  onBlur={() => {
                    if (c.swipeThreshold < 10 || typeof c.swipeThreshold !== 'number') {
                      c.controller.changed((c.swipeThreshold = 10));
                    }
                  }}
                  className={[inputClasses].filter(Boolean).join(' ')}
                  bindings={{
                    value: (value: typeof c.swipeThreshold) => {
                      c.controller.changed((c.swipeThreshold = value));
                    }
                  }}
                ></Input>
              </SettingsItemGroup>
              {c.autoBookmark ? (
                <>
                  <SettingsItemGroup
                    settingId={'auto-bookmark-time'}
                    category={'reading'}
                    keywords={'autoBookmarkTime'}
                    title={'Auto Bookmark Time'}
                    tooltip={'Time in s for Auto Bookmark'}
                  >
                    <Input
                      aria-label={'Auto Bookmark Time'}
                      type={'number'}
                      step={'1'}
                      min={'1'}
                      value={c.autoBookmarkTime}
                      onBlur={() => {
                        if (c.autoBookmarkTime < 1 || typeof c.autoBookmarkTime !== 'number') {
                          c.controller.changed((c.autoBookmarkTime = 3));
                        }
                      }}
                      className={[inputClasses].filter(Boolean).join(' ')}
                      bindings={{
                        value: (value: typeof c.autoBookmarkTime) => {
                          c.controller.changed((c.autoBookmarkTime = value));
                        }
                      }}
                    ></Input>
                  </SettingsItemGroup>
                </>
              ) : null}
              <SettingsItemGroup
                settingId={'writing-mode'}
                category={'layout'}
                keywords={'writingMode'}
                title={'Writing mode'}
              >
                <ButtonToggleGroup
                  options={c.optionsForWritingMode}
                  selectedOptionId={c.writingMode}
                  bindings={{
                    selectedOptionId: (value: typeof c.writingMode) => {
                      c.controller.changed((c.writingMode = value));
                    }
                  }}
                ></ButtonToggleGroup>
              </SettingsItemGroup>
              {c.verticalMode ? (
                <>
                  <SettingsItemGroup
                    settingId={'enable-font-kerning'}
                    category={'typography'}
                    keywords={'enableFontKerning'}
                    title={'Enable Font Kerning'}
                    tooltip={
                      'Can lead to better visual balance for vertical spacing of text if font and browser supports it'
                    }
                  >
                    <ButtonToggleGroup
                      options={optionsForToggle}
                      selectedOptionId={c.enableFontKerning}
                      bindings={{
                        selectedOptionId: (value: typeof c.enableFontKerning) => {
                          c.controller.changed((c.enableFontKerning = value));
                        }
                      }}
                    ></ButtonToggleGroup>
                  </SettingsItemGroup>
                  <SettingsItemGroup
                    settingId={'enable-font-vpal'}
                    category={'typography'}
                    keywords={'enableFontVPAL'}
                    title={'Enable VPAL'}
                    tooltip={
                      'Can lead to more natural spacing for vertically laid-out text if font and browser supports it'
                    }
                  >
                    <ButtonToggleGroup
                      options={optionsForToggle}
                      selectedOptionId={c.enableFontVPAL}
                      bindings={{
                        selectedOptionId: (value: typeof c.enableFontVPAL) => {
                          c.controller.changed((c.enableFontVPAL = value));
                        }
                      }}
                    ></ButtonToggleGroup>
                  </SettingsItemGroup>
                  <SettingsItemGroup
                    settingId={'vertical-text-orientation'}
                    category={'typography'}
                    keywords={'verticalTextOrientation'}
                    title={'Text Orientation'}
                    tooltip={c.verticalTextOrientationTooltip}
                  >
                    <ButtonToggleGroup
                      options={c.optionsForVerticalTextOrientation}
                      selectedOptionId={c.verticalTextOrientation}
                      bindings={{
                        selectedOptionId: (value: typeof c.verticalTextOrientation) => {
                          c.controller.changed((c.verticalTextOrientation = value));
                        }
                      }}
                    ></ButtonToggleGroup>
                  </SettingsItemGroup>
                </>
              ) : null}
              <SettingsItemGroup
                settingId={'prioritize-reader-styles'}
                category={'reading'}
                keywords={'prioritizeReaderStyles'}
                title={'Prioritize Reader Styles'}
                tooltip={
                  'When enabled the "important" declaration is added to certain rules like margins or justification which makes it more likely to be applied in case of conflicting book styles'
                }
              >
                <ButtonToggleGroup
                  options={optionsForToggle}
                  selectedOptionId={c.prioritizeReaderStyles}
                  bindings={{
                    selectedOptionId: (value: typeof c.prioritizeReaderStyles) => {
                      c.controller.changed((c.prioritizeReaderStyles = value));
                    }
                  }}
                ></ButtonToggleGroup>
              </SettingsItemGroup>
              <SettingsItemGroup
                settingId={'enable-text-justification'}
                category={'typography'}
                keywords={'enableTextJustification'}
                title={'Enable Text Justification'}
                tooltip={
                  'When enabled the reader adds styles to justify text content of paragraphs'
                }
              >
                <ButtonToggleGroup
                  options={optionsForToggle}
                  selectedOptionId={c.enableTextJustification}
                  bindings={{
                    selectedOptionId: (value: typeof c.enableTextJustification) => {
                      c.controller.changed((c.enableTextJustification = value));
                    }
                  }}
                ></ButtonToggleGroup>
              </SettingsItemGroup>
              <SettingsItemGroup
                settingId={'enable-text-wrap-pretty'}
                category={'typography'}
                keywords={'enableTextWrapPretty'}
                title={'Enable Pretty Text Wrap'}
                tooltip={
                  'When enabled the reader adds the pretty text wrap style to supported browsers'
                }
              >
                <ButtonToggleGroup
                  options={optionsForToggle}
                  selectedOptionId={c.enableTextWrapPretty}
                  bindings={{
                    selectedOptionId: (value: typeof c.enableTextWrapPretty) => {
                      c.controller.changed((c.enableTextWrapPretty = value));
                    }
                  }}
                ></ButtonToggleGroup>
              </SettingsItemGroup>
              <SettingsItemGroup
                settingId={'text-margin-mode'}
                category={'typography'}
                keywords={'textMarginMode'}
                title={'Paragraph Margin Mode'}
                tooltip={
                  'When set to manual it allows to specify a margin value which should be applied to paragraphs'
                }
              >
                <ButtonToggleGroup
                  options={c.optionsForTextMarginMode}
                  selectedOptionId={c.textMarginMode}
                  bindings={{
                    selectedOptionId: (value: typeof c.textMarginMode) => {
                      c.controller.changed((c.textMarginMode = value));
                    }
                  }}
                ></ButtonToggleGroup>
              </SettingsItemGroup>
              {c.wakeLockSupported ? (
                <>
                  <SettingsItemGroup
                    settingId={'enable-reader-wake-lock'}
                    category={'reading'}
                    keywords={'enableReaderWakeLock'}
                    title={'Enable Screen Lock'}
                    tooltip={
                      'When enabled the reader site attempts to request a WakeLock that prevents device screens from dimming or locking'
                    }
                  >
                    <ButtonToggleGroup
                      options={optionsForToggle}
                      selectedOptionId={c.enableReaderWakeLock}
                      bindings={{
                        selectedOptionId: (value: typeof c.enableReaderWakeLock) => {
                          c.controller.changed((c.enableReaderWakeLock = value));
                        }
                      }}
                    ></ButtonToggleGroup>
                  </SettingsItemGroup>
                </>
              ) : null}
              <SettingsItemGroup
                settingId={'show-character-counter'}
                category={'reading'}
                keywords={'showCharacterCounter'}
                title={'Show Character Counter'}
              >
                <ButtonToggleGroup
                  options={optionsForToggle}
                  selectedOptionId={c.showCharacterCounter}
                  bindings={{
                    selectedOptionId: (value: typeof c.showCharacterCounter) => {
                      c.controller.changed((c.showCharacterCounter = value));
                    }
                  }}
                ></ButtonToggleGroup>
              </SettingsItemGroup>
              <SettingsItemGroup
                settingId={'show-percentage'}
                category={'reading'}
                keywords={'showPercentage'}
                title={'Show Percentage'}
              >
                <ButtonToggleGroup
                  options={optionsForToggle}
                  selectedOptionId={c.showPercentage}
                  bindings={{
                    selectedOptionId: (value: typeof c.showPercentage) => {
                      c.controller.changed((c.showPercentage = value));
                    }
                  }}
                ></ButtonToggleGroup>
              </SettingsItemGroup>
              <SettingsItemGroup
                settingId={'show-footer-chapter-character-counter'}
                category={'reading'}
                keywords={'showFooterChapterCharacterCounter'}
                title={'Show Footer Chapter Characters'}
              >
                <ButtonToggleGroup
                  options={optionsForToggle}
                  selectedOptionId={c.showFooterChapterCharacterCounter}
                  bindings={{
                    selectedOptionId: (value: typeof c.showFooterChapterCharacterCounter) => {
                      c.controller.changed((c.showFooterChapterCharacterCounter = value));
                    }
                  }}
                ></ButtonToggleGroup>
              </SettingsItemGroup>
              <SettingsItemGroup
                settingId={'show-footer-chapter-percentage'}
                category={'reading'}
                keywords={'showFooterChapterPercentage'}
                title={'Show Footer Chapter Percentage'}
              >
                <ButtonToggleGroup
                  options={optionsForToggle}
                  selectedOptionId={c.showFooterChapterPercentage}
                  bindings={{
                    selectedOptionId: (value: typeof c.showFooterChapterPercentage) => {
                      c.controller.changed((c.showFooterChapterPercentage = value));
                    }
                  }}
                ></ButtonToggleGroup>
              </SettingsItemGroup>
              <SettingsItemGroup
                settingId={'disable-wheel-navigation'}
                category={'reading'}
                keywords={'disableWheelNavigation'}
                title={'Disable Wheel Navigation'}
              >
                <ButtonToggleGroup
                  options={optionsForToggle}
                  selectedOptionId={c.disableWheelNavigation}
                  bindings={{
                    selectedOptionId: (value: typeof c.disableWheelNavigation) => {
                      c.controller.changed((c.disableWheelNavigation = value));
                    }
                  }}
                ></ButtonToggleGroup>
              </SettingsItemGroup>
              <SettingsItemGroup
                settingId={'confirm-close'}
                category={'reading'}
                keywords={'confirmClose'}
                title={'Close Confirmation'}
                tooltip={`When enabled asks for confirmation on closing/reloading a reader tab and unsaved changes were detected`}
              >
                <ButtonToggleGroup
                  options={optionsForToggle}
                  selectedOptionId={c.confirmClose}
                  bindings={{
                    selectedOptionId: (value: typeof c.confirmClose) => {
                      c.controller.changed((c.confirmClose = value));
                    }
                  }}
                ></ButtonToggleGroup>
              </SettingsItemGroup>
              <SettingsItemGroup
                settingId={'manual-bookmark'}
                category={'reading'}
                keywords={'manualBookmark'}
                title={'Manual Bookmark'}
                tooltip={
                  'If enabled current position will not be bookmarked when leaving the reader via menu elements'
                }
              >
                <ButtonToggleGroup
                  options={optionsForToggle}
                  selectedOptionId={c.manualBookmark}
                  bindings={{
                    selectedOptionId: (value: typeof c.manualBookmark) => {
                      c.controller.changed((c.manualBookmark = value));
                    }
                  }}
                ></ButtonToggleGroup>
              </SettingsItemGroup>
              <SettingsItemGroup
                settingId={'auto-bookmark'}
                category={'reading'}
                keywords={'autoBookmark'}
                title={'Auto Bookmark'}
                tooltip={c.autoBookmarkTooltip}
              >
                <ButtonToggleGroup
                  options={optionsForToggle}
                  selectedOptionId={c.autoBookmark}
                  bindings={{
                    selectedOptionId: (value: typeof c.autoBookmark) => {
                      c.controller.changed((c.autoBookmark = value));
                    }
                  }}
                ></ButtonToggleGroup>
              </SettingsItemGroup>
              <SettingsItemGroup
                settingId={'blur-image'}
                category={'reading'}
                keywords={'blurImage'}
                title={'Blur image'}
              >
                <ButtonToggleGroup
                  options={optionsForToggle}
                  selectedOptionId={c.blurImage}
                  bindings={{
                    selectedOptionId: (value: typeof c.blurImage) => {
                      c.controller.changed((c.blurImage = value));
                    }
                  }}
                ></ButtonToggleGroup>
              </SettingsItemGroup>
              {c.blurImage ? (
                <>
                  <SettingsItemGroup
                    settingId={'blur-image-mode'}
                    category={'reading'}
                    keywords={'blurImageMode'}
                    title={'Blur Mode'}
                    tooltip={
                      'Determines if all or only images after the table of contents will be blurred'
                    }
                  >
                    <ButtonToggleGroup
                      options={c.optionsForBlurMode}
                      selectedOptionId={c.blurImageMode}
                      bindings={{
                        selectedOptionId: (value: typeof c.blurImageMode) => {
                          c.controller.changed((c.blurImageMode = value));
                        }
                      }}
                    ></ButtonToggleGroup>
                  </SettingsItemGroup>
                </>
              ) : null}
              <SettingsItemGroup
                settingId={'hide-furigana'}
                category={'reading'}
                keywords={'hideFurigana'}
                title={'Hide furigana'}
              >
                <ButtonToggleGroup
                  options={optionsForToggle}
                  selectedOptionId={c.hideFurigana}
                  bindings={{
                    selectedOptionId: (value: typeof c.hideFurigana) => {
                      c.controller.changed((c.hideFurigana = value));
                    }
                  }}
                ></ButtonToggleGroup>
              </SettingsItemGroup>
              {c.hideFurigana ? (
                <>
                  <SettingsItemGroup
                    settingId={'furigana-style'}
                    category={'reading'}
                    keywords={'furiganaStyle'}
                    title={'Hide furigana style'}
                    tooltip={c.furiganaStyleTooltip}
                  >
                    <ButtonToggleGroup
                      options={c.optionsForFuriganaStyle}
                      selectedOptionId={c.furiganaStyle}
                      bindings={{
                        selectedOptionId: (value: typeof c.furiganaStyle) => {
                          c.controller.changed((c.furiganaStyle = value));
                        }
                      }}
                    ></ButtonToggleGroup>
                  </SettingsItemGroup>
                </>
              ) : null}
              {c.statisticsEnabled ? (
                <>
                  <SettingsItemGroup
                    settingId={'pause-tracker-on-custom-point-change'}
                    category={'reading'}
                    keywords={'pauseTrackerOnCustomPointChange'}
                    title={'Custom Point pauses Tracker'}
                    tooltip={
                      'When enabled the tracker will auto pause and unpause while setting a custom reading point'
                    }
                  >
                    <ButtonToggleGroup
                      options={optionsForToggle}
                      selectedOptionId={c.pauseTrackerOnCustomPointChange}
                      bindings={{
                        selectedOptionId: (value: typeof c.pauseTrackerOnCustomPointChange) => {
                          c.controller.changed((c.pauseTrackerOnCustomPointChange = value));
                        }
                      }}
                    ></ButtonToggleGroup>
                  </SettingsItemGroup>
                </>
              ) : null}
              {c.viewMode === ViewMode.Continuous ? (
                <>
                  <SettingsItemGroup
                    settingId={'custom-reading-point-enabled'}
                    category={'reading'}
                    keywords={'customReadingPointEnabled'}
                    title={'Custom Reading Point'}
                    tooltip={
                      'Allows to set a persistent custom point in the reader from which the current progress and bookmark is calculated when enabled'
                    }
                  >
                    <Dom as="div" className={['flex items-center'].filter(Boolean).join(' ')}>
                      <ButtonToggleGroup
                        options={optionsForToggle}
                        selectedOptionId={c.customReadingPointEnabled}
                        bindings={{
                          selectedOptionId: (value: typeof c.customReadingPointEnabled) => {
                            c.controller.changed((c.customReadingPointEnabled = value));
                          }
                        }}
                      ></ButtonToggleGroup>
                      {c.customReadingPointEnabled ? (
                        <>
                          <Button
                            variant={'ghost'}
                            size={'sm'}
                            onClick={() => {
                              verticalCustomReadingPosition$.next(100);
                              horizontalCustomReadingPosition$.next(0);
                            }}
                            className={['ml-4'].filter(Boolean).join(' ')}
                          >
                            {' Reset Points '}
                          </Button>
                        </>
                      ) : null}
                    </Dom>
                  </SettingsItemGroup>
                  <SettingsItemGroup
                    settingId={'auto-position-on-resize'}
                    category={'layout'}
                    keywords={'autoPositionOnResize'}
                    title={'Auto position on resize'}
                  >
                    <ButtonToggleGroup
                      options={optionsForToggle}
                      selectedOptionId={c.autoPositionOnResize}
                      bindings={{
                        selectedOptionId: (value: typeof c.autoPositionOnResize) => {
                          c.controller.changed((c.autoPositionOnResize = value));
                        }
                      }}
                    ></ButtonToggleGroup>
                  </SettingsItemGroup>
                </>
              ) : (
                <>
                  {' '}
                  <SettingsItemGroup
                    settingId={'avoid-page-break'}
                    category={'layout'}
                    keywords={'avoidPageBreak'}
                    title={'Avoid Page Break'}
                    tooltip={c.avoidPageBreakTooltip}
                  >
                    <ButtonToggleGroup
                      options={optionsForToggle}
                      selectedOptionId={c.avoidPageBreak}
                      bindings={{
                        selectedOptionId: (value: typeof c.avoidPageBreak) => {
                          c.controller.changed((c.avoidPageBreak = value));
                        }
                      }}
                    ></ButtonToggleGroup>
                  </SettingsItemGroup>
                  <SettingsItemGroup
                    settingId={'selection-to-bookmark-enabled'}
                    category={'reading'}
                    keywords={'selectionToBookmarkEnabled'}
                    title={'Selection to Bookmark'}
                    tooltip={
                      'When enabled bookmarks will be placed to a near paragraph of current/previous selected text instead of page start'
                    }
                  >
                    <ButtonToggleGroup
                      options={optionsForToggle}
                      selectedOptionId={c.selectionToBookmarkEnabled}
                      bindings={{
                        selectedOptionId: (value: typeof c.selectionToBookmarkEnabled) => {
                          c.controller.changed((c.selectionToBookmarkEnabled = value));
                        }
                      }}
                    ></ButtonToggleGroup>
                  </SettingsItemGroup>
                  <SettingsItemGroup
                    settingId={'enable-tap-edge-to-flip'}
                    category={'reading'}
                    keywords={'enableTapEdgeToFlip'}
                    title={'Tap to Flip'}
                    tooltip={
                      'Reserves small margins on the left and right on which you can tap to turn pages'
                    }
                  >
                    <ButtonToggleGroup
                      options={optionsForToggle}
                      selectedOptionId={c.enableTapEdgeToFlip}
                      bindings={{
                        selectedOptionId: (value: typeof c.enableTapEdgeToFlip) => {
                          c.controller.changed((c.enableTapEdgeToFlip = value));
                        }
                      }}
                    ></ButtonToggleGroup>
                  </SettingsItemGroup>
                  {!c.verticalMode ? (
                    <>
                      <SettingsItemGroup
                        settingId={'page-columns'}
                        category={'layout'}
                        keywords={'pageColumns'}
                        title={'Page Columns'}
                        tooltip={'# of text columns rendered'}
                      >
                        <Input
                          aria-label={'Page Columns'}
                          type={'number'}
                          step={'1'}
                          min={'0'}
                          value={c.pageColumns}
                          className={[inputClasses].filter(Boolean).join(' ')}
                          bindings={{
                            value: (value: typeof c.pageColumns) => {
                              c.controller.changed((c.pageColumns = value));
                            }
                          }}
                        ></Input>
                      </SettingsItemGroup>
                    </>
                  ) : null}
                </>
              )}
            </>
          ) : null}
          {c.activeSettings === 'Data' || c.activeSettings === 'All' ? (
            <>
              <SettingsItemGroup
                settingId={'persistent-storage'}
                category={'library'}
                keywords={'persistentStorage'}
                title={'Persistent storage'}
                tooltip={c.persistentStorageTooltip}
              >
                <Dom
                  as="div"
                  className={['flex flex-wrap items-center gap-3'].filter(Boolean).join(' ')}
                >
                  <Dom as="span" role={'status'} className={['text-sm'].filter(Boolean).join(' ')}>
                    {c.persistentStorage
                      ? 'Protected from automatic browser eviction'
                      : 'Using best-effort browser storage'}
                  </Dom>
                  {!c.persistentStorage ? (
                    <>
                      <Button
                        variant={'secondary'}
                        size={'sm'}
                        onClick={() => void c.requestPersistentStorage()}
                      >
                        {' Retry protection '}
                      </Button>
                    </>
                  ) : null}
                  {c.storageQuota ? (
                    <>
                      <Dom
                        as="span"
                        className={['text-sm text-muted-foreground'].filter(Boolean).join(' ')}
                      >
                        {c.storageQuota}
                      </Dom>
                    </>
                  ) : null}
                </Dom>
              </SettingsItemGroup>
              <SettingsItemGroup
                settingId={'hide-external-read-hint'}
                category={'library'}
                keywords={'hideExternalReadHint'}
                title={'Hide Source Hint'}
                tooltip={
                  'Hides the user warning when opening a book from an external storage source'
                }
              >
                <ButtonToggleGroup
                  options={optionsForToggle}
                  selectedOptionId={c.hideExternalReadHint}
                  bindings={{
                    selectedOptionId: (value: typeof c.hideExternalReadHint) => {
                      c.controller.changed((c.hideExternalReadHint = value));
                    }
                  }}
                ></ButtonToggleGroup>
              </SettingsItemGroup>
              <SettingsItemGroup
                settingId={'import-htmlfix-mode'}
                category={'library'}
                keywords={'importHTMLFixMode'}
                title={'Epub Import Fixes'}
                tooltip={c.importHTMLFixModeTooltip}
              >
                <ButtonToggleGroup
                  options={c.optionsForImportHTMLFixes}
                  selectedOptionId={c.importHTMLFixMode}
                  bindings={{
                    selectedOptionId: (value: typeof c.importHTMLFixMode) => {
                      c.controller.changed((c.importHTMLFixMode = value));
                    }
                  }}
                ></ButtonToggleGroup>
              </SettingsItemGroup>
              {c.importHTMLFixMode !== ImportHTMLFixMode.OFF ? (
                <>
                  <SettingsItemGroup
                    settingId={'restrict-import-fix-to-anchor'}
                    category={'library'}
                    keywords={'restrictImportFixToAnchor'}
                    title={'Restrict to Links'}
                    tooltip={'Restricts epub fixes for self closing tags to links only'}
                  >
                    <ButtonToggleGroup
                      options={optionsForToggle}
                      selectedOptionId={c.restrictImportFixToAnchor}
                      bindings={{
                        selectedOptionId: (value: typeof c.restrictImportFixToAnchor) => {
                          c.controller.changed((c.restrictImportFixToAnchor = value));
                        }
                      }}
                    ></ButtonToggleGroup>
                  </SettingsItemGroup>
                </>
              ) : null}
              <SettingsItemGroup
                settingId={'cache-storage-data'}
                category={'library'}
                keywords={'cacheStorageData'}
                title={'Cache Data'}
                tooltip={c.cacheStorageDataTooltip}
              >
                <ButtonToggleGroup
                  options={optionsForToggle}
                  selectedOptionId={c.cacheStorageData}
                  bindings={{
                    selectedOptionId: (value: typeof c.cacheStorageData) => {
                      c.controller.changed((c.cacheStorageData = value));
                    }
                  }}
                ></ButtonToggleGroup>
              </SettingsItemGroup>
              <SettingsItemGroup
                settingId={'auto-replication'}
                category={'library'}
                keywords={'autoReplication'}
                title={'Auto Import/Export'}
                tooltip={c.autoReplicationTypeTooltip}
              >
                <ButtonToggleGroup
                  options={c.optionsForAutoReplicationType}
                  selectedOptionId={c.autoReplication}
                  bindings={{
                    selectedOptionId: (value: typeof c.autoReplication) => {
                      c.controller.changed((c.autoReplication = value));
                    }
                  }}
                ></ButtonToggleGroup>
              </SettingsItemGroup>
              <SettingsItemGroup
                settingId={'replication-save-behavior'}
                category={'library'}
                keywords={'replicationSaveBehavior'}
                title={'Import/Export Behavior'}
                tooltip={c.replicationSaveBehaviorTooltip}
              >
                <ButtonToggleGroup
                  options={c.optionsForReplicationSaveBehavior}
                  selectedOptionId={c.replicationSaveBehavior}
                  bindings={{
                    selectedOptionId: (value: typeof c.replicationSaveBehavior) => {
                      c.controller.changed((c.replicationSaveBehavior = value));
                    }
                  }}
                ></ButtonToggleGroup>
              </SettingsItemGroup>
              <SettingsItemGroup
                settingId={'show-external-placeholder'}
                category={'library'}
                keywords={'showExternalPlaceholder'}
                title={'Show Placeholder'}
                tooltip={c.showExternalPlaceholderToolTip}
              >
                <ButtonToggleGroup
                  options={optionsForToggle}
                  selectedOptionId={c.showExternalPlaceholder}
                  bindings={{
                    selectedOptionId: (value: typeof c.showExternalPlaceholder) => {
                      c.controller.changed((c.showExternalPlaceholder = value));
                    }
                  }}
                ></ButtonToggleGroup>
              </SettingsItemGroup>
              <SettingsItemGroup
                title={'Storage sources'}
                settingId={'storage-sources'}
                category={'library'}
                keywords={'cloud drive local folder encryption'}
              >
                <SettingsStorageSourceList
                  storageSources={c.$storageSources$}
                ></SettingsStorageSourceList>
              </SettingsItemGroup>
            </>
          ) : null}
          {c.activeSettings === 'Statistics' || c.activeSettings === 'All' ? (
            <>
              <SettingsItemGroup
                settingId={'keep-local-statistics-on-deletion'}
                category={'tracking'}
                keywords={'keepLocalStatisticsOnDeletion'}
                title={'Keep Local Data on Deletion'}
                tooltip={
                  'Determines if local statistics will be deleted or not when removing a local book copy'
                }
              >
                <Dom
                  as="div"
                  className={['flex min-w-0 flex-wrap items-center gap-3']
                    .filter(Boolean)
                    .join(' ')}
                >
                  <ButtonToggleGroup
                    options={optionsForToggle}
                    selectedOptionId={c.keepLocalStatisticsOnDeletion}
                    bindings={{
                      selectedOptionId: (value: typeof c.keepLocalStatisticsOnDeletion) => {
                        c.controller.changed((c.keepLocalStatisticsOnDeletion = value));
                      }
                    }}
                  ></ButtonToggleGroup>
                  <Button
                    variant={'destructive'}
                    size={'sm'}
                    onClick={() => {
                      c.controller.changed((c.showSpinner = true));
                      database
                        .clearZombieStatistics()
                        .catch(({ message }) =>
                          dialogManager.dialogs$.next([
                            {
                              component: MessageDialog,
                              props: {
                                title: 'Error',
                                message: `Error clearing Zombie Statistics: ${message}`
                              }
                            }
                          ])
                        )
                        .finally(() => c.controller.changed((c.showSpinner = false)));
                    }}
                  >
                    {' Clear Zombie Statistics '}
                  </Button>
                </Dom>
              </SettingsItemGroup>
              <SettingsItemGroup
                settingId={'overwrite-book-completion'}
                category={'tracking'}
                keywords={'overwriteBookCompletion'}
                title={'Overwrite Book Completion'}
                tooltip={`Determines if only the first Book Completion will be tracked or if it always updates to the latest one`}
              >
                <ButtonToggleGroup
                  options={optionsForToggle}
                  selectedOptionId={c.overwriteBookCompletion}
                  bindings={{
                    selectedOptionId: (value: typeof c.overwriteBookCompletion) => {
                      c.controller.changed((c.overwriteBookCompletion = value));
                    }
                  }}
                ></ButtonToggleGroup>
              </SettingsItemGroup>
              <SettingsItemGroup
                settingId={'start-day-hours-for-tracker'}
                category={'tracking'}
                keywords={'startDayHoursForTracker'}
                title={`Start Day Hours: ${c.startOfDayHours}`}
                tooltip={
                  'Determines at which time a new day starts.\nData before this point will be counted towards the previous day'
                }
              >
                <Dom
                  as="input"
                  aria-label={`Start Day Hours: ${c.startOfDayHours}`}
                  type={'range'}
                  step={'1'}
                  min={'0'}
                  max={'23'}
                  value={c.startDayHoursForTracker}
                  className={[inputClasses].filter(Boolean).join(' ')}
                  bindings={{
                    value: (value: typeof c.startDayHoursForTracker) => {
                      c.controller.changed((c.startDayHoursForTracker = value));
                    }
                  }}
                />
              </SettingsItemGroup>
              <SettingsItemGroup
                settingId={'statistics-merge-mode'}
                category={'tracking'}
                keywords={'statisticsMergeMode'}
                title={'Statistics Merge'}
                tooltip={`Determines if statistics will be merged entry by entry or replaced completely on a sync`}
              >
                <ButtonToggleGroup
                  options={c.optionsForMergeMode}
                  selectedOptionId={c.statisticsMergeMode}
                  bindings={{
                    selectedOptionId: (value: typeof c.statisticsMergeMode) => {
                      c.controller.changed((c.statisticsMergeMode = value));
                    }
                  }}
                ></ButtonToggleGroup>
              </SettingsItemGroup>
              <SettingsItemGroup
                settingId={'reading-goals-merge-mode'}
                category={'tracking'}
                keywords={'readingGoalsMergeMode'}
                title={'Reading Goals Merge'}
                tooltip={`Determines if reading goals will be merged entry by entry or replaced completely on a sync`}
              >
                <ButtonToggleGroup
                  options={c.optionsForMergeMode}
                  selectedOptionId={c.readingGoalsMergeMode}
                  bindings={{
                    selectedOptionId: (value: typeof c.readingGoalsMergeMode) => {
                      c.controller.changed((c.readingGoalsMergeMode = value));
                    }
                  }}
                ></ButtonToggleGroup>
              </SettingsItemGroup>
              <SettingsItemGroup
                settingId={'statistics-enabled'}
                category={'tracking'}
                keywords={'statisticsEnabled'}
                title={'Enable Statistics'}
                tooltip={
                  'Enables the tracker icon in the bottom left corner of the reader which you need to use to start tracking your reading session'
                }
              >
                <ButtonToggleGroup
                  options={optionsForToggle}
                  selectedOptionId={c.statisticsEnabled}
                  bindings={{
                    selectedOptionId: (value: typeof c.statisticsEnabled) => {
                      c.controller.changed((c.statisticsEnabled = value));
                    }
                  }}
                ></ButtonToggleGroup>
              </SettingsItemGroup>
              {c.statisticsEnabled ? (
                <>
                  <SettingsItemGroup
                    settingId={'tracker-auto-pause'}
                    category={'tracking'}
                    keywords={'trackerAutoPause'}
                    title={'Tracker Auto Pause'}
                    tooltip={c.trackerAutoPauseTooltip}
                  >
                    <ButtonToggleGroup
                      options={c.optionsForTrackerAutoPause}
                      selectedOptionId={c.trackerAutoPause}
                      bindings={{
                        selectedOptionId: (value: typeof c.trackerAutoPause) => {
                          c.controller.changed((c.trackerAutoPause = value));
                        }
                      }}
                    ></ButtonToggleGroup>
                  </SettingsItemGroup>
                  <SettingsItemGroup
                    settingId={'open-tracker-on-completion'}
                    category={'tracking'}
                    keywords={'openTrackerOnCompletion'}
                    title={'Open Tracker on Completion'}
                  >
                    <ButtonToggleGroup
                      options={optionsForToggle}
                      selectedOptionId={c.openTrackerOnCompletion}
                      bindings={{
                        selectedOptionId: (value: typeof c.openTrackerOnCompletion) => {
                          c.controller.changed((c.openTrackerOnCompletion = value));
                        }
                      }}
                    ></ButtonToggleGroup>
                  </SettingsItemGroup>
                  <SettingsItemGroup
                    settingId={'add-characters-on-completion'}
                    category={'tracking'}
                    keywords={'addCharactersOnCompletion'}
                    title={'Update on Completion'}
                    tooltip={`Determines if the missing amount of characters between the current position and the book total will be added to the statistics or not`}
                  >
                    <ButtonToggleGroup
                      options={optionsForToggle}
                      selectedOptionId={c.addCharactersOnCompletion}
                      bindings={{
                        selectedOptionId: (value: typeof c.addCharactersOnCompletion) => {
                          c.controller.changed((c.addCharactersOnCompletion = value));
                        }
                      }}
                    ></ButtonToggleGroup>
                  </SettingsItemGroup>
                  <SettingsItemGroup
                    settingId={'tracker-auto-start-time'}
                    category={'tracking'}
                    keywords={'trackerAutoStartTime'}
                    title={'Autostart tracker (sec)'}
                    tooltip={
                      'Time in seconds without a change to the character count after which the tracker will initially auto start (0 = disabled, higher value recommended to avoid racing conditions)'
                    }
                  >
                    <Input
                      aria-label={'Autostart tracker (sec)'}
                      type={'number'}
                      step={'1'}
                      min={'0'}
                      value={c.trackerAutoStartTime}
                      onBlur={() => {
                        const newValue = Number.parseFloat(`${c.trackerAutoStartTime ?? 0}`);
                        if (isNaN(newValue) || newValue < 1) {
                          c.controller.changed((c.trackerAutoStartTime = 0));
                        }
                      }}
                      className={[inputClasses].filter(Boolean).join(' ')}
                      bindings={{
                        value: (value: typeof c.trackerAutoStartTime) => {
                          c.controller.changed((c.trackerAutoStartTime = value));
                        }
                      }}
                    ></Input>
                  </SettingsItemGroup>
                  <SettingsItemGroup
                    settingId={'tracker-idle-time-in-min'}
                    category={'tracking'}
                    keywords={'trackerIdleTimeInMin'}
                    title={'Idle Time (min)'}
                    tooltip={
                      'Time in minutes after which the tracker will auto pause without page interaction (0 = disabled, max 12h)'
                    }
                  >
                    <Input
                      aria-label={'Idle Time (min)'}
                      type={'number'}
                      step={'0.5'}
                      min={'0'}
                      max={MAX_TRACKER_IDLE_MINUTES}
                      value={c.trackerIdleTimeInMin}
                      onBlur={() => {
                        c.controller.changed(
                          (c.trackerIdleTime = trackerIdleSecondsFromMinutes(
                            c.trackerIdleTimeInMin
                          ))
                        );
                      }}
                      className={[inputClasses].filter(Boolean).join(' ')}
                      bindings={{
                        value: (value: typeof c.trackerIdleTimeInMin) => {
                          c.controller.changed((c.trackerIdleTimeInMin = value));
                        }
                      }}
                    ></Input>
                  </SettingsItemGroup>
                  <SettingsItemGroup
                    settingId={'tracker-forward-skip-threshold'}
                    category={'tracking'}
                    keywords={'trackerForwardSkipThreshold'}
                    title={'Forward Skip Threshold'}
                    tooltip={
                      'Amount of positive characters passed between a tick after which a threshold action is triggered (0 = disabled)'
                    }
                  >
                    <Input
                      aria-label={'Forward Skip Threshold'}
                      type={'number'}
                      step={'1'}
                      min={'0'}
                      value={c.trackerForwardSkipThreshold}
                      onBlur={() => {
                        if (c.trackerForwardSkipThreshold === 0) {
                          c.controller.changed((c.trackerForwardSkipThreshold = 0));
                        } else if (
                          !c.trackerForwardSkipThreshold ||
                          c.trackerForwardSkipThreshold < 0
                        ) {
                          c.controller.changed((c.trackerForwardSkipThreshold = 2700));
                        }
                      }}
                      className={[inputClasses].filter(Boolean).join(' ')}
                      bindings={{
                        value: (value: typeof c.trackerForwardSkipThreshold) => {
                          c.controller.changed((c.trackerForwardSkipThreshold = value));
                        }
                      }}
                    ></Input>
                  </SettingsItemGroup>
                  <SettingsItemGroup
                    settingId={'tracker-backward-skip-threshold'}
                    category={'tracking'}
                    keywords={'trackerBackwardSkipThreshold'}
                    title={'Backward Skip Threshold'}
                    tooltip={
                      'Amount of negative characters passed between a tick after which a threshold action is triggered (0 = disabled)'
                    }
                  >
                    <Input
                      aria-label={'Backward Skip Threshold'}
                      type={'number'}
                      step={'1'}
                      value={c.trackerBackwardSkipThreshold}
                      onBlur={() => {
                        if (c.trackerBackwardSkipThreshold < 0) {
                          c.controller.changed(
                            (c.trackerBackwardSkipThreshold = Math.abs(
                              c.trackerBackwardSkipThreshold
                            ))
                          );
                        } else if (c.trackerBackwardSkipThreshold === 0) {
                          c.controller.changed((c.trackerBackwardSkipThreshold = 0));
                        } else if (!c.trackerBackwardSkipThreshold) {
                          c.controller.changed((c.trackerBackwardSkipThreshold = 2700));
                        }
                      }}
                      className={[inputClasses].filter(Boolean).join(' ')}
                      bindings={{
                        value: (value: typeof c.trackerBackwardSkipThreshold) => {
                          c.controller.changed((c.trackerBackwardSkipThreshold = value));
                        }
                      }}
                    ></Input>
                  </SettingsItemGroup>
                  {c.trackerForwardSkipThreshold || c.trackerBackwardSkipThreshold ? (
                    <>
                      <SettingsItemGroup
                        settingId={'tracker-skip-threshold-action'}
                        category={'tracking'}
                        keywords={'trackerSkipThresholdAction'}
                        title={'Threshold Action'}
                        tooltip={`Determines what action will be executed in case a skip threshold was triggered`}
                      >
                        <ButtonToggleGroup
                          options={c.optionsForTrackerSkipThresholdAction}
                          selectedOptionId={c.trackerSkipThresholdAction}
                          bindings={{
                            selectedOptionId: (value: typeof c.trackerSkipThresholdAction) => {
                              c.controller.changed((c.trackerSkipThresholdAction = value));
                            }
                          }}
                        ></ButtonToggleGroup>
                      </SettingsItemGroup>
                    </>
                  ) : null}
                  {c.trackerAutoPause !== TrackerAutoPause.OFF ? (
                    <>
                      <SettingsItemGroup
                        settingId={'tracker-popup-detection'}
                        category={'tracking'}
                        keywords={'trackerPopupDetection'}
                        title={'Dictionary Detection'}
                        tooltip={`If enabled auto pause is skipped if open yomitan/jpdb-browser-reader was detected - yomitan requires disabled 'Secure Container' settings`}
                      >
                        <ButtonToggleGroup
                          options={optionsForToggle}
                          selectedOptionId={c.trackerPopupDetection}
                          bindings={{
                            selectedOptionId: (value: typeof c.trackerPopupDetection) => {
                              c.controller.changed((c.trackerPopupDetection = value));
                            }
                          }}
                        ></ButtonToggleGroup>
                      </SettingsItemGroup>
                    </>
                  ) : null}
                  {c.trackerIdleTime > 0 ? (
                    <>
                      <SettingsItemGroup
                        settingId={'adjust-statistics-after-idle-time'}
                        category={'tracking'}
                        keywords={'adjustStatisticsAfterIdleTime'}
                        title={'Rollback Statistics on Idle'}
                        tooltip={`If enabled attempts to rollback statistics by subtracting the idled time value back from the session`}
                      >
                        <ButtonToggleGroup
                          options={optionsForToggle}
                          selectedOptionId={c.adjustStatisticsAfterIdleTime}
                          bindings={{
                            selectedOptionId: (value: typeof c.adjustStatisticsAfterIdleTime) => {
                              c.controller.changed((c.adjustStatisticsAfterIdleTime = value));
                            }
                          }}
                        ></ButtonToggleGroup>
                      </SettingsItemGroup>
                    </>
                  ) : null}
                  <SettingsItemGroup
                    title={'Reading goals'}
                    settingId={'reading-goals'}
                    category={'tracking'}
                    keywords={'time characters daily weekly monthly history'}
                  >
                    <SettingsReadingGoals
                      storageSources={c.$storageSources$}
                      events={{
                        spinner: ({ detail }) => c.controller.changed((c.showSpinner = detail))
                      }}
                    ></SettingsReadingGoals>
                  </SettingsItemGroup>
                </>
              ) : null}
            </>
          ) : null}
          {c.showSpinner ? (
            <>
              <Dom
                as="div"
                className={['fixed inset-0 bg-black/[.2] tap-highlight-transparent']
                  .filter(Boolean)
                  .join(' ')}
              ></Dom>
              <Dom
                as="div"
                role={'status'}
                className={[
                  'fixed inset-0 z-50 flex h-full w-full items-center justify-center gap-3 text-lg'
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {' Updating reading data… '}
                <AppIcon icon={faSpinner} spin={true}></AppIcon>
              </Dom>
            </>
          ) : null}
        </Dom>
      </div>
    </SettingsContext.Provider>
  );
}
