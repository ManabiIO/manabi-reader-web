/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { ReaderController } from '../reader-react/controller';
import type { SettingsContextValue } from './context';

export interface SettingsDimensionContentProps {
  dimensionValue?: number;
  isVertical?: boolean;
  isFirstDimension?: boolean;
}

/** The existing browser binding owns persistence; draft/geometry live in the
 * shared editor. Never publish a normalized value just because it mounted. */
export function createSettingsDimensionContent(
  props: SettingsDimensionContentProps,
  _emit: (name: string, detail?: unknown) => void = () => {},
  _context?: SettingsContextValue
) {
  const controller = new ReaderController();
  let dimensionValue = props.dimensionValue ?? 0;
  let isVertical = props.isVertical ?? true;
  let isFirstDimension = props.isFirstDimension ?? false;
  const api = {
    controller,
    get dimensionValue() {
      return dimensionValue;
    },
    set dimensionValue(value: number) {
      if (Object.is(dimensionValue, value)) return;
      dimensionValue = value;
      controller.invalidate();
    },
    get isVertical() {
      return isVertical;
    },
    set isVertical(value: boolean) {
      if (Object.is(isVertical, value)) return;
      isVertical = value;
      controller.invalidate();
    },
    get isFirstDimension() {
      return isFirstDimension;
    },
    set isFirstDimension(value: boolean) {
      if (Object.is(isFirstDimension, value)) return;
      isFirstDimension = value;
      controller.invalidate();
    },
    updateProps(next: Record<string, unknown>) {
      if (next.dimensionValue !== undefined) api.dimensionValue = next.dimensionValue as number;
      if (next.isVertical !== undefined) api.isVertical = next.isVertical as boolean;
      if (next.isFirstDimension !== undefined)
        api.isFirstDimension = next.isFirstDimension as boolean;
    }
  };
  return api;
}
