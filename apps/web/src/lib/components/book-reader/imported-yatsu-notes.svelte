<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { currentUser, account } from '$lib/manabi/client';
  import {
    listImportedNotes,
    editImportedNote,
    exportImportedNotes,
    restoreImportedNotes
  } from '$lib/manabi/imported-notes';
  import { MigrationConflict } from '$lib/manabi/ttu-migration-format';
  import type { ReaderImportRecord } from '$lib/data/database/books-db/versions/v10/books-db-v10';
  export let bookId = 0;
  export let bookKey = '';
  export let open = false;
  let records: ReaderImportRecord[] = [],
    editing = '',
    body = '',
    label = '',
    error = '',
    message = '',
    busy = false,
    mounted = false,
    serial = 0,
    signature = '',
    restorePickerOpen = false;
  let pendingArchive: string | undefined;
  $: nextSignature = JSON.stringify([open, bookKey, $account.session?.user?.id]);
  $: if (mounted && signature !== nextSignature) {
    signature = nextSignature;
    editing = '';
    pendingArchive = undefined;
    restorePickerOpen = false;
    records = [];
    // Schedule after this identity transition; the loader owns its request generation.
    void Promise.resolve().then(load);
  }
  $: visible = records.filter((row) => !row.deletedAt && row.status !== 'anchored');
  async function load() {
    const run = ++serial,
      key = bookKey,
      owner = currentUser()?.id ?? null;
    if (!open || !key) return;
    try {
      const rows = await listImportedNotes(key);
      if (run === serial && mounted && owner === (currentUser()?.id ?? null)) records = rows;
    } catch (e) {
      if (run === serial && mounted) error = String(e);
    }
  }
  async function action(work: () => Promise<void>) {
    if (busy) return;
    const identity = signature;
    busy = true;
    error = '';
    try {
      await work();
      if (mounted && identity === signature) await load();
    } catch (e) {
      if (mounted && identity === signature) error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
  function download(json: string) {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'manabi-imported-notes.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function restore(json: string, replace = false) {
    const identity = signature;
    try {
      const count = await restoreImportedNotes(json, bookId, bookKey, replace);
      if (!mounted || identity !== signature) return;
      pendingArchive = undefined;
      message = `${count} notebook record(s) restored.`;
    } catch (e) {
      if (mounted && identity === signature && e instanceof MigrationConflict)
        pendingArchive = json;
      throw e;
    }
  }
  onMount(() => {
    mounted = true;
    return () => {
      mounted = false;
      serial++;
    };
  });
</script>

{#if open && bookKey}
  <section class="mt-5 border-t border-border pt-4" aria-label="Imported Yatsu notes">
    <h3 class="text-sm font-semibold">Imported Yatsu notes</h3>
    {#if records.length}
      <p class="mt-2 text-sm text-muted-foreground">
        Book notes and unlocated saved passages remain editable here. Verified passages appear
        above. Original source records are preserved for recovery.
      </p>
      <div class="my-3 flex flex-wrap gap-2">
        <Button
          variant="ghost"
          disabled={busy}
          onclick={() =>
            action(async () => {
              editing = '';
            })}>Reload latest notes</Button
        >
        <Button
          variant="ghost"
          disabled={busy}
          onclick={() => action(async () => download(await exportImportedNotes(bookId, bookKey)))}
          >Download imported notes</Button
        >
      </div>
      {#each visible as row (row.id)}
        <article class="mb-3 rounded-lg border border-border p-3">
          <p class="text-xs text-muted-foreground">
            {row.status === 'book-note'
              ? 'Book note'
              : 'Unlocated ' + (row.part === 'highlights' ? 'highlight' : 'bookmark')}
          </p>
          <h4 class="mt-1 break-words text-sm font-medium">{row.label}</h4>
          {#if row.quote}<blockquote class="mt-2 whitespace-pre-wrap break-words text-sm">
              {row.quote}
            </blockquote>{/if}
          {#if editing === row.id}
            <label class="mt-2 block text-sm"
              >Title<input
                class="mt-1 w-full rounded border border-input bg-background p-2"
                bind:value={label}
                maxlength={512}
                disabled={busy}
              /></label
            >
            <label class="mt-2 block text-sm"
              >Note<textarea
                class="mt-1 min-h-28 w-full rounded border border-input bg-background p-2"
                bind:value={body}
                maxlength={65536}
                disabled={busy}></textarea></label
            >
            <div class="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={busy}
                onclick={() =>
                  action(async () => {
                    await editImportedNote(row, body, label);
                    editing = '';
                  })}>Save imported note</Button
              >
              <Button size="sm" variant="ghost" disabled={busy} onclick={() => (editing = '')}
                >Cancel</Button
              >
            </div>
          {:else}
            {#if row.body}<p class="mt-2 whitespace-pre-wrap break-words text-sm">
                {row.body}
              </p>{/if}
            {#if row.reason}<p class="mt-2 text-xs text-muted-foreground">{row.reason}</p>{/if}
            <div class="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onclick={() => {
                  editing = row.id;
                  body = row.body;
                  label = row.label;
                }}>Edit imported note</Button
              >
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onclick={() =>
                  action(async () => {
                    await editImportedNote(row, row.body, row.label, true);
                  })}>Remove imported note</Button
              >
            </div>
          {/if}
        </article>
      {/each}
      <details class="my-3 text-sm">
        <summary>Original source records ({records.length})</summary>
        <p class="mt-2 text-xs text-muted-foreground">
          The download includes all records, including removed notes and original Yatsu fields.
          Manabi connection credentials and account scope fields are not exported. Restore it into
          this book, or a verified reimport of the same book.
        </p>
      </details>
    {/if}
    <div class="my-2">
      <Button
        variant="outline"
        disabled={busy}
        aria-expanded={restorePickerOpen}
        onclick={() => (restorePickerOpen = !restorePickerOpen)}>Restore imported notes</Button
      >
      {#if restorePickerOpen}
        <label class="mt-2 block text-sm"
          >Notebook archive<input
            class="mt-2 block max-w-full text-sm"
            aria-label="Choose imported notes archive"
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onchange={(event) => {
              const file = event.currentTarget.files?.[0];
              const identity = signature,
                owner = currentUser()?.id ?? null;
              event.currentTarget.value = '';
              if (file)
                void action(async () => {
                  if (file.size > 16 * 1024 * 1024)
                    throw new Error('Notebook archive is too large.');
                  const json = await file.text();
                  if (!mounted || identity !== signature || owner !== (currentUser()?.id ?? null))
                    return;
                  await restore(json);
                });
            }}
          /></label
        >
      {/if}
    </div>
    {#if pendingArchive}<div class="my-2 flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={busy}
          onclick={() => {
            pendingArchive = undefined;
            error = '';
          }}>Keep device notes</Button
        ><Button disabled={busy} onclick={() => action(() => restore(pendingArchive!, true))}
          >Use notebook archive</Button
        >
      </div>{/if}
    {#if error}<p role="alert" class="mt-2 text-sm text-destructive">{error}</p>{/if}
    {#if message}<p role="status" class="mt-2 text-sm">{message}</p>{/if}
  </section>
{/if}
