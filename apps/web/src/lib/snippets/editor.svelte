<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { Editor } from '@tiptap/core';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { createEditor } from './editor';
  import { safeLink, type TextNode } from './document';
  export let content: TextNode;
  export let disabled = false;
  export let onchange: (value: TextNode) => void;
  export let onready: (editor: Editor) => void = () => undefined;
  let host: HTMLDivElement;
  let editor: Editor | undefined;
  let tool: 'ruby' | 'link' | undefined;
  let value = '';
  let error = '';
  let selection = { from: 0, to: 0 };
  let composing = false;
  let annotationInput: HTMLInputElement | null = null;
  $: if (editor) editor.setEditable(!disabled && !tool);
  function open(kind: 'ruby' | 'link') {
    if (!editor || editor.view.composing) return;
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
    if (!editor || composing || editor.view.composing) return;
    if (tool === 'link' && value && !safeLink(value)) {
      error = 'Use a complete HTTPS, HTTP or mailto link.';
      return;
    }
    const chain = editor.chain().focus().setTextSelection(selection);
    if (tool === 'ruby') {
      if (value) chain.setRubyText({ rt: value }).run();
      else chain.unsetRubyText().run();
    } else if (value) chain.setLink({ href: value }).run();
    else chain.unsetLink().run();
    tool = undefined;
    editor.setEditable(!disabled);
    editor.commands.focus();
  }
  onMount(() => {
    editor = createEditor(host, content, onchange);
    onready(editor);
    return () => {
      editor?.destroy();
      editor = undefined;
    };
  });
</script>

<div class="editor-toolbar" role="toolbar" aria-label="Text formatting">
  <Button
    variant="ghost"
    size="sm"
    disabled={disabled || !!tool}
    onclick={() => editor?.chain().focus().toggleBold().run()}>Bold</Button
  >
  <Button
    variant="ghost"
    size="sm"
    disabled={disabled || !!tool}
    onclick={() => editor?.chain().focus().toggleItalic().run()}>Italic</Button
  >
  <Button
    variant="ghost"
    size="sm"
    disabled={disabled || !!tool}
    onclick={() => editor?.chain().focus().toggleUnderline().run()}>Underline</Button
  >
  <Button
    variant="ghost"
    disabled={disabled || !!tool}
    size="sm"
    onclick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>Heading</Button
  >
  <Button
    variant="ghost"
    size="sm"
    disabled={disabled || !!tool}
    onclick={() => editor?.chain().focus().toggleBulletList().run()}>List</Button
  >
  <Button
    variant="ghost"
    size="sm"
    disabled={disabled || !!tool}
    onclick={() => editor?.chain().focus().toggleBlockquote().run()}>Quote</Button
  >
  <Button variant="ghost" size="sm" disabled={disabled || !!tool} onclick={() => open('ruby')}
    >Furigana</Button
  >
  <Button variant="ghost" size="sm" disabled={disabled || !!tool} onclick={() => open('link')}
    >Link</Button
  >
  <Button
    variant="ghost"
    size="sm"
    disabled={disabled || !!tool}
    onclick={() => editor?.chain().focus().undo().run()}>Undo</Button
  >
  <Button
    variant="ghost"
    size="sm"
    disabled={disabled || !!tool}
    onclick={() => editor?.chain().focus().redo().run()}>Redo</Button
  >
</div>
{#if tool}
  <form
    class="annotation"
    onsubmit={(event) => {
      event.preventDefault();
      apply();
    }}
  >
    <label
      >{tool === 'ruby' ? 'Furigana reading' : 'Link URL'}
      <Input
        bind:ref={annotationInput}
        class="min-h-11"
        bind:value
        maxlength={tool === 'ruby' ? 1000 : 4096}
        oncompositionstart={() => (composing = true)}
        oncompositionend={() => (composing = false)}
        onkeydown={(event) => {
          if ((event.isComposing || composing || event.keyCode === 229) && event.key === 'Enter')
            event.preventDefault();
          if (event.key === 'Escape' && !event.isComposing && !composing && event.keyCode !== 229) {
            event.preventDefault();
            tool = undefined;
            editor?.setEditable(!disabled);
            editor?.commands.focus();
          }
        }}
      />
    </label>
    <Button type="submit" size="sm">Apply</Button>
    <Button
      variant="ghost"
      size="sm"
      {disabled}
      onclick={() => {
        tool = undefined;
        editor?.setEditable(!disabled);
        editor?.commands.focus();
      }}>Cancel</Button
    >
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
