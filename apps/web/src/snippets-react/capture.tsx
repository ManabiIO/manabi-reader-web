/** @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors. All rights reserved. */
import React from 'react';
import { useReaderController, readerTick } from '../reader-react/controller';
import { Dom, SurfaceEvents, Head, Icon, Button, Input, AppNav, DynamicComponent, Dialog, Menu, ReaderScope, useLatest, useReaderBindings, type ReaderViewProps } from './primitives';
import { createCapture, type CaptureProps } from './capture-controller';
import { localUser } from '../lib/manabi/client';
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { scope, snippetItems, flushSnippets, appendToSnippet } from '../lib/snippets/service';
import { saveDraft, deleteDraft, recordKey } from '../lib/snippets/database';
import {
    createSnippet,
    passages,
    snippetKey,
    type SnippetDocument,
    type TextNode
  } from '../lib/snippets/document';
import { Shelf } from './shelf';


export function SnippetCapture(props: CaptureProps & ReaderViewProps) {
const latest = useLatest(props);
const c = useReaderController(() => createCapture(props as CaptureProps, (name, detail) => latest.current.events?.[name]?.({ detail })), props);
useReaderBindings(c, props);
if (!c) return null;
return <ReaderScope name="react-snippets-capture">
{(c.open) ? <><Dialog.Root  open={c.open}
bindings={{"open": (value) => { c.open = value; }}}>
<Dialog.Content  closeDisabled={c.busy}>
<Dialog.Header  ><Dialog.Title  >{"Add to snippet"}</Dialog.Title><Dialog.Description  >{"The captured text is already kept as a local draft. Choose a destination."}</Dialog.Description></Dialog.Header>
<Button  disabled={c.busy}
onClick={c.create}>{"Create new snippet"}</Button>
<Input  aria-label={"Search destination snippets"}
placeholder={"Search existing snippets"}
value={c.query}
maxLength={512}
className={["min-h-11"].filter(Boolean).join(' ')}
bindings={{"value": (value) => { c.query = value; }}}></Input>
<Dom scopeClass="snippet-scope-capture" as="div" className={["choices"].filter(Boolean).join(' ')}>
<Shelf  query={c.query}
members={c.choices.map((item) => snippetKey(item.id))}
onchoose={(item) => void c.append(item.id)}></Shelf>
</Dom>
{(c.error) ? <><Dom scopeClass="snippet-scope-capture" as="p" role={"alert"}>{c.error}</Dom></> : null}<Button  variant={"secondary"}
disabled={c.busy}
onClick={() => (c.open = false)}>{"Keep for later"}</Button>
</Dialog.Content>
</Dialog.Root></> : <> {(c.error) ? <><Dom scopeClass="snippet-scope-capture" as="div" role={"alert"}
className={["capture-error"].filter(Boolean).join(' ')}>
<Dom scopeClass="snippet-scope-capture" as="span" >{c.error}</Dom><Button  variant={"ghost"}
size={"sm"}
onClick={() => (c.error = '')}>{"Dismiss"}</Button>
</Dom></> : null}</>}
</ReaderScope>;
}
