<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import type { ImportedStudy, ImportedStudyEntry } from '$lib/manabi/yatsu-study-format';
  import { studyComparable } from '$lib/manabi/yatsu-study-format';
  import {
    editImportedStudy,
    exportImportedStudy,
    restoreImportedStudy
  } from '$lib/manabi/yatsu-study';
  import type { ReaderLocator } from '$lib/reader-location';
  export let study: ImportedStudy | undefined;
  export let bookId: number;
  let error = '',
    status = '',
    editing = '',
    title = '',
    note = '',
    text = '';
  let busy = false,
    replace = false,
    limit = 30;
  let alive = true;
  onDestroy(() => {
    alive = false;
  });
  const dispatch = createEventDispatcher<{ changed: ImportedStudy; navigate: ReaderLocator }>();
  $: entries = study?.entries.filter((entry) => !entry.deleted) ?? [];
  function begin(entry: ImportedStudyEntry) {
    editing = entry.id;
    title = entry.title;
    note = entry.note;
    text = entry.text;
  }
  async function change(entry: ImportedStudyEntry, changes: Partial<ImportedStudyEntry>) {
    if (busy) return;
    const target = bookId;
    busy = true;
    error = '';
    status = '';
    try {
      const next = await editImportedStudy(target, entry.id, studyComparable(entry), changes);
      if (!alive || bookId !== target) return;
      study = next;
      dispatch('changed', next);
      editing = '';
      status = 'Imported note saved on this device.';
    } catch (e) {
      if (alive && bookId === target)
        error = e instanceof Error ? e.message : 'Could not save this note.';
    } finally {
      if (alive && bookId === target) busy = false;
    }
  }
  function download() {
    if (!study) return;
    const url = URL.createObjectURL(
      new Blob([exportImportedStudy(study)], { type: 'application/json' })
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'manabi-yatsu-study.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  async function restore(file?: File) {
    if (!file || busy) return;
    const target = bookId;
    busy = true;
    error = '';
    status = '';
    try {
      if (file.size > 32 * 1024 * 1024) throw new Error('This archive is too large.');
      const next = await restoreImportedStudy(target, await file.text(), replace);
      if (!alive || bookId !== target) return;
      study = next;
      dispatch('changed', next);
      status = 'Imported-note archive restored.';
      editing = '';
    } catch (e) {
      if (alive && bookId === target)
        error = e instanceof Error ? e.message : 'Could not restore this archive.';
    } finally {
      if (alive && bookId === target) busy = false;
    }
  }
</script>

{#if study}
  <section class="mt-6 border-t border-border pt-4" aria-label="Imported from Yatsu">
    <h3 class="text-sm font-semibold">Imported from Yatsu</h3>
    <p class="mt-1 text-xs text-muted-foreground">
      {entries.length} saved records. These imported records stay on this device; use Export Imported
      Notes to preserve edits. Unverified positions never navigate.
    </p>
    <div class="my-3 flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled={busy} onclick={download}
        >Export Imported Notes</Button
      >
      <label
        class="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-border px-3 text-sm"
        >Restore Imported Notes<input
          class="sr-only"
          type="file"
          accept=".json,application/json"
          disabled={busy}
          onchange={(e) => {
            void restore(e.currentTarget.files?.[0]);
            e.currentTarget.value = '';
          }}
        /></label
      >
    </div>
    <label class="flex min-h-11 items-center gap-2 text-xs"
      ><input type="checkbox" bind:checked={replace} disabled={busy} />Allow archive to replace
      conflicting imported notes</label
    >
    {#if study.metadata}<details class="my-2 text-xs">
        <summary>Original book metadata</summary>
        <pre class="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify(
            study.metadata,
            null,
            2
          )}</pre>
      </details>{/if}
    {#if error}<p role="alert" class="my-2 text-sm text-destructive">{error}</p>{/if}
    {#if status}<p role="status" class="my-2 text-xs text-muted-foreground">{status}</p>{/if}
    {#each entries.slice(0, limit) as entry (entry.id)}
      <article class="border-b border-border py-3">
        <p class="text-xs font-medium text-muted-foreground">
          {entry.kind === 'notes'
            ? 'Book note'
            : entry.kind === 'highlights'
              ? 'Highlight'
              : 'Saved bookmark'} · {new Date(entry.createdAt).toLocaleDateString()}
        </p>
        {#if editing === entry.id}
          <label class="mt-2 grid gap-1 text-xs"
            >Title<input
              class="rounded-lg border border-input bg-background p-2 text-base"
              maxlength="4096"
              bind:value={title}
              disabled={busy}
            /></label
          >
          {#if entry.kind === 'notes'}<label class="mt-2 grid gap-1 text-xs"
              >Book note<textarea
                class="min-h-28 rounded-lg border border-input bg-background p-2 text-base"
                maxlength="65536"
                bind:value={text}
                disabled={busy}></textarea></label
            >{/if}
          <label class="mt-2 grid gap-1 text-xs"
            >Comment<textarea
              class="min-h-20 rounded-lg border border-input bg-background p-2 text-base"
              maxlength="65536"
              bind:value={note}
              disabled={busy}></textarea></label
          >
          <div class="mt-2 flex gap-2">
            <Button
              size="sm"
              disabled={busy}
              onclick={() =>
                change(entry, { title, note, ...(entry.kind === 'notes' ? { text } : {}) })}
              >Save</Button
            ><Button size="sm" variant="ghost" disabled={busy} onclick={() => (editing = '')}
              >Cancel</Button
            >
          </div>
        {:else}
          {#if entry.title}<h4 class="mt-1 break-words text-sm font-medium">{entry.title}</h4>{/if}
          <p class="mt-1 whitespace-pre-wrap break-words text-sm">
            {entry.text || 'Saved reading position'}
          </p>
          {#if entry.note}<p class="mt-2 whitespace-pre-wrap break-words text-sm">
              {entry.note}
            </p>{/if}
          {#if entry.unresolved}<p class="mt-1 text-xs text-muted-foreground">
              {entry.unresolved}
            </p>{/if}
          <div class="mt-2 flex flex-wrap gap-1">
            {#if entry.locator}<Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onclick={() => dispatch('navigate', entry.locator!)}>Show in Book</Button
              >{/if}
            <Button size="sm" variant="ghost" disabled={busy} onclick={() => begin(entry)}
              >Edit</Button
            >
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onclick={() => change(entry, { deleted: true })}>Remove</Button
            >
          </div>
          <details class="mt-2 text-xs text-muted-foreground">
            <summary>Original source record</summary>
            <pre
              class="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify(
                entry.source,
                null,
                2
              )}</pre>
          </details>
        {/if}
      </article>
    {/each}
    {#if entries.length > limit}<Button variant="ghost" size="sm" onclick={() => (limit += 30)}
        >Show more imported notes</Button
      >{/if}
  </section>
{/if}
