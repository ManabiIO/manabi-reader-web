/** @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors. All rights reserved. */
import React from 'react';
import { useReaderController, readerTick } from '../reader-react/controller';
import { Dom, SurfaceEvents, Head, Icon, Button, Input, AppNav, DynamicComponent, Dialog, Menu, ReaderScope, useLatest, useReaderBindings, type ReaderViewProps } from './primitives';
import { createEditor, type EditorProps } from './editor-controller';
import type { Editor } from '@tiptap/core';

import { safeLink, type TextNode } from '../lib/snippets/document';



export function SnippetEditor(props: EditorProps & ReaderViewProps) {
const latest = useLatest(props);
const c = useReaderController(() => createEditor(props as EditorProps, (name, detail) => latest.current.events?.[name]?.({ detail })), props);
useReaderBindings(c, props);
if (!c) return null;
return <ReaderScope name="react-snippets-editor">
<Dom scopeClass="snippet-scope-editor" as="div" role={"toolbar"}
aria-label={"Text formatting"}
className={["editor-toolbar"].filter(Boolean).join(' ')}>
<Button  variant={"ghost"}
size={"sm"}
disabled={c.disabled || !!c.tool}
aria-pressed={c.controls.bold}
onClick={() => c.editor?.chain().focus().toggleBold().run()}>{"Bold"}</Button>
<Button  variant={"ghost"}
size={"sm"}
disabled={c.disabled || !!c.tool}
aria-pressed={c.controls.italic}
onClick={() => c.editor?.chain().focus().toggleItalic().run()}>{"Italic"}</Button>
<Button  variant={"ghost"}
size={"sm"}
disabled={c.disabled || !!c.tool}
aria-pressed={c.controls.underline}
onClick={() => c.editor?.chain().focus().toggleUnderline().run()}>{"Underline"}</Button>
<Button  variant={"ghost"}
disabled={c.disabled || !!c.tool}
size={"sm"}
aria-pressed={c.controls.heading}
onClick={() => c.editor?.chain().focus().toggleHeading({ level: 2 }).run()}>{"Heading"}</Button>
<Button  variant={"ghost"}
size={"sm"}
disabled={c.disabled || !!c.tool}
aria-pressed={c.controls.list}
onClick={() => c.editor?.chain().focus().toggleBulletList().run()}>{"List"}</Button>
<Button  variant={"ghost"}
size={"sm"}
disabled={c.disabled || !!c.tool}
aria-pressed={c.controls.quote}
onClick={() => c.editor?.chain().focus().toggleBlockquote().run()}>{"Quote"}</Button>
<Button  variant={"ghost"}
size={"sm"}
disabled={c.disabled || !!c.tool || !c.controls.ruby}
onClick={() => c.open('ruby')}>{"Furigana"}</Button>
<Button  variant={"ghost"}
size={"sm"}
disabled={c.disabled || !!c.tool || !c.controls.link}
onClick={() => c.open('link')}>{"Link"}</Button>
<Button  variant={"ghost"}
size={"sm"}
disabled={c.disabled || !!c.tool || !c.controls.undo}
onClick={() => c.editor?.chain().focus().undo().run()}>{"Undo"}</Button>
<Button  variant={"ghost"}
size={"sm"}
disabled={c.disabled || !!c.tool || !c.controls.redo}
onClick={() => c.editor?.chain().focus().redo().run()}>{"Redo"}</Button>
</Dom>
{(c.tool) ? <><Dom scopeClass="snippet-scope-editor" as="p" role={"status"}
className={["annotation-note"].filter(Boolean).join(' ')}>{" Apply or cancel this annotation before saving or keeping the draft. "}</Dom>
<Dom scopeClass="snippet-scope-editor" as="form" onSubmit={(event) => {
    event.preventDefault();
    c.apply();
}}
className={["annotation"].filter(Boolean).join(' ')}>
<Dom scopeClass="snippet-scope-editor" as="label" >{c.tool === 'ruby' ? 'Furigana reading' : 'Link URL'}
<Input  value={c.value}
disabled={c.disabled}
maxLength={c.tool === 'ruby' ? 1000 : 4096}
onCompositionStart={() => (c.composing = true)}
onCompositionEnd={() => (c.composing = false)}
onKeyDown={(event) => {
    if ((event.isComposing || c.composing || event.keyCode === 229) && event.key === 'Enter')
        event.preventDefault();
    if (event.key === 'Escape' && !event.isComposing && !c.composing && event.keyCode !== 229) {
        event.preventDefault();
        c.cancel();
    }
}}
className={["min-h-11"].filter(Boolean).join(' ')}
bindings={{"ref": (value) => { c.annotationInput = value; }, "value": (value) => { c.value = value; }}}></Input>
</Dom>
<Button  type={"submit"}
size={"sm"}
disabled={c.disabled || c.composing}>{"Apply"}</Button>
<Button  variant={"ghost"}
size={"sm"}
disabled={c.disabled}
onClick={c.cancel}>{"Cancel"}</Button>
{(c.error) ? <><Dom scopeClass="snippet-scope-editor" as="p" role={"alert"}>{c.error}</Dom></> : null}
</Dom></> : null}
<Dom scopeClass="snippet-scope-editor" as="div" elementRef={(value) => { c.host = value; }}
className={["editor-host"].filter(Boolean).join(' ')}></Dom>
</ReaderScope>;
}
