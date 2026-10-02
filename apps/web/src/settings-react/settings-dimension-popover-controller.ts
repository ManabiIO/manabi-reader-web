/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import { dimensionLabel } from '../lib/components/settings/dimension-presets';
import { ReaderController, readerTick, writeStore, type StoreValue } from '../reader-react/controller';
import { type SettingsContextValue } from './context';

import { SettingsDimensionContent } from './settings-dimension-content';
const SlidersHorizontal = 'SlidersHorizontal';
const AppIcon = 'AppIcon';
const Popover = 'Popover';
export interface SettingsDimensionPopoverProps {
isFirstDimension?: boolean;
isVertical?: boolean;
dimensionValue?: number;
}

export function createSettingsDimensionPopover(props: SettingsDimensionPopoverProps, emit: (name: string, detail?: unknown) => void = () => {}, componentContext: SettingsContextValue) {
const __readerController = new ReaderController();


let isFirstDimension = props.isFirstDimension !== undefined ? props.isFirstDimension : false;
let isVertical = props.isVertical !== undefined ? props.isVertical : false;
let dimensionValue = props.dimensionValue !== undefined ? props.dimensionValue : 0;

const api = { controller: __readerController, 
get isFirstDimension() { return isFirstDimension; }, set isFirstDimension(nextValue: typeof isFirstDimension) { if (Object.is(isFirstDimension, nextValue)) return; isFirstDimension = nextValue; __readerController.invalidate(); },
get isVertical() { return isVertical; }, set isVertical(nextValue: typeof isVertical) { if (Object.is(isVertical, nextValue)) return; isVertical = nextValue; __readerController.invalidate(); },
get dimensionValue() { return dimensionValue; }, set dimensionValue(nextValue: typeof dimensionValue) { if (Object.is(dimensionValue, nextValue)) return; dimensionValue = nextValue; __readerController.invalidate(); },
updateProps(next: Record<string, unknown>) {
if ('isFirstDimension' in next && next.isFirstDimension !== undefined) api.isFirstDimension = next.isFirstDimension as typeof isFirstDimension;
if ('isVertical' in next && next.isVertical !== undefined) api.isVertical = next.isVertical as typeof isVertical;
if ('dimensionValue' in next && next.dimensionValue !== undefined) api.dimensionValue = next.dimensionValue as typeof dimensionValue;
}
};
return api;
}
