/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import { dimensionExtent, dimensionLabel, dimensionLimits, dimensionPercentage, dimensionPixels } from '../lib/components/settings/dimension-presets';
import { ReaderController, readerTick, writeStore, type StoreValue } from '../reader-react/controller';
import { type SettingsContextValue } from './context';


const Button = 'Button';
export interface SettingsDimensionContentProps {
dimensionValue?: number;
isVertical?: boolean;
isFirstDimension?: boolean;
}

export function createSettingsDimensionContent(props: SettingsDimensionContentProps, emit: (name: string, detail?: unknown) => void = () => {}, componentContext: SettingsContextValue) {
const __readerController = new ReaderController();
let extent: any;
let limits: any;
let percentage: any;
let context: any;
let shownPercentage: any;
let label: any;
let pixels: any;
let currentValue: any;

let dimensionValue = props.dimensionValue !== undefined ? props.dimensionValue : 0;
let isVertical = props.isVertical !== undefined ? props.isVertical : true;
let isFirstDimension = props.isFirstDimension !== undefined ? props.isFirstDimension : false;
let width = 0;
let height = 0;
let preview: {
    context: string;
    percentage: number;
} | undefined;
__readerController.effect(() => [isVertical, isFirstDimension, width, height], () => { __readerController.changed(extent = dimensionExtent(isVertical, isFirstDimension, width, height)); });
__readerController.effect(() => [isFirstDimension], () => { __readerController.changed(limits = dimensionLimits(isFirstDimension)); });
__readerController.effect(() => [dimensionValue, extent, isFirstDimension], () => { __readerController.changed(percentage = dimensionPercentage(dimensionValue, extent, isFirstDimension)); });
__readerController.effect(() => [isVertical, isFirstDimension, extent, dimensionValue], () => { __readerController.changed(context = `${isVertical}:${isFirstDimension}:${extent}:${dimensionValue}`); });
__readerController.effect(() => [preview, context, percentage], () => { __readerController.changed(shownPercentage = preview && preview.context === context ? preview.percentage : percentage); });
__readerController.effect(() => [isVertical, isFirstDimension], () => { __readerController.changed(label = dimensionLabel(isVertical, isFirstDimension)); });
__readerController.effect(() => [shownPercentage, extent, isFirstDimension], () => { __readerController.changed(pixels = dimensionPixels(shownPercentage, extent, isFirstDimension)); });
__readerController.effect(() => [dimensionValue, isFirstDimension], () => { __readerController.changed(currentValue =
    !Number.isFinite(dimensionValue) || dimensionValue < 0
        ? 'Not set'
        : !isFirstDimension && dimensionValue === 0
            ? 'Automatic'
            : `${dimensionValue} px${isFirstDimension ? ' per side' : ''}`); });
function setToValue(value: number) {
    const next = dimensionPixels(value, extent, isFirstDimension);
    __readerController.changed(preview = undefined);
    if (next !== null)
        __readerController.changed(dimensionValue = next);
}

const api = { controller: __readerController, setToValue,
get dimensionValue() { return dimensionValue; }, set dimensionValue(nextValue: typeof dimensionValue) { if (Object.is(dimensionValue, nextValue)) return; dimensionValue = nextValue; __readerController.invalidate(); },
get isVertical() { return isVertical; }, set isVertical(nextValue: typeof isVertical) { if (Object.is(isVertical, nextValue)) return; isVertical = nextValue; __readerController.invalidate(); },
get isFirstDimension() { return isFirstDimension; }, set isFirstDimension(nextValue: typeof isFirstDimension) { if (Object.is(isFirstDimension, nextValue)) return; isFirstDimension = nextValue; __readerController.invalidate(); },
get width() { return width; }, set width(nextValue: typeof width) { if (Object.is(width, nextValue)) return; width = nextValue; __readerController.invalidate(); },
get height() { return height; }, set height(nextValue: typeof height) { if (Object.is(height, nextValue)) return; height = nextValue; __readerController.invalidate(); },
get preview() { return preview; }, set preview(nextValue: typeof preview) { if (Object.is(preview, nextValue)) return; preview = nextValue; __readerController.invalidate(); },
get extent() { return extent; }, set extent(nextValue: typeof extent) { if (Object.is(extent, nextValue)) return; extent = nextValue; __readerController.invalidate(); },
get limits() { return limits; }, set limits(nextValue: typeof limits) { if (Object.is(limits, nextValue)) return; limits = nextValue; __readerController.invalidate(); },
get percentage() { return percentage; }, set percentage(nextValue: typeof percentage) { if (Object.is(percentage, nextValue)) return; percentage = nextValue; __readerController.invalidate(); },
get context() { return context; }, set context(nextValue: typeof context) { if (Object.is(context, nextValue)) return; context = nextValue; __readerController.invalidate(); },
get shownPercentage() { return shownPercentage; }, set shownPercentage(nextValue: typeof shownPercentage) { if (Object.is(shownPercentage, nextValue)) return; shownPercentage = nextValue; __readerController.invalidate(); },
get label() { return label; }, set label(nextValue: typeof label) { if (Object.is(label, nextValue)) return; label = nextValue; __readerController.invalidate(); },
get pixels() { return pixels; }, set pixels(nextValue: typeof pixels) { if (Object.is(pixels, nextValue)) return; pixels = nextValue; __readerController.invalidate(); },
get currentValue() { return currentValue; }, set currentValue(nextValue: typeof currentValue) { if (Object.is(currentValue, nextValue)) return; currentValue = nextValue; __readerController.invalidate(); },
updateProps(next: Record<string, unknown>) {
if ('dimensionValue' in next && next.dimensionValue !== undefined) api.dimensionValue = next.dimensionValue as typeof dimensionValue;
if ('isVertical' in next && next.isVertical !== undefined) api.isVertical = next.isVertical as typeof isVertical;
if ('isFirstDimension' in next && next.isFirstDimension !== undefined) api.isFirstDimension = next.isFirstDimension as typeof isFirstDimension;
}
};
return api;
}
