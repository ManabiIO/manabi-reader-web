/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import { readerHTML } from '../lib/snippets/presentation';
import { displayTitle, passages, resolveLocator, type SnippetDocument, type SnippetLocator } from '../lib/snippets/document';
import { saveProgress, syncReading, touchReading } from '../lib/snippets/reading-state';
import { getRecord } from '../lib/snippets/database';
import type { SnippetScope } from '../lib/snippets/scope';
import { ReaderController, readerTick, writeStore, type StoreValue } from '../reader-react/controller';

export interface ReaderProps {
document: SnippetDocument;
selectedScope: SnippetScope;
locator?: SnippetLocator | undefined;
followRemotePosition?: boolean;
}

export function createReader(props: ReaderProps, emit: (name: string, detail?: unknown) => void = () => {}) {
const __readerController = new ReaderController();
let html: string;
let incomingLocator: string;

let document: SnippetDocument = props.document;
let selectedScope: SnippetScope = props.selectedScope;
let locator: SnippetLocator | undefined = props.locator !== undefined ? props.locator : undefined;
/** Explicit search/navigation locators must not be replaced by background reading-state hydration. */
let followRemotePosition = props.followRemotePosition !== undefined ? props.followRemotePosition : true;
let host: HTMLElement, notice = '', fontSize = 20, vertical = false, ready = false, pendingPosition: SnippetLocator | undefined, timer: ReturnType<typeof setTimeout> | undefined, intentTimer: ReturnType<typeof setTimeout> | undefined, appliedLocator = '', committedLocator = '', userScrollIntent = false, mountedAlive = false, restoreGeneration = 0, hydrating = false, lastHydration = 0;
__readerController.effect(() => [document], () => { __readerController.changed(html = readerHTML(document.content)); });
__readerController.effect(() => [locator], () => { __readerController.changed(incomingLocator = locator ? JSON.stringify(locator) : ''); });
__readerController.effect(() => [ready, incomingLocator, userScrollIntent, pendingPosition, committedLocator, locator, followRemotePosition], () => { if (ready && incomingLocator && incomingLocator !== appliedLocator) {
    // A newer remote cursor must not yank the view while the user is actively
    // scrolling. Their next durable position becomes authoritative instead.
    if (userScrollIntent || pendingPosition || incomingLocator === committedLocator)
        __readerController.changed(appliedLocator = incomingLocator);
    else
        void restore(locator, incomingLocator, followRemotePosition);
} });
const cssEscape = (id: string) => CSS.escape(id);
const locatorSignature = (value: SnippetLocator | undefined) => value ? JSON.stringify(value) : '';
async function restore(value: SnippetLocator | undefined, signature = locatorSignature(value), respectUserIntent = false) {
    if (!value || !host)
        return;
    const generation = __readerController.changed(++restoreGeneration);
    await readerTick();
    if (!mountedAlive ||
        generation !== restoreGeneration ||
        !host ||
        (respectUserIntent && (userScrollIntent || pendingPosition)))
        return;
    const resolved = resolveLocator(document, value);
    host
        .querySelectorAll('.snippet-match')
        .forEach((node) => node.classList.remove('snippet-match'));
    __readerController.changed(appliedLocator = signature);
    __readerController.changed(userScrollIntent = false);
    __readerController.changed(pendingPosition = undefined);
    clearTimeout(timer);
    clearTimeout(intentTimer);
    if (resolved) {
        const target = host.querySelector<HTMLElement>(`[data-id="${cssEscape(resolved.blockId)}"]`);
        target?.scrollIntoView({ block: 'center' });
        target?.classList.add('snippet-match');
        __readerController.changed(notice = '');
    }
    else
        __readerController.changed(notice = 'The saved passage changed. Showing the current snippet instead.');
}
function capture() {
    selectedScope.guard();
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount)
        return;
    const range = selection.getRangeAt(0);
    if (!host.contains(range.commonAncestorContainer))
        return;
    const fragment = range.cloneContents();
    const wrapper = window.document.createElement('div');
    wrapper.append(fragment);
    window.dispatchEvent(new CustomEvent('manabi-capture-snippet', {
        detail: {
            html: wrapper.innerHTML,
            title: displayTitle(document),
            item: `snippet:${document.id}`,
            owner: selectedScope.owner === 'local' ? null : selectedScope.owner.slice(8)
        }
    }));
}
function position() {
    if (!host || !ready)
        return;
    const blocks = passages(document.content), candidates = Array.from(host.querySelectorAll<HTMLElement>('p[data-id],h1[data-id],h2[data-id],h3[data-id],h4[data-id],h5[data-id],h6[data-id],pre[data-id]'));
    const at = candidates.find((node) => {
        const r = node.getBoundingClientRect();
        const frame = host.getBoundingClientRect();
        return vertical
            ? r.right > Math.max(0, frame.left) && r.left < Math.min(innerWidth, frame.right)
            : r.bottom > 80 && r.top < innerHeight;
    }) ?? candidates[0];
    const block = blocks.find((x) => x.blockId === at?.dataset.id);
    if (!block)
        return;
    __readerController.changed(pendingPosition = {
        blockId: block.blockId,
        quote: block.text.slice(0, 80),
        before: '',
        offset: 0,
        revision: document.revision
    });
}
function commitPosition() {
    const value = pendingPosition;
    __readerController.changed(pendingPosition = undefined);
    __readerController.changed(userScrollIntent = false);
    clearTimeout(intentTimer);
    if (value) {
        // Keep the old parent locator acknowledged until the local write reaches
        // the summary. Otherwise it can be restored between commit and that write.
        __readerController.changed(committedLocator = locatorSignature(value));
        void saveProgress(document.id, value, selectedScope).catch(() => undefined);
    }
}
function schedule() {
    // Programmatic scrollIntoView, layout changes and resize restoration are not
    // reading intent. A user input must arm position capture first.
    if (!userScrollIntent)
        return;
    position();
    if (!pendingPosition)
        return;
    clearTimeout(timer);
    __readerController.changed(timer = setTimeout(commitPosition, 600));
}
function markUserScrollIntent(event: Event) {
    if (!ready)
        return;
    if (event instanceof KeyboardEvent) {
        const target = event.target;
        if (target instanceof Element &&
            target.closest('button,input,textarea,select,[contenteditable="true"]'))
            return;
        if (!['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key))
            return;
    }
    if (event instanceof PointerEvent && event.target !== host)
        return;
    __readerController.changed(userScrollIntent = true);
    clearTimeout(intentTimer);
    // A gesture at the scroll boundary may never emit scroll. Do not let it
    // suppress remote hydration for the rest of this reader session.
    __readerController.changed(intentTimer = setTimeout(() => {
        if (!pendingPosition)
            __readerController.changed(userScrollIntent = false);
    }, 1200));
}
async function hydrateRemotePosition(force = false) {
    if (hydrating ||
        !mountedAlive ||
        !ready ||
        !followRemotePosition ||
        userScrollIntent ||
        pendingPosition ||
        (!force && Date.now() - lastHydration < 60000))
        return;
    __readerController.changed(hydrating = true);
    __readerController.changed(lastHydration = Date.now());
    try {
        await syncReading(document.id, selectedScope);
        selectedScope.guard();
        const latest = await getRecord(selectedScope.owner, document.id);
        selectedScope.guard();
        if (!mountedAlive ||
            !followRemotePosition ||
            userScrollIntent ||
            pendingPosition ||
            !latest?.progress)
            return;
        const signature = locatorSignature(latest.progress);
        if (signature !== appliedLocator)
            await restore(latest.progress, signature, true);
    }
    catch {
        // Retain the current view. Online/focus or an explicit refresh can retry.
    }
    finally {
        __readerController.changed(hydrating = false);
    }
}
__readerController.onMount(() => {
    __readerController.changed(mountedAlive = true);
    void restore(locator).then(() => {
        if (!mountedAlive)
            return;
        void touchReading(document.id, selectedScope).catch(() => undefined);
        __readerController.changed(ready = true);
        // loadRoute already attempted a remote refresh; avoid immediately duplicating it.
        __readerController.changed(lastHydration = Date.now());
    });
    const onOnline = () => void hydrateRemotePosition(true);
    const onFocus = () => void hydrateRemotePosition(false);
    window.addEventListener('scroll', schedule, { passive: true });
    host.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('wheel', markUserScrollIntent, { passive: true });
    window.addEventListener('touchstart', markUserScrollIntent, { passive: true });
    window.addEventListener('keydown', markUserScrollIntent);
    window.addEventListener('online', onOnline);
    window.addEventListener('focus', onFocus);
    host.addEventListener('pointerdown', markUserScrollIntent, { passive: true });
    return () => {
        __readerController.changed(mountedAlive = false);
        __readerController.changed(restoreGeneration++);
        clearTimeout(timer);
        clearTimeout(intentTimer);
        commitPosition(); // Keep the last deliberate scroll when the reader closes before the debounce.
        window.removeEventListener('scroll', schedule);
        host?.removeEventListener('scroll', schedule);
        window.removeEventListener('wheel', markUserScrollIntent);
        window.removeEventListener('touchstart', markUserScrollIntent);
        window.removeEventListener('keydown', markUserScrollIntent);
        window.removeEventListener('online', onOnline);
        window.removeEventListener('focus', onFocus);
        host?.removeEventListener('pointerdown', markUserScrollIntent);
    };
});

const api = { controller: __readerController, restore, capture, position, commitPosition, schedule, markUserScrollIntent, hydrateRemotePosition,
get document() { return document; }, set document(nextValue: typeof document) { if (Object.is(document, nextValue)) return; document = nextValue; __readerController.invalidate(); },
get selectedScope() { return selectedScope; }, set selectedScope(nextValue: typeof selectedScope) { if (Object.is(selectedScope, nextValue)) return; selectedScope = nextValue; __readerController.invalidate(); },
get locator() { return locator; }, set locator(nextValue: typeof locator) { if (Object.is(locator, nextValue)) return; locator = nextValue; __readerController.invalidate(); },
get followRemotePosition() { return followRemotePosition; }, set followRemotePosition(nextValue: typeof followRemotePosition) { if (Object.is(followRemotePosition, nextValue)) return; followRemotePosition = nextValue; __readerController.invalidate(); },
get host() { return host; }, set host(nextValue: typeof host) { if (Object.is(host, nextValue)) return; host = nextValue; __readerController.invalidate(); },
get notice() { return notice; }, set notice(nextValue: typeof notice) { if (Object.is(notice, nextValue)) return; notice = nextValue; __readerController.invalidate(); },
get fontSize() { return fontSize; }, set fontSize(nextValue: typeof fontSize) { if (Object.is(fontSize, nextValue)) return; fontSize = nextValue; __readerController.invalidate(); },
get vertical() { return vertical; }, set vertical(nextValue: typeof vertical) { if (Object.is(vertical, nextValue)) return; vertical = nextValue; __readerController.invalidate(); },
get ready() { return ready; }, set ready(nextValue: typeof ready) { if (Object.is(ready, nextValue)) return; ready = nextValue; __readerController.invalidate(); },
get pendingPosition() { return pendingPosition; }, set pendingPosition(nextValue: typeof pendingPosition) { if (Object.is(pendingPosition, nextValue)) return; pendingPosition = nextValue; __readerController.invalidate(); },
get timer() { return timer; }, set timer(nextValue: typeof timer) { if (Object.is(timer, nextValue)) return; timer = nextValue; __readerController.invalidate(); },
get intentTimer() { return intentTimer; }, set intentTimer(nextValue: typeof intentTimer) { if (Object.is(intentTimer, nextValue)) return; intentTimer = nextValue; __readerController.invalidate(); },
get appliedLocator() { return appliedLocator; }, set appliedLocator(nextValue: typeof appliedLocator) { if (Object.is(appliedLocator, nextValue)) return; appliedLocator = nextValue; __readerController.invalidate(); },
get committedLocator() { return committedLocator; }, set committedLocator(nextValue: typeof committedLocator) { if (Object.is(committedLocator, nextValue)) return; committedLocator = nextValue; __readerController.invalidate(); },
get userScrollIntent() { return userScrollIntent; }, set userScrollIntent(nextValue: typeof userScrollIntent) { if (Object.is(userScrollIntent, nextValue)) return; userScrollIntent = nextValue; __readerController.invalidate(); },
get mountedAlive() { return mountedAlive; }, set mountedAlive(nextValue: typeof mountedAlive) { if (Object.is(mountedAlive, nextValue)) return; mountedAlive = nextValue; __readerController.invalidate(); },
get restoreGeneration() { return restoreGeneration; }, set restoreGeneration(nextValue: typeof restoreGeneration) { if (Object.is(restoreGeneration, nextValue)) return; restoreGeneration = nextValue; __readerController.invalidate(); },
get hydrating() { return hydrating; }, set hydrating(nextValue: typeof hydrating) { if (Object.is(hydrating, nextValue)) return; hydrating = nextValue; __readerController.invalidate(); },
get lastHydration() { return lastHydration; }, set lastHydration(nextValue: typeof lastHydration) { if (Object.is(lastHydration, nextValue)) return; lastHydration = nextValue; __readerController.invalidate(); },
get cssEscape() { return cssEscape; },
get locatorSignature() { return locatorSignature; },
get html() { return html; }, set html(nextValue: typeof html) { if (Object.is(html, nextValue)) return; html = nextValue; __readerController.invalidate(); },
get incomingLocator() { return incomingLocator; }, set incomingLocator(nextValue: typeof incomingLocator) { if (Object.is(incomingLocator, nextValue)) return; incomingLocator = nextValue; __readerController.invalidate(); },
updateProps(next: Record<string, unknown>) {
if ('document' in next) api.document = next.document as typeof document;
if ('selectedScope' in next) api.selectedScope = next.selectedScope as typeof selectedScope;
if ('locator' in next) api.locator = (next.locator === undefined ? undefined : next.locator) as typeof locator;
if ('followRemotePosition' in next) api.followRemotePosition = (next.followRemotePosition === undefined ? true : next.followRemotePosition) as typeof followRemotePosition;
}
};
return api;
}
