/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */
import type { Editor } from '@tiptap/core';
import { createEditor as createTiptapEditor } from '../lib/snippets/editor';
import { safeLink, type TextNode } from '../lib/snippets/document';
import { ReaderController, readerTick, writeStore, type StoreValue } from '../reader-react/controller';

export interface EditorProps {
content: TextNode;
disabled?: boolean;
onchange: (value: TextNode) => void;
onready?: (editor: Editor) => void;
onpendingchange?: (pending: boolean) => void;
}

export function createEditor(props: EditorProps, emit: (name: string, detail?: unknown) => void = () => {}) {
const __readerController = new ReaderController();


let content: TextNode = props.content;
let disabled = props.disabled !== undefined ? props.disabled : false;
let onchange: (value: TextNode) => void = props.onchange;
let onready: (editor: Editor) => void = props.onready !== undefined ? props.onready : () => undefined;
let onpendingchange: (pending: boolean) => void = props.onpendingchange !== undefined ? props.onpendingchange : () => undefined;
let host: HTMLDivElement;
let editor: Editor | undefined;
let tool: 'ruby' | 'link' | undefined;
let value = '';
let error = '';
let selection = { from: 0, to: 0 };
let composing = false;
let annotationInput: HTMLInputElement | null = null;
let controls = {
    bold: false,
    italic: false,
    underline: false,
    heading: false,
    list: false,
    quote: false,
    ruby: false,
    link: false,
    undo: false,
    redo: false
};
__readerController.effect(() => [editor, disabled, tool], () => { if (editor)
    editor.setEditable(!disabled && !tool, false); });
__readerController.effect(() => [onpendingchange, tool], () => { onpendingchange(!!tool); });
function refreshControls() {
    if (!editor)
        return;
    __readerController.changed(controls = {
        bold: editor.isActive('bold'),
        italic: editor.isActive('italic'),
        underline: editor.isActive('underline'),
        heading: editor.isActive('heading', { level: 2 }),
        list: editor.isActive('bulletList'),
        quote: editor.isActive('blockquote'),
        ruby: !editor.state.selection.empty || editor.isActive('rubyText'),
        link: !editor.state.selection.empty || editor.isActive('link'),
        undo: editor.can().undo(),
        redo: editor.can().redo()
    });
}
function open(kind: 'ruby' | 'link') {
    if (!editor || disabled || tool || editor.view.composing)
        return;
    const mark = kind === 'ruby' ? 'rubyText' : 'link';
    if (editor.state.selection.empty) {
        if (!editor.isActive(mark))
            return;
        // Editing a reading/link at its caret updates the existing mark, not only future typing.
        editor.commands.extendMarkRange(mark);
    }
    __readerController.changed(selection = { from: editor.state.selection.from, to: editor.state.selection.to });
    __readerController.changed(value = String(editor.getAttributes(kind === 'ruby' ? 'rubyText' : 'link')[kind === 'ruby' ? 'rt' : 'href'] ?? ''));
    __readerController.changed(tool = kind);
    __readerController.changed(error = '');
    void readerTick().then(() => annotationInput?.focus());
}
function apply() {
    if (!editor || disabled || !tool || composing || editor.view.composing)
        return;
    const annotation = value.trim();
    if (tool === 'link' && annotation && !safeLink(annotation)) {
        __readerController.changed(error = 'Use a complete HTTPS, HTTP or mailto link.');
        return;
    }
    const chain = editor.chain().focus().setTextSelection(selection);
    const command = tool === 'ruby'
        ? annotation
            ? chain.setRubyText({ rt: annotation })
            : chain.unsetRubyText()
        : annotation
            ? chain.setLink({ href: annotation })
            : chain.unsetLink();
    if (!command.run()) {
        __readerController.changed(error = 'Select text for this annotation and try again.');
        return;
    }
    cancel();
}
function cancel() {
    if (disabled)
        return;
    __readerController.changed(tool = undefined);
    __readerController.changed(composing = false);
    editor?.setEditable(true, false);
    editor?.commands.focus();
}
__readerController.onMount(() => {
    __readerController.changed(editor = createTiptapEditor(host, content, onchange));
    editor.on('transaction', refreshControls);
    refreshControls();
    onready(editor);
    return () => {
        editor?.off('transaction', refreshControls);
        editor?.destroy();
        onpendingchange(false);
        __readerController.changed(editor = undefined);
    };
});

const api = { controller: __readerController, refreshControls, open, apply, cancel,
get content() { return content; }, set content(nextValue: typeof content) { if (Object.is(content, nextValue)) return; content = nextValue; __readerController.invalidate(); },
get disabled() { return disabled; }, set disabled(nextValue: typeof disabled) { if (Object.is(disabled, nextValue)) return; disabled = nextValue; __readerController.invalidate(); },
get onchange() { return onchange; }, set onchange(nextValue: typeof onchange) { if (Object.is(onchange, nextValue)) return; onchange = nextValue; __readerController.invalidate(); },
get onready() { return onready; }, set onready(nextValue: typeof onready) { if (Object.is(onready, nextValue)) return; onready = nextValue; __readerController.invalidate(); },
get onpendingchange() { return onpendingchange; }, set onpendingchange(nextValue: typeof onpendingchange) { if (Object.is(onpendingchange, nextValue)) return; onpendingchange = nextValue; __readerController.invalidate(); },
get host() { return host; }, set host(nextValue: typeof host) { if (Object.is(host, nextValue)) return; host = nextValue; __readerController.invalidate(); },
get editor() { return editor; }, set editor(nextValue: typeof editor) { if (Object.is(editor, nextValue)) return; editor = nextValue; __readerController.invalidate(); },
get tool() { return tool; }, set tool(nextValue: typeof tool) { if (Object.is(tool, nextValue)) return; tool = nextValue; __readerController.invalidate(); },
get value() { return value; }, set value(nextValue: typeof value) { if (Object.is(value, nextValue)) return; value = nextValue; __readerController.invalidate(); },
get error() { return error; }, set error(nextValue: typeof error) { if (Object.is(error, nextValue)) return; error = nextValue; __readerController.invalidate(); },
get selection() { return selection; }, set selection(nextValue: typeof selection) { if (Object.is(selection, nextValue)) return; selection = nextValue; __readerController.invalidate(); },
get composing() { return composing; }, set composing(nextValue: typeof composing) { if (Object.is(composing, nextValue)) return; composing = nextValue; __readerController.invalidate(); },
get annotationInput() { return annotationInput; }, set annotationInput(nextValue: typeof annotationInput) { if (Object.is(annotationInput, nextValue)) return; annotationInput = nextValue; __readerController.invalidate(); },
get controls() { return controls; }, set controls(nextValue: typeof controls) { if (Object.is(controls, nextValue)) return; controls = nextValue; __readerController.invalidate(); },
updateProps(next: Record<string, unknown>) {
if ('content' in next) api.content = next.content as typeof content;
if ('disabled' in next) api.disabled = (next.disabled === undefined ? false : next.disabled) as typeof disabled;
if ('onchange' in next) api.onchange = next.onchange as typeof onchange;
if ('onready' in next) api.onready = (next.onready === undefined ? () => undefined : next.onready) as typeof onready;
if ('onpendingchange' in next) api.onpendingchange = (next.onpendingchange === undefined ? () => undefined : next.onpendingchange) as typeof onpendingchange;
}
};
return api;
}
