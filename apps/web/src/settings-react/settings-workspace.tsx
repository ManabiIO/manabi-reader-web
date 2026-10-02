/** @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors. All rights reserved. */
import React from 'react';
import { useReaderController, readerTick } from '../reader-react/controller';
import { Dom, SurfaceEvents, Head, Icon, AppIcon, Button, Input, Switch, Field, Popover, DialogTemplate, ActionMenu, AppNav, Menu, useLatest, useReaderBindings, slotContent, Slot, type ReaderViewProps } from './primitives';
import { SettingsContext, useSettingsContext } from './context';
import { createSettingsWorkspace, type SettingsWorkspaceProps } from './settings-workspace-controller';
import { afterNavigate, goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { SETTINGS_FILTER } from '../lib/components/settings/settings-context';
import { SettingsOfflineStatus } from './settings-offline-status';
import { SettingsItemGroup } from './settings-item-group';
import { PageTurnEffectSelect } from './page-turn-effect-select';
export function SettingsWorkspace(props: Partial<SettingsWorkspaceProps> & ReaderViewProps & {
    children?: React.ReactNode;
    onClose?: () => void;
    slot?: string;
}) {
    const latest = useLatest(props);
    const context = useSettingsContext();
    const c = useReaderController(() => createSettingsWorkspace(props as SettingsWorkspaceProps, (name, detail) => { latest.current.events?.[name]?.({ detail }); if (name === 'close')
        latest.current.onClose?.(); }, context), props);
    useReaderBindings(c, props);
    if (!c)
        return null;
    return <SettingsContext.Provider value={context}><div className="react-settings-settings-workspace" style={{ display: 'contents' }}>
    <Dom as="div" elementRef={(value: typeof c.root) => { c.controller.changed(c.root = value); }} className={["settings-workspace grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]"].filter(Boolean).join(' ')}>
    <Dom as="aside" aria-label={"Settings sections"} className={["min-w-0 self-start lg:sticky lg:top-20"].filter(Boolean).join(' ')}>
    <Dom as="label" htmlFor={"settings-search"} className={["mb-2 block text-sm font-medium"].filter(Boolean).join(' ')}>{"Search settings"}</Dom>
    <Input id={"settings-search"} aria-describedby={c.$filter.query ? 'settings-search-results' : undefined} type={"search"} placeholder={"Search all settings…"} value={c.$filter.query} onInput={(event: React.FormEvent<HTMLInputElement>) => c.filter.update((value) => ({ ...value, query: event.currentTarget.value }))}></Input>
    <Dom as="nav" aria-label={"Settings categories"} className={["section-navigation section-navigation-sidebar mt-3"].filter(Boolean).join(' ')}>
        {(c.categories ?? []).map((category, index0) => <React.Fragment key={category.id}><Button href={`#${category.id}`} variant={"ghost"} shape={"rounded"} data-section-link={true} aria-current={c.$filter.category === category.id && !c.$filter.query ? 'page' : undefined} onClick={(event: MouseEvent & { currentTarget: HTMLAnchorElement }) => c.handleCategoryClick(event, category.id)} className={["justify-start"].filter(Boolean).join(' ')}>{category.label}</Button></React.Fragment>)}
    </Dom>
    </Dom>
    <Dom as="main" id={"settings-content"} className={["min-w-0"].filter(Boolean).join(' ')}>
    <Dom as="div" className={["mb-5"].filter(Boolean).join(' ')}>
    <Dom as="h1" className={["text-2xl font-semibold tracking-tight"].filter(Boolean).join(' ')}>
    {c.$filter.query ? 'Search results' : c.selected.label}
    </Dom>
    <Dom as="p" className={["mt-1 text-sm text-muted-foreground"].filter(Boolean).join(' ')}>
    {c.$filter.query ? 'Results across every settings section.' : c.selected.description}
    </Dom>
    <Dom as="p" className={["mt-2 text-xs text-muted-foreground"].filter(Boolean).join(' ')}>{" Changes save automatically. Reading goals have separate Save and Cancel actions. "}</Dom>
        {(c.$filter.query) ? <><Dom as="p" id={"settings-search-results"} role={"status"} aria-label={"Settings search results"} className={["mt-3 text-sm"].filter(Boolean).join(' ')}>
            {c.visibleCount ? `${c.visibleCount} matching settings`
                : 'No matching settings. Try a different search.'}
        </Dom></> : null}
    </Dom>
    <SettingsOfflineStatus></SettingsOfflineStatus>
    <SettingsItemGroup settingId={"page-turn-effect"} category={"layout"} keywords={"pageTurnEffect slide none animation pagination"} title={"Page turn effect"} showHeading={false}>
    <PageTurnEffectSelect></PageTurnEffectSelect>
    </SettingsItemGroup>
    {slotContent(props.children, undefined)}
    </Dom>
    </Dom>
    </div></SettingsContext.Provider>;
}
