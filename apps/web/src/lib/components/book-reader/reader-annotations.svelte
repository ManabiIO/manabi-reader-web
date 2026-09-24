<script lang="ts">
  import ImportedStudyPanel from './imported-study.svelte';
  import type { ImportedStudy } from '$lib/manabi/yatsu-study-format';
  import type { ReaderLocator } from '$lib/reader-location';
  import { createEventDispatcher } from 'svelte';
  import * as Sheet from '$lib/components/ui/sheet';
  import { Button } from '$lib/components/ui/button';
  import {
    BookmarkSimple,
    DownloadSimple,
    Highlighter,
    NotePencil,
    Trash,
    UploadSimple
  } from 'phosphor-svelte';
  import type { ReaderAnnotation } from '$lib/data/database/books-db/versions/v7/books-db-v7';
  import type { AnnotationImportConflict } from '$lib/reader-annotations';

  export let open = false;
  export let importedStudy: ImportedStudy | undefined;
  export let bookId = 0;
  export let annotations: ReaderAnnotation[] = [];
  export let importConflicts: AnnotationImportConflict[] = [];
  export let hasSelection = false;
  export let error = '';
  export let busy = false;
  export let status = '';
  export let savedVersion = 0;
  let note = '';
  $: if (savedVersion > 0) note = '';
  const dispatch = createEventDispatcher<{
    importedStudyChanged: ImportedStudy;
    importedNavigate: ReaderLocator;
    bookmark: void;
    highlight: void;
    note: string;
    openAnnotation: ReaderAnnotation;
    remove: string;
    export: void;
    import: File;
    resolveImport: { id: string; choice: 'keep-local' | 'restore-archive' };
  }>();

  function addNote() {
    const value = note.trim();
    if (!value || busy) return;
    dispatch('note', value);
  }
</script>

<Sheet.Root {open} onOpenChange={(value) => (open = value)}>
  <Sheet.Content
    side="left"
    showCloseButton
    class="writing-horizontal-tb p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] data-[side=left]:w-full data-[side=left]:sm:max-w-md"
  >
    <Sheet.Header class="shrink-0 p-0">
      <Sheet.Title>Bookmarks & Notes</Sheet.Title>
      <Sheet.Description>Saved places and passages in this book.</Sheet.Description>
    </Sheet.Header>
    <div class="mt-5 flex shrink-0 flex-wrap gap-2">
      <Button variant="secondary" disabled={busy} onclick={() => dispatch('bookmark')}
        ><BookmarkSimple aria-hidden="true" />Add Bookmark</Button
      >
      <Button
        variant="secondary"
        disabled={busy || !hasSelection}
        onclick={() => dispatch('highlight')}
        ><Highlighter aria-hidden="true" />Highlight Selection</Button
      >
    </div>
    <div class="mt-3 flex shrink-0 flex-wrap items-center gap-2">
      <Button variant="ghost" disabled={busy} onclick={() => dispatch('export')}
        ><DownloadSimple aria-hidden="true" />Export Notes</Button
      >
      <label
        class="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-3 text-sm font-medium hover:bg-muted focus-within:outline-2 focus-within:outline-ring"
        aria-label="Import notes"
      >
        <UploadSimple aria-hidden="true" />Import Notes
        <input
          type="file"
          accept="application/json,.json"
          class="sr-only"
          disabled={busy}
          onchange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) dispatch('import', file);
            event.currentTarget.value = '';
          }}
        />
      </label>
    </div>
    {#if hasSelection}
      <div class="mt-4 grid shrink-0 gap-2">
        <label for="reader-note" class="text-sm font-medium">Note on selected passage</label>
        <textarea
          id="reader-note"
          class="min-h-24 rounded-lg border border-input bg-background p-3 text-base text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
          maxlength="65536"
          disabled={busy}
          bind:value={note}
          placeholder="Write a note…"></textarea>
        <Button disabled={busy || !note.trim()} onclick={addNote}
          ><NotePencil aria-hidden="true" />Save Note</Button
        >
      </div>
    {/if}
    {#if error}<p role="alert" class="mt-3 text-sm text-destructive">{error}</p>{/if}
    {#if status}<p role="status" class="mt-3 text-sm text-muted-foreground">{status}</p>{/if}
    {#if importConflicts.length}
      <section class="mt-4 rounded-lg border border-border p-3" aria-label="Archive conflicts">
        <h3 class="text-sm font-semibold">Archive conflicts</h3>
        <p class="mt-1 text-xs text-muted-foreground">
          Review saved passages that differ from the archive. Your current copy stays intact until
          you choose.
        </p>
        {#each importConflicts as conflict (conflict.id)}
          <div class="mt-3 border-t border-border pt-3">
            <p class="text-sm">
              {conflict.remote.body || conflict.remote.targets[0].quote || 'Saved reading position'}
            </p>
            <p class="mt-1 text-xs text-muted-foreground">
              {conflict.local.deletedAt ? 'Removed locally' : 'Different local version'}
            </p>
            <div class="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onclick={() => dispatch('resolveImport', { id: conflict.id, choice: 'keep-local' })}
                >Keep Current</Button
              >
              <Button
                size="sm"
                disabled={busy}
                onclick={() =>
                  dispatch('resolveImport', { id: conflict.id, choice: 'restore-archive' })}
                >Use Archive</Button
              >
            </div>
          </div>
        {/each}
      </section>
    {/if}
    {#key bookId}<ImportedStudyPanel
        study={importedStudy}
        {bookId}
        on:changed={(event) => dispatch('importedStudyChanged', event.detail)}
        on:navigate={(event) => dispatch('importedNavigate', event.detail)}
      />{/key}
    <div class="mt-6 shrink-0" aria-label="Saved annotations">
      {#if !annotations.length}<p class="text-sm text-muted-foreground">
          No saved bookmarks or notes yet.
        </p>{/if}
      {#each annotations as annotation (annotation.id)}
        <div class="flex items-start gap-1 border-b border-border py-2">
          <button
            type="button"
            class="min-h-11 min-w-0 flex-1 rounded-lg px-2 py-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
            onclick={() => dispatch('openAnnotation', annotation)}
          >
            <span class="block text-xs font-medium text-muted-foreground"
              >{annotation.kind === 'bookmark'
                ? 'Bookmark'
                : annotation.kind === 'note'
                  ? 'Note'
                  : 'Highlight'} · Section {annotation.targets[0].resource.spineIndex + 1}</span
            >
            <span class="mt-1 block break-words text-sm"
              >{annotation.body || annotation.targets[0].quote || 'Saved reading position'}</span
            >
            <span class="sr-only">Go to saved passage</span>
          </button>
          <Button
            variant="ghost"
            size="icon"
            class="size-11 shrink-0"
            aria-label={`Remove ${annotation.kind}`}
            disabled={busy}
            onclick={() => dispatch('remove', annotation.id)}><Trash aria-hidden="true" /></Button
          >
        </div>
      {/each}
    </div>
  </Sheet.Content>
</Sheet.Root>
