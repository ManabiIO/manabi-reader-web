<script lang="ts">
  import { localUser } from '../manabi/client';
  import Shelf from './shelf.svelte';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import * as Dialog from '$lib/components/ui/dialog';
  import { scope, snippetItems, flushSnippets, appendToSnippet, type SnippetScope } from './service';
  import { saveDraft, deleteDraft, recordKey } from './database';
  import {
    createSnippet,
    passages,
    snippetKey,
    truncateValidText,
    type SnippetDocument,
    type TextNode
  } from './document';

  interface CapturePayload {
    html: string;
    title: string;
    item: string;
    owner: string | null;
  }
  interface PersistedCapture {
    selected: SnippetScope;
    text: TextNode;
    document: SnippetDocument;
    session: string;
  }

  let open = false,
    busy = false,
    error = '',
    status = '',
    deferredCount = 0,
    query = '';
  let content: TextNode | undefined,
    document: SnippetDocument | undefined,
    session = '',
    captured: SnippetScope | undefined;
  $: choices = $snippetItems.filter((item) => !item.trashedAt && !item.transfer && !item.conflicts);

  function capturePayload(event: Event): CapturePayload {
    const value = (event as CustomEvent<unknown>).detail;
    if (
      !value ||
      typeof value !== 'object' ||
      typeof (value as CapturePayload).html !== 'string' ||
      typeof (value as CapturePayload).title !== 'string' ||
      typeof (value as CapturePayload).item !== 'string' ||
      ((value as CapturePayload).owner !== null && typeof (value as CapturePayload).owner !== 'string')
    )
      throw new Error('The captured selection is invalid.');
    return value as CapturePayload;
  }

  async function persistCapture(value: CapturePayload): Promise<PersistedCapture> {
    const selected = scope();
    if (selected.owner !== (value.owner ? `account:${value.owner}` : 'local'))
      throw new Error('The account changed before capture.');
    const { importContent } = await import('./editor');
    selected.guard();
    const text = importContent(value.html, 'html');
    const created = createSnippet(text);
    created.source = {
      title: truncateValidText(value.title, 1000),
      item: truncateValidText(value.item, 1000),
      quote: truncateValidText(
        passages(text)
          .map((passage) => passage.text)
          .join('\n'),
        4000
      )
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
    return { selected, text, document: created, session: key };
  }

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
      let value: CapturePayload;
      try {
        value = capturePayload(event);
      } catch (reason) {
        error = reason instanceof Error ? reason.message : 'The selection could not be captured.';
        return;
      }

      // A second user action must never disappear behind the currently open
      // capture dialog or an in-flight append/navigation. Persist it immediately
      // as an independent draft, without replacing the capture the user is
      // already resolving.
      if (open || busy) {
        try {
          const saved = await persistCapture(value);
          saved.selected.guard();
          if (!alive) return;
          deferredCount++;
          status = `${deferredCount} additional selection${deferredCount === 1 ? '' : 's'} saved for later.`;
        } catch (reason) {
          if (alive)
            error =
              reason instanceof Error
                ? reason.message
                : 'The additional selection could not be captured.';
        }
        return;
      }

      // Clear the previous presentation before suspending. Concurrent capture
      // events after busy=true own any newer status/error and must not be erased
      // when this first persistence later resumes.
      query = '';
      error = '';
      status = '';
      deferredCount = 0;
      busy = true;
      try {
        const saved = await persistCapture(value);
        saved.selected.guard();
        if (!alive) return;
        captured = saved.selected;
        content = saved.text;
        document = saved.document;
        session = saved.session;
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
        status = '';
        deferredCount = 0;
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
      {#if status}<p role="status">{status}</p>{/if}
      {#if error}<p role="alert">{error}</p>{/if}
      <Button variant="secondary" disabled={busy} onclick={() => (open = false)}
        >Keep for later</Button
      >
    </Dialog.Content>
  </Dialog.Root>
{:else if error || status}<div
    role={error ? 'alert' : 'status'}
    class:capture-error={!!error}
    class:capture-status={!error}
  >
    <span>
      {#if error}{error}{/if}
      {#if error && status}<br />{/if}
      {#if status}{status}{/if}
    </span><Button
      variant="ghost"
      size="sm"
      onclick={() => {
        error = '';
        status = '';
        deferredCount = 0;
      }}>Dismiss</Button
    >
  </div>{/if}

<style>
  .choices {
    display: grid;
    max-height: 18rem;
    overflow-y: auto;
    gap: 0.3rem;
  }
  .capture-error,
  .capture-status {
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
  .capture-error {
    color: var(--destructive);
  }
  .capture-status {
    color: var(--foreground);
  }
</style>
