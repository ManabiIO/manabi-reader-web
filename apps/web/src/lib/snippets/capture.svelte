<script lang="ts">
  import { localUser } from '../manabi/client';
  import Shelf from './shelf.svelte';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import * as Dialog from '$lib/components/ui/dialog';
  import { scope, snippetItems, flushSnippets, appendToSnippet } from './service';
  import { saveDraft, deleteDraft, recordKey } from './database';
  import {
    createSnippet,
    passages,
    snippetKey,
    safeLink,
    type SnippetDocument,
    type TextNode
  } from './document';
  let open = false,
    busy = false,
    error = '',
    query = '';
  let content: TextNode | undefined,
    document: SnippetDocument | undefined,
    session = '',
    captured: ReturnType<typeof scope> | undefined;
  $: choices = $snippetItems.filter((item) => !item.trashedAt && !item.transfer && !item.conflicts);
  async function create() {
    if (!captured || !content || !document || busy) return;
    busy = true;
    try {
      captured.guard();
      open = false;
      await goto(resolve(`/snippets?draft=${encodeURIComponent(session)}`));
    } catch (reason) {
      error = reason instanceof Error ? reason.message : 'The capture remains in recovered drafts.';
    } finally {
      busy = false;
    }
  }
  async function append(id: string) {
    if (!captured || !content || busy) return;
    busy = true;
    error = '';
    try {
      const selected = captured,
        text = content;
      await appendToSnippet(id, text, session, selected);
      await deleteDraft(recordKey(selected.owner, session), selected.guard);
      open = false;
      void flushSnippets(selected).catch(() => undefined);
    } catch (reason) {
      error = reason instanceof Error ? reason.message : 'The capture is preserved as a draft.';
    } finally {
      busy = false;
    }
  }
  onMount(() => {
    let alive = true;
    const receive = async (event: Event) => {
      if (open || busy) return;
      busy = true;
      const value = (
        event as CustomEvent<{
          html: string;
          title: string;
          item: string;
          url?: string;
          owner: string | null;
        }>
      ).detail;
      try {
        const selected = scope();
        if (selected.owner !== (value.owner ? `account:${value.owner}` : 'local'))
          throw new Error('The account changed before capture.');
        const { importContent } = await import('./editor');
        selected.guard();
        const text = importContent(value.html, 'html');
        const created = createSnippet(text);
        created.source = {
          title: value.title.slice(0, 1000),
          item: value.item.slice(0, 1000),
          ...(safeLink(value.url) ? { url: value.url } : {}),
          quote: passages(text)
            .map((p) => p.text)
            .join('\n')
            .slice(0, 4000)
        };
        const key = crypto.randomUUID();
        await saveDraft(
          {
            key: recordKey(selected.owner, key),
            owner: selected.owner,
            id: created.id,
            session: key,
            base: null,
            document: created,
            updatedAt: Date.now(),
            mode: 'new'
          },
          selected.guard
        );
        selected.guard();
        if (!alive) return;
        captured = selected;
        content = text;
        document = created;
        session = key;
        query = '';
        error = '';
        open = true;
      } catch (reason) {
        error = reason instanceof Error ? reason.message : 'The selection could not be captured.';
      } finally {
        busy = false;
      }
    };
    const stopAccount = localUser.subscribe(() => {
      try {
        captured?.guard();
      } catch {
        open = false;
        content = undefined;
        document = undefined;
        captured = undefined;
        query = '';
        error = '';
      }
    });
    window.addEventListener('manabi-capture-snippet', receive);
    return () => {
      alive = false;
      stopAccount();
      window.removeEventListener('manabi-capture-snippet', receive);
    };
  });
</script>

{#if open}
  <Dialog.Root bind:open>
    <Dialog.Content closeDisabled={busy}>
      <Dialog.Header
        ><Dialog.Title>Add to snippet</Dialog.Title><Dialog.Description
          >The captured text is already kept as a local draft. Choose a destination.</Dialog.Description
        ></Dialog.Header
      >
      <Button disabled={busy} onclick={create}>Create new snippet</Button>
      <Input
        class="min-h-11"
        aria-label="Search destination snippets"
        placeholder="Search existing snippets"
        bind:value={query}
        maxlength={512}
      />
      <div class="choices">
        <Shelf
          {query}
          members={choices.map((item) => snippetKey(item.id))}
          onchoose={(item) => void append(item.id)}
        />
      </div>
      {#if error}<p role="alert">{error}</p>{/if}<Button
        variant="secondary"
        disabled={busy}
        onclick={() => (open = false)}>Keep for later</Button
      >
    </Dialog.Content>
  </Dialog.Root>
{:else if error}<div role="alert" class="capture-error">
    <span>{error}</span><Button variant="ghost" size="sm" onclick={() => (error = '')}
      >Dismiss</Button
    >
  </div>{/if}

<style>
  .choices {
    display: grid;
    max-height: 18rem;
    overflow-y: auto;
    gap: 0.3rem;
  }
  .capture-error {
    position: fixed;
    inset-inline: 1rem;
    bottom: max(1rem, env(safe-area-inset-bottom));
    z-index: 60;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    max-width: 40rem;
    margin-inline: auto;
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: 1rem;
    background: var(--card);
    box-shadow: 0 8px 30px #0002;
  }
</style>
