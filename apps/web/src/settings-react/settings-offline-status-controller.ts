/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import { base } from '$app/paths';
import { getOfflineStatus, type OfflineStatus } from '$lib/service-worker/offline-status.mjs';
import { ReaderController, readerTick, writeStore, type StoreValue } from '../reader-react/controller';
import { type SettingsContextValue } from './context';

import { SettingsItemGroup } from './settings-item-group';

export interface SettingsOfflineStatusProps {

}

export function createSettingsOfflineStatus(props: SettingsOfflineStatusProps, emit: (name: string, detail?: unknown) => void = () => {}, componentContext: SettingsContextValue) {
const __readerController = new ReaderController();


let status: OfflineStatus = { state: 'unknown', updateWaiting: false };
let checking = true;
const labels = {
    ready: 'App ready for offline reopening',
    incomplete: 'Offline app files are incomplete',
    unavailable: 'Offline storage is unavailable',
    preparing: 'Preparing offline app files',
    unsupported: 'Offline reopening is unavailable in this browser',
    unknown: 'Offline readiness has not been confirmed'
};
__readerController.onMount(() => {
    let stopped = false;
    let pending = false;
    const controller = new AbortController();
    let workers: ServiceWorkerContainer | undefined;
    try {
        workers = navigator.serviceWorker;
    }
    catch {
        // Some privacy/security configurations deny access even to the getter.
    }
    const refresh = async () => {
        if (stopped || pending || document.visibilityState !== 'visible')
            return;
        pending = true;
        try {
            const result = await getOfflineStatus(workers, new URL(`${base}/`, location.origin).href, {
                signal: controller.signal
            });
            if (!stopped) {
                __readerController.changed(status = result);
                __readerController.changed(checking = false);
            }
        }
        finally {
            pending = false;
        }
    };
    void refresh();
    // This inspector exists only while Settings is mounted. It never registers
    // or updates workers and never blocks Library/Reader startup.
    const timer = setInterval(() => void refresh(), 15000);
    const changed = () => void refresh();
    window.addEventListener('online', changed);
    document.addEventListener('visibilitychange', changed);
    workers?.addEventListener('controllerchange', changed);
    return () => {
        stopped = true;
        controller.abort();
        clearInterval(timer);
        window.removeEventListener('online', changed);
        document.removeEventListener('visibilitychange', changed);
        workers?.removeEventListener('controllerchange', changed);
    };
});

const api = { controller: __readerController, 
get status() { return status; }, set status(nextValue: typeof status) { if (Object.is(status, nextValue)) return; status = nextValue; __readerController.invalidate(); },
get checking() { return checking; }, set checking(nextValue: typeof checking) { if (Object.is(checking, nextValue)) return; checking = nextValue; __readerController.invalidate(); },
get labels() { return labels; },
updateProps(next: Record<string, unknown>) {

}
};
return api;
}
