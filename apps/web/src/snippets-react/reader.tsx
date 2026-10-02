/** @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors. All rights reserved. */
import React from 'react';
import { useReaderController, readerTick } from '../reader-react/controller';
import { Dom, SurfaceEvents, Head, Icon, Button, Input, AppNav, DynamicComponent, Dialog, Menu, ReaderScope, useLatest, useReaderBindings, type ReaderViewProps } from './primitives';
import { createReader, type ReaderProps } from './reader-controller';
import { readerHTML } from '../lib/snippets/presentation';
import {
    displayTitle,
    passages,
    resolveLocator,
    type SnippetDocument,
    type SnippetLocator
  } from '../lib/snippets/document';
import { saveProgress, syncReading, touchReading } from '../lib/snippets/reading-state';
import { getRecord } from '../lib/snippets/database';
import type { SnippetScope } from '../lib/snippets/scope';



export function SnippetReader(props: ReaderProps & ReaderViewProps) {
const latest = useLatest(props);
const c = useReaderController(() => createReader(props as ReaderProps, (name, detail) => latest.current.events?.[name]?.({ detail })), props);
useReaderBindings(c, props);
if (!c) return null;
return <ReaderScope name="react-snippets-reader">
<Dom scopeClass="snippet-scope-reader" as="div" role={"toolbar"}
aria-label={"Snippet reading controls"}
className={["reading-tools"].filter(Boolean).join(' ')}>
<Button  variant={"ghost"}
size={"sm"}
onClick={() => (c.fontSize = Math.max(14, c.fontSize - 2))}
aria-label={"Smaller text"}>{"A−"}</Button>
<Button  variant={"ghost"}
size={"sm"}
onClick={() => (c.fontSize = Math.min(36, c.fontSize + 2))}
aria-label={"Larger text"}>{"A+"}</Button>
<Button  variant={"ghost"}
size={"sm"}
aria-pressed={c.vertical}
onClick={() => (c.vertical = !c.vertical)}>{"Vertical reading"}</Button>
<Button  variant={"ghost"}
size={"sm"}
onClick={c.capture}>{"Save selection to snippet…"}</Button>
</Dom>
{(c.notice) ? <><Dom scopeClass="snippet-scope-reader" as="p" role={"status"}>{c.notice}</Dom></> : null}
<Dom scopeClass="snippet-scope-reader" as="article" elementRef={(value) => { c.host = value; }}
lang={"ja"}
aria-label={"Snippet content"}
html={c.html}
className={[(c.vertical) && "vertical", "snippet-reading"].filter(Boolean).join(' ')}
style={{"fontSize": `${c.fontSize}px`}}>



</Dom>
</ReaderScope>;
}
