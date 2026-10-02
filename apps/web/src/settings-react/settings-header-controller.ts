/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { ReaderController, readerTick, writeStore, type StoreValue } from '../reader-react/controller';
import { type SettingsContextValue } from './context';


const AppNav = 'AppNav';
const Button = 'Button';
const CaretLeftIcon = 'CaretLeftIcon';
export interface SettingsHeaderProps {
leavePageLink: string;
}

export function createSettingsHeader(props: SettingsHeaderProps, emit: (name: string, detail?: unknown) => void = () => {}, componentContext: SettingsContextValue) {
const __readerController = new ReaderController();


let leavePageLink: string = props.leavePageLink;

const api = { controller: __readerController, 
get leavePageLink() { return leavePageLink; }, set leavePageLink(nextValue: typeof leavePageLink) { if (Object.is(leavePageLink, nextValue)) return; leavePageLink = nextValue; __readerController.invalidate(); },
updateProps(next: Record<string, unknown>) {
if ('leavePageLink' in next) api.leavePageLink = next.leavePageLink as typeof leavePageLink;
}
};
return api;
}
