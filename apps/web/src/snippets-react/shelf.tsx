/** @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors. All rights reserved. */
import React from 'react';
import { useReaderController, readerTick } from '../reader-react/controller';
import { Dom, SurfaceEvents, Head, Icon, Button, Input, AppNav, DynamicComponent, Dialog, Menu, ReaderScope, useLatest, useReaderBindings, type ReaderViewProps } from './primitives';
import { createShelf, type ShelfProps } from './shelf-controller';
import { resolve } from '$app/paths';
import { page } from '$app/stores';
import { snippetItems, scope } from '../lib/snippets/service';
import { fold, snippetKey, snippetSearchTooLong, type SnippetHit } from '../lib/snippets/document';
import { searchBodies } from '../lib/snippets/search';
import { saveLabel } from '../lib/snippets/presentation';
import type { SnippetSummary } from '../lib/snippets/summary';



export function Shelf(props: ShelfProps & ReaderViewProps) {
const latest = useLatest(props);
const c = useReaderController(() => createShelf(props as ShelfProps, (name, detail) => latest.current.events?.[name]?.({ detail })), props);
useReaderBindings(c, props);
if (!c) return null;
return <ReaderScope name="react-snippets-shelf">
{(snippetSearchTooLong(c.query)) ? <><Dom scopeClass="snippet-scope-shelf" as="p" id={"snippet-search-limit-error"}
role={"alert"}>{" Use a search of 512 characters or fewer. "}</Dom></> : null}
{(c.searching) ? <><Dom scopeClass="snippet-scope-shelf" as="p" role={"status"}
className={["search-note"].filter(Boolean).join(' ')}>{" Searching snippet contents… Title matches are ready. "}</Dom></> : null}
{(c.failed) ? <><Dom scopeClass="snippet-scope-shelf" as="p" role={"status"}
className={["search-note"].filter(Boolean).join(' ')}>{" Some snippet contents could not be searched. Title matches are still available. "}</Dom></> : null}
<Dom scopeClass="snippet-scope-shelf" as="div" role={"list"}
aria-label={c.query ? 'Snippet search results' : 'Snippets'}
className={[(c.layout === 'grid') && "grid", "snippet-shelf"].filter(Boolean).join(' ')}>
{(c.visible.slice(0, c.limit) ?? []).length ? (c.visible.slice(0, c.limit) ?? []).map((item, index0) => <React.Fragment key={item.key}><Dom scopeClass="snippet-scope-shelf" as="div" role={"listitem"}
className={["snippet-card", (c.selected.has(item.id)) && "selected"].filter(Boolean).join(' ')}>
{(c.selecting) ? <><Dom scopeClass="snippet-scope-shelf" as="label" className={["select"].filter(Boolean).join(' ')}><Dom scopeClass="snippet-scope-shelf" as="input" type={"checkbox"}
checked={c.selected.has(item.id)}
aria-label={`Select ${item.title}`}
onChange={() => {
    const next = new Set(c.selected);
    if (next.has(item.id))
        next.delete(item.id);
    else
        next.add(item.id);
    c.anchor = item.id;
    c.onselect([...next]);
}}
className={["size-5 accent-primary"].filter(Boolean).join(' ')} /></Dom></> : null}
<Dom scopeClass="snippet-scope-shelf" as="div" className={["content"].filter(Boolean).join(' ')}>
<Dom scopeClass="snippet-scope-shelf" as="a" href={resolve(c.url(item))}
onClick={(event) => c.choose(event, item)}
className={["title"].filter(Boolean).join(' ')}>{item.title}</Dom>
<Dom scopeClass="snippet-scope-shelf" as="p" className={["excerpt"].filter(Boolean).join(' ')}>{item.excerpt || 'Empty snippet'}</Dom>
<Dom scopeClass="snippet-scope-shelf" as="p" className={["metadata"].filter(Boolean).join(' ')}>
<Dom scopeClass="snippet-scope-shelf" as="span" >{new Date(item.modifiedAt).toLocaleDateString()}</Dom><Dom scopeClass="snippet-scope-shelf" as="span" >{saveLabel(item)}</Dom>{(item.destination) ? <><Dom scopeClass="snippet-scope-shelf" as="span" >{item.destination.source.name}</Dom></> : null}
</Dom>
{(item.issue) ? <><Dom scopeClass="snippet-scope-shelf" as="p" className={["issue"].filter(Boolean).join(' ')}>{item.issue}</Dom></> : null}
{(c.hits.get(item.id) ?? []).length ? (c.hits.get(item.id) ?? []).map((hit, index) => <React.Fragment key={`${item.revision}:${index}`}><Dom scopeClass="snippet-scope-shelf" as="a" href={resolve(c.url(item, hit))}
onClick={(event) => c.choose(event, item)}
className={["passage"].filter(Boolean).join(' ')}>{hit.excerpt}{(hit.reading) ? <><Dom scopeClass="snippet-scope-shelf" as="span" className={["reading-label"].filter(Boolean).join(' ')}>{"Furigana match"}</Dom></> : null}</Dom></React.Fragment>) : null}
</Dom>
</Dom></React.Fragment>) : <> {(c.showEmpty) ? <><Dom scopeClass="snippet-scope-shelf" as="p" className={["empty"].filter(Boolean).join(' ')}>
{c.searching ? 'Searching…'
    : c.query ? 'No matching snippets.'
        : c.trashed ? 'Trash is empty.'
            : 'No snippets here yet. Create one or refresh your connected libraries.'}
</Dom></> : null}</>}
</Dom>
{(c.visible.length > c.limit) ? <><Button  variant={"ghost"}
onClick={() => (c.limit += 60)}>{"Show more snippets"}</Button></> : null}
{(c.truncated) ? <><Dom scopeClass="snippet-scope-shelf" as="p" role={"status"}>{" Showing the first 1,000 matching snippets. Refine your search for more specific results. "}</Dom></> : null}
</ReaderScope>;
}
