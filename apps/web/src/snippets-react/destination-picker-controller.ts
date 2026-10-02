/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import { resolve } from '$app/paths';
import { sourceDescriptors, type SourceDescriptor } from '../lib/library/catalog';
import { providerLabels, requestDocumentWriteAccess } from '../lib/manabi/client';
import { integrationDB } from '../lib/manabi/persistence';
import { reconnectLocalLibrary } from '../lib/manabi/sources';
import type { Destination, Guard } from '../lib/snippets/database';
import { capability, folders, makeFolder, type StorageCapability } from '../lib/snippets/storage';
import { ReaderController, readerTick, writeStore, type StoreValue } from '../reader-react/controller';

export interface DestinationPickerProps {
initial?: Destination | undefined;
guard: Guard;
choose: (destination: Destination | undefined, remember: boolean) => void;
onwritebusy?: (busy: boolean) => void;
allowDevice?: boolean;
allowUnsetDefault?: boolean;
}

export function createDestinationPicker(props: DestinationPickerProps, emit: (name: string, detail?: unknown) => void = () => {}) {
const __readerController = new ReaderController();
let parent: string;

let initial: Destination | undefined = props.initial !== undefined ? props.initial : undefined;
let guard: Guard = props.guard;
let choose: (destination: Destination | undefined, remember: boolean) => void = props.choose;
let onwritebusy: (busy: boolean) => void = props.onwritebusy !== undefined ? props.onwritebusy : () => undefined;
let allowDevice = props.allowDevice !== undefined ? props.allowDevice : true;
let allowUnsetDefault = props.allowUnsetDefault !== undefined ? props.allowUnsetDefault : false;
let sources: SourceDescriptor[] = [];
let selected: SourceDescriptor | undefined;
let trailNav: HTMLElement | null = null;
let trail: {
    id: string;
    name: string;
}[] = [];
let entries: {
    id: string;
    name: string;
}[] = [];
let capabilities: StorageCapability | undefined;
let remember = false, ready = false, permissionRequired = false, granting = false, busy = false, writeBusy = false, alive = false, error = '', newName = '', generation = 0, writeGeneration = 0;
const identity = (source: SourceDescriptor) => JSON.stringify([source.owner, source.id, source.root]);
const providerName = (provider: string) => providerLabels[provider] ??
    (provider === 'local' ? 'Local folder' : provider === 'webdav' ? 'WebDAV' : provider);
__readerController.effect(() => [trail, selected], () => { __readerController.changed(parent = trail.at(-1)?.id ?? selected?.root ?? ''); });
function setWriteBusy(value: boolean) {
    if (writeBusy === value)
        return;
    __readerController.changed(writeBusy = value);
    onwritebusy(value);
}
function current(run: number) {
    guard();
    if (!alive || run !== generation)
        throw new Error('The destination selection changed.');
}
async function browse(source: SourceDescriptor, path = source.root, name = source.name, reset = false) {
    if (!alive)
        return;
    const run = __readerController.changed(++generation);
    // A failed switch must never leave the previous source's write capability active.
    __readerController.changed(selected = source);
    __readerController.changed(trail = reset
        ? [
            { id: source.root, name: source.name },
            ...(path !== source.root ? [{ id: path, name }] : [])
        ]
        : [...trail, { id: path, name }]);
    __readerController.changed(capabilities = undefined);
    __readerController.changed(entries = []);
    __readerController.changed(ready = false);
    __readerController.changed(permissionRequired = false);
    __readerController.changed(busy = true);
    __readerController.changed(error = '');
    const check = () => current(run);
    try {
        check();
        const cap = await capability(source, check);
        check();
        __readerController.changed(capabilities = cap);
        const children = await folders(source, path, check);
        check();
        __readerController.changed(entries = children);
        __readerController.changed(ready = true);
    }
    catch (reason) {
        if (alive && run === generation) {
            __readerController.changed(permissionRequired =
                source.provider === 'local' &&
                    reason instanceof Error &&
                    (('code' in reason && reason.code === 'permission_required') ||
                        reason.name === 'NotAllowedError'));
            __readerController.changed(error = reason instanceof Error ? reason.message : 'Cannot browse this source.');
        }
    }
    finally {
        if (alive && run === generation)
            __readerController.changed(busy = false);
    }
}
async function navigate(source: SourceDescriptor, path: string, name: string) {
    await browse(source, path, name);
    if (!alive)
        return;
    await readerTick();
    if (!alive)
        return;
    trailNav
        ?.querySelector<HTMLButtonElement>('button:last-of-type')
        ?.focus({ preventScroll: true });
}
async function grant() {
    if (!alive || !selected || busy)
        return;
    const source = selected, path = parent, name = trail.at(-1)?.name ?? source.name;
    const run = __readerController.changed(++generation), check = () => current(run);
    const writeRun = __readerController.changed(++writeGeneration);
    __readerController.changed(busy = true);
    __readerController.changed(granting = true);
    setWriteBusy(true);
    __readerController.changed(error = '');
    try {
        check();
        if (source.owner) {
            if (!['google', 'dropbox', 'onedrive'].includes(source.provider))
                throw new Error('This provider does not support document writes.');
            await requestDocumentWriteAccess(source.provider, source.id);
            check();
        }
        else if (source.provider === 'local') {
            const entry = await (await integrationDB()).get('localLibraries', source.id);
            check();
            if (!entry)
                throw new Error('Reconnect this folder.');
            await reconnectLocalLibrary(entry, true);
            check();
            await browse(source, path, name, true);
        }
    }
    catch (reason) {
        if (alive && run === generation)
            __readerController.changed(error = reason instanceof Error ? reason.message : 'Permission could not be granted.');
    }
    finally {
        __readerController.changed(granting = false);
        if (alive && run === generation)
            __readerController.changed(busy = false);
        if (writeRun === writeGeneration)
            setWriteBusy(false);
    }
}
async function mkdir() {
    if (!alive || !selected || !ready || !capabilities?.write || !newName.trim() || busy)
        return;
    const source = selected, path = parent, name = newName.trim();
    const run = __readerController.changed(++generation), check = () => current(run);
    const writeRun = __readerController.changed(++writeGeneration);
    __readerController.changed(busy = true);
    setWriteBusy(true);
    __readerController.changed(error = '');
    try {
        const id = await makeFolder({ source, parent: path }, name, check);
        check();
        await navigate(source, id, name);
        if (alive && selected === source && parent === id && ready)
            __readerController.changed(newName = '');
    }
    catch (reason) {
        if (alive && run === generation)
            __readerController.changed(error = reason instanceof Error ? reason.message : 'The folder could not be created.');
    }
    finally {
        if (alive && run === generation)
            __readerController.changed(busy = false);
        if (writeRun === writeGeneration)
            setWriteBusy(false);
    }
}
function useFolder() {
    if (!alive || !selected || !ready || busy || !capabilities?.write)
        return;
    try {
        guard();
        choose({ source: selected, parent }, remember);
    }
    catch (reason) {
        __readerController.changed(error = reason instanceof Error ? reason.message : 'The destination is unavailable.');
    }
}
__readerController.onMount(() => {
    __readerController.changed(alive = true);
    let live = true;
    void (async () => {
        try {
            const found = await sourceDescriptors();
            guard();
            if (!live)
                return;
            __readerController.changed(sources = found);
            const original = initial && found.find((source) => identity(source) === identity(initial!.source));
            if (original)
                await browse(original, initial!.parent, initial!.parent || original.name, true);
            else if (sources.length === 1)
                await browse(sources[0], sources[0].root, sources[0].name, true);
        }
        catch (reason) {
            if (live)
                __readerController.changed(error = reason instanceof Error ? reason.message : 'Cannot load destinations.');
        }
    })();
    return () => {
        live = false;
        __readerController.changed(alive = false);
        __readerController.changed(generation++);
        setWriteBusy(false);
    };
});

const api = { controller: __readerController, setWriteBusy, current, browse, navigate, grant, mkdir, useFolder,
get initial() { return initial; }, set initial(nextValue: typeof initial) { if (Object.is(initial, nextValue)) return; initial = nextValue; __readerController.invalidate(); },
get guard() { return guard; }, set guard(nextValue: typeof guard) { if (Object.is(guard, nextValue)) return; guard = nextValue; __readerController.invalidate(); },
get choose() { return choose; }, set choose(nextValue: typeof choose) { if (Object.is(choose, nextValue)) return; choose = nextValue; __readerController.invalidate(); },
get onwritebusy() { return onwritebusy; }, set onwritebusy(nextValue: typeof onwritebusy) { if (Object.is(onwritebusy, nextValue)) return; onwritebusy = nextValue; __readerController.invalidate(); },
get allowDevice() { return allowDevice; }, set allowDevice(nextValue: typeof allowDevice) { if (Object.is(allowDevice, nextValue)) return; allowDevice = nextValue; __readerController.invalidate(); },
get allowUnsetDefault() { return allowUnsetDefault; }, set allowUnsetDefault(nextValue: typeof allowUnsetDefault) { if (Object.is(allowUnsetDefault, nextValue)) return; allowUnsetDefault = nextValue; __readerController.invalidate(); },
get sources() { return sources; }, set sources(nextValue: typeof sources) { if (Object.is(sources, nextValue)) return; sources = nextValue; __readerController.invalidate(); },
get selected() { return selected; }, set selected(nextValue: typeof selected) { if (Object.is(selected, nextValue)) return; selected = nextValue; __readerController.invalidate(); },
get trailNav() { return trailNav; }, set trailNav(nextValue: typeof trailNav) { if (Object.is(trailNav, nextValue)) return; trailNav = nextValue; __readerController.invalidate(); },
get trail() { return trail; }, set trail(nextValue: typeof trail) { if (Object.is(trail, nextValue)) return; trail = nextValue; __readerController.invalidate(); },
get entries() { return entries; }, set entries(nextValue: typeof entries) { if (Object.is(entries, nextValue)) return; entries = nextValue; __readerController.invalidate(); },
get capabilities() { return capabilities; }, set capabilities(nextValue: typeof capabilities) { if (Object.is(capabilities, nextValue)) return; capabilities = nextValue; __readerController.invalidate(); },
get remember() { return remember; }, set remember(nextValue: typeof remember) { if (Object.is(remember, nextValue)) return; remember = nextValue; __readerController.invalidate(); },
get ready() { return ready; }, set ready(nextValue: typeof ready) { if (Object.is(ready, nextValue)) return; ready = nextValue; __readerController.invalidate(); },
get permissionRequired() { return permissionRequired; }, set permissionRequired(nextValue: typeof permissionRequired) { if (Object.is(permissionRequired, nextValue)) return; permissionRequired = nextValue; __readerController.invalidate(); },
get granting() { return granting; }, set granting(nextValue: typeof granting) { if (Object.is(granting, nextValue)) return; granting = nextValue; __readerController.invalidate(); },
get busy() { return busy; }, set busy(nextValue: typeof busy) { if (Object.is(busy, nextValue)) return; busy = nextValue; __readerController.invalidate(); },
get writeBusy() { return writeBusy; }, set writeBusy(nextValue: typeof writeBusy) { if (Object.is(writeBusy, nextValue)) return; writeBusy = nextValue; __readerController.invalidate(); },
get alive() { return alive; }, set alive(nextValue: typeof alive) { if (Object.is(alive, nextValue)) return; alive = nextValue; __readerController.invalidate(); },
get error() { return error; }, set error(nextValue: typeof error) { if (Object.is(error, nextValue)) return; error = nextValue; __readerController.invalidate(); },
get newName() { return newName; }, set newName(nextValue: typeof newName) { if (Object.is(newName, nextValue)) return; newName = nextValue; __readerController.invalidate(); },
get generation() { return generation; }, set generation(nextValue: typeof generation) { if (Object.is(generation, nextValue)) return; generation = nextValue; __readerController.invalidate(); },
get writeGeneration() { return writeGeneration; }, set writeGeneration(nextValue: typeof writeGeneration) { if (Object.is(writeGeneration, nextValue)) return; writeGeneration = nextValue; __readerController.invalidate(); },
get identity() { return identity; },
get providerName() { return providerName; },
get parent() { return parent; }, set parent(nextValue: typeof parent) { if (Object.is(parent, nextValue)) return; parent = nextValue; __readerController.invalidate(); },
updateProps(next: Record<string, unknown>) {
if ('initial' in next) api.initial = (next.initial === undefined ? undefined : next.initial) as typeof initial;
if ('guard' in next) api.guard = next.guard as typeof guard;
if ('choose' in next) api.choose = next.choose as typeof choose;
if ('onwritebusy' in next) api.onwritebusy = (next.onwritebusy === undefined ? () => undefined : next.onwritebusy) as typeof onwritebusy;
if ('allowDevice' in next) api.allowDevice = (next.allowDevice === undefined ? true : next.allowDevice) as typeof allowDevice;
if ('allowUnsetDefault' in next) api.allowUnsetDefault = (next.allowUnsetDefault === undefined ? false : next.allowUnsetDefault) as typeof allowUnsetDefault;
}
};
return api;
}
