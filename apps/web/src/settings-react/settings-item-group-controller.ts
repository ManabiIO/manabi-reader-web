/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import { readable } from '$lib/state/store';
import { SETTINGS_FILTER, SETTINGS_FIELD, matchesSetting, type SettingsFilterStore } from '../lib/components/settings/settings-context';
import { ReaderController, readerTick, writeStore, type StoreValue } from '../reader-react/controller';
import { type SettingsContextValue } from './context';


const Field = 'Field';
export interface SettingsItemGroupProps {
title: string;
tooltip?: string;
applyHeaderClasses?: boolean;
category?: string;
settingId?: string;
keywords?: string;
showHeading?: boolean;
}

export function createSettingsItemGroup(props: SettingsItemGroupProps, emit: (name: string, detail?: unknown) => void = () => {}, componentContext: SettingsContextValue) {
const __readerController = new ReaderController();
let visible: any;
let headingId: any;
let $filter: StoreValue<typeof filter> = undefined as never;
let title: string = props.title;
let tooltip = props.tooltip !== undefined ? props.tooltip : '';
let applyHeaderClasses = props.applyHeaderClasses !== undefined ? props.applyHeaderClasses : true;
let category = props.category !== undefined ? props.category : 'all';
let settingId = props.settingId !== undefined ? props.settingId : '';
let keywords = props.keywords !== undefined ? props.keywords : '';
let showHeading = props.showHeading !== undefined ? props.showHeading : true;
const filter = componentContext.getContext<SettingsFilterStore>(SETTINGS_FILTER) ?? readable({ category: 'all', query: '' });
componentContext.setContext(SETTINGS_FIELD, () => title);
__readerController.effect(() => [$filter, category, title, tooltip, keywords], () => { __readerController.changed(visible = matchesSetting($filter, category, `${title} ${tooltip} ${keywords}`)); });
__readerController.effect(() => [settingId], () => { __readerController.changed(headingId = settingId ? `setting-${settingId}-heading` : undefined); });
$filter = __readerController.read(filter);
__readerController.observeSource(() => filter, (value) => { $filter = value; });
const api = { controller: __readerController, 
get title() { return title; }, set title(nextValue: typeof title) { if (Object.is(title, nextValue)) return; title = nextValue; __readerController.invalidate(); },
get tooltip() { return tooltip; }, set tooltip(nextValue: typeof tooltip) { if (Object.is(tooltip, nextValue)) return; tooltip = nextValue; __readerController.invalidate(); },
get applyHeaderClasses() { return applyHeaderClasses; }, set applyHeaderClasses(nextValue: typeof applyHeaderClasses) { if (Object.is(applyHeaderClasses, nextValue)) return; applyHeaderClasses = nextValue; __readerController.invalidate(); },
get category() { return category; }, set category(nextValue: typeof category) { if (Object.is(category, nextValue)) return; category = nextValue; __readerController.invalidate(); },
get settingId() { return settingId; }, set settingId(nextValue: typeof settingId) { if (Object.is(settingId, nextValue)) return; settingId = nextValue; __readerController.invalidate(); },
get keywords() { return keywords; }, set keywords(nextValue: typeof keywords) { if (Object.is(keywords, nextValue)) return; keywords = nextValue; __readerController.invalidate(); },
get showHeading() { return showHeading; }, set showHeading(nextValue: typeof showHeading) { if (Object.is(showHeading, nextValue)) return; showHeading = nextValue; __readerController.invalidate(); },
get filter() { return filter; },
get visible() { return visible; }, set visible(nextValue: typeof visible) { if (Object.is(visible, nextValue)) return; visible = nextValue; __readerController.invalidate(); },
get headingId() { return headingId; }, set headingId(nextValue: typeof headingId) { if (Object.is(headingId, nextValue)) return; headingId = nextValue; __readerController.invalidate(); },
get $filter() { return $filter; },
updateProps(next: Record<string, unknown>) {
if ('title' in next) api.title = next.title as typeof title;
if ('tooltip' in next && next.tooltip !== undefined) api.tooltip = next.tooltip as typeof tooltip;
if ('applyHeaderClasses' in next && next.applyHeaderClasses !== undefined) api.applyHeaderClasses = next.applyHeaderClasses as typeof applyHeaderClasses;
if ('category' in next && next.category !== undefined) api.category = next.category as typeof category;
if ('settingId' in next && next.settingId !== undefined) api.settingId = next.settingId as typeof settingId;
if ('keywords' in next && next.keywords !== undefined) api.keywords = next.keywords as typeof keywords;
if ('showHeading' in next && next.showHeading !== undefined) api.showHeading = next.showHeading as typeof showHeading;
}
};
return api;
}
