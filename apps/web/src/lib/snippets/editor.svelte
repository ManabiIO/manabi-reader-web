<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { Editor } from '@tiptap/core';
  import { Button } from '$lib/components/ui/button';
  import { createEditor } from './editor';
  import { safeLink, type TextNode } from './document';
  export let content: TextNode;
  export let disabled = false;
  export let onchange: (value: TextNode) => void;
  export let onready: (editor: Editor) => void = () => undefined;
  export let onpendingchange: (pending: boolean) => void = () => undefined;
  let host: HTMLDivElement;
  let editor: Editor | undefined;
  let tool: 'ruby' | 'link' | undefined;
  let value = '';
  let error = '';
  let selection = { from: 0, to: 0 };
  let composing = false;
  let annotationInput: HTMLInputElement;
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
  $: if (editor) editor.setEditable(!disabled && !tool, false);
  $: onpendingchange(!!tool);
  function refreshControls() {
    if (!editor) return;
    controls = {
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
    };
  }
  function open(kind: 'ruby' | 'link') {
    if (!editor || disabled || tool || editor.view.composing) return;
    const mark = kind === 'ruby' ? 'rubyText' : 'link';
    if (editor.state.selection.empty) {
      if (!editor.isActive(mark)) return;
      // Editing a reading/link at its caret updates the existing mark, not only future typing.
      editor.commands.extendMarkRange(mark);
    }
    selection = { from: editor.state.selection.from, to: editor.state.selection.to };
    value = String(
      editor.getAttributes(kind === 'ruby' ? 'rubyText' : 'link')[
        kind === 'ruby' ? 'rt' : 'href'
      ] ?? ''
    );
    tool = kind;
    error = '';
    void tick().then(() => annotationInput?.focus());
  }
  function apply() {
    if (!editor || disabled || !tool || composing || editor.view.composing) return;
    const annotation = value.trim();
    if (tool === 'link' && annotation && !safeLink(annotation)) {
      error = 'Use a complete HTTPS, HTTP or mailto link.';
      return;
    }
    const chain = editor.chain().focus().setTextSelection(selection);
    const command =
      tool === 'ruby'
        ? annotation
          ? chain.setRubyText({ rt: annotation })
          : chain.unsetRubyText()
        : annotation
          ? chain.setLink({ href: annotation })
          : chain.unsetLink();
    if (!command.run()) {
      error = 'Select text for this annotation and try again.';
      return;
    }
    cancel();
  }
  function cancel() {
    if (disabled) return;
    tool = undefined;
    composing = false;
    editor?.setEditable(true, false);
    editor?.commands.focus();
  }
  onMount(() => {
    editor = createEditor(host, content, onchange);
    editor.on('transaction', refreshControls);
    refreshControls();
    onready(editor);
    return () => {
      editor?.off('transaction', refreshControls);
      editor?.destroy();
      onpendingchange(false);
      editor = undefined;
    };
  });
</script>

<div class="editor-toolbar" role="toolbar" aria-label="Text formatting">
  <Button
    variant="ghost"
    size="sm"
    disabled={disabled || !!tool}
    aria-pressed={controls.bold}
    onclick={() => editor?.chain().focus().toggleBold().run()}>Bold</Button
  >
  <Button
    variant="ghost"
    size="sm"
    disabled={disabled || !!tool}
    aria-pressed={controls.italic}
    onclick={() => editor?.chain().focus().toggleItalic().run()}>Italic</Button
  >
  <Button
    variant="ghost"
    size="sm"
    disabled={disabled || !!tool}
    aria-pressed={controls.underline}
    onclick={() => editor?.chain().focus().toggleUnderline().run()}>Underline</Button
  >
  <Button
    variant="ghost"
    disabled={disabled || !!tool}
    size="sm"
    aria-pressed={controls.heading}
    onclick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>Heading</Button
  >
  <Button
    variant="ghost"
    size="sm"
    disabled={disabled || !!tool}
    aria-pressed={controls.list}
    onclick={() => editor?.chain().focus().toggleBulletList().run()}>List</Button
  >
  <Button
    variant="ghost"
    size="sm"
    disabled={disabled || !!tool}
    aria-pressed={controls.quote}
    onclick={() => editor?.chain().focus().toggleBlockquote().run()}>Quote</Button
  >
  <Button
    variant="ghost"
    size="sm"
    disabled={disabled || !!tool || !controls.ruby}
    onclick={() => open('ruby')}>Furigana</Button
  >
  <Button
    variant="ghost"
    size="sm"
    disabled={disabled || !!tool || !controls.link}
    onclick={() => open('link')}>Link</Button
  >
  <Button
    variant="ghost"
    size="sm"
    disabled={disabled || !!tool || !controls.undo}
    onclick={() => editor?.chain().focus().undo().run()}>Undo</Button
  >
  <Button
    variant="ghost"
    size="sm"
    disabled={disabled || !!tool || !controls.redo}
    onclick={() => editor?.chain().focus().redo().run()}>Redo</Button
  >
</div>
{#if tool}
  <p class="annotation-note" role="status">
    Apply or cancel this annotation before saving or keeping the draft.
  </p>
  <form
    class="annotation"
    onsubmit={(event) => {
      event.preventDefault();
      apply();
    }}
  >
    <label
      >{tool === 'ruby' ? 'Furigana reading' : 'Link URL'}
      <input
        bind:this={annotationInput}
        bind:value
        {disabled}
        maxlength={tool === 'ruby' ? 1000 : 4096}
        oncompositionstart={() => (composing = true)}
        oncompositionend={() => (composing = false)}
        onkeydown={(event) => {
          if ((event.isComposing || composing || event.keyCode === 229) && event.key === 'Enter')
            event.preventDefault();
          if (event.key === 'Escape' && !event.isComposing && !composing && event.keyCode !== 229) {
            event.preventDefault();
            cancel();
          }
        }}
      />
    </label>
    <Button type="submit" size="sm" disabled={disabled || composing}>Apply</Button>
    <Button variant="ghost" size="sm" {disabled} onclick={cancel}>Cancel</Button>
    {#if error}<p role="alert">{error}</p>{/if}
  </form>
{/if}
<div class="editor-host" bind:this={host}></div>

<style>
  .editor-toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.15rem;
    padding: 0.4rem 0;
    border-block: 1px solid var(--border);
  }
  .annotation-note {
    color: var(--muted-foreground);
    margin-block: 0.6rem 0;
  }
  .editor-toolbar :global(button[aria-pressed='true']) {
    background: var(--secondary);
    color: var(--secondary-foreground);
  }
  .annotation {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 0.6rem;
    padding: 0.6rem 0;
  }
  label {
    display: grid;
    gap: 0.2rem;
  }
  input {
    color: var(--foreground);
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    padding: 0.5rem;
  }
  .editor-host {
    min-height: 18rem;
  }
  :global(.snippet-editable) {
    min-height: 18rem;
    outline: none;
    padding: 1.2rem 0.25rem;
    line-height: 1.9;
    overflow-wrap: anywhere;
  }
  :global(.snippet-editable p) {
    margin-block: 0.65em;
  }
  :global(.snippet-editable ul),
  :global(.snippet-editable ol) {
    padding-inline-start: 1.6em;
  }
  :global(.snippet-editable ul) {
    list-style: disc;
  }
  :global(.snippet-editable ol) {
    list-style: decimal;
  }
  :global(.snippet-editable blockquote) {
    border-inline-start: 3px solid var(--border);
    padding-inline-start: 1em;
  }
  :global(.snippet-editable h2) {
    font-size: 1.4em;
    font-weight: 650;
  }
  :global(.snippet-editable ruby rt) {
    font-size: 0.55em;
  }
  :global(.snippet-editable a) {
    text-decoration: underline;
  }
</style>
