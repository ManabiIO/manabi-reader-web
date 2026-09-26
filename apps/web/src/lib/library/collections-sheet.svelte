<script lang="ts">
  import { tick } from 'svelte';
  import * as Sheet from '$lib/components/ui/sheet';
  import * as Dialog from '$lib/components/ui/dialog';
  import CloseButton from '$lib/components/ui/close-button.svelte';
  import { Button } from '$lib/components/ui/button';
  import {
    BookOpenIcon as BookOpen,
    BookmarkSimpleIcon as BookmarkSimple,
    CaretRightIcon as CaretRight,
    CheckCircleIcon as CircleCheck,
    ListIcon as List,
    PencilSimpleIcon as PencilSimple,
    PlusIcon as Plus,
    TrashIcon as Trash
  } from 'phosphor-svelte';
  import {
    organization,
    createCollection,
    renameCollection,
    removeCollection,
    type Collection
  } from './organization';
  import { isFinished } from './completion';
  import type { ShelfBook } from './view-model';
  import { WANT_TO_READ_ID, wantToReadCollection, collectionContains } from './want-to-read';
  export let open = false;
  export let books: ShelfBook[] = [];
  export let active = 'books';
  export let onchoose: (id: string) => void;
  let editButton: HTMLElement | null = null;
  let editing = false,
    dialogOpen = false,
    target: Collection | undefined,
    deleting = false,
    name = '',
    error = '',
    busy = false;
  $: wantToRead = wantToReadCollection($organization);
  $: customCollections = $organization.collections.filter(
    (collection) => collection.id !== WANT_TO_READ_ID
  );
  $: finished = books.filter(isFinished).length;
  $: if (!open) editing = false;
  function choose(id: string) {
    onchoose(id);
    open = false;
  }
  function edit(collection?: Collection, remove = false) {
    target = collection;
    deleting = remove;
    name = collection?.name || '';
    error = '';
    dialogOpen = true;
  }
  async function submit() {
    if (busy) return;
    busy = true;
    error = '';
    try {
      if (deleting && target) {
        await removeCollection(target.id);
        if (active === target.id) choose('books');
      } else if (target) await renameCollection(target.id, name);
      else await createCollection(name);
      dialogOpen = false;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not update the collection.';
    } finally {
      busy = false;
    }
  }
</script>

<!-- The edit form replaces the sheet while it is open. Two simultaneous modal
     dialogs leave the underlying collection controls in the accessibility tree. -->
{#if !dialogOpen}<Sheet.Root bind:open>
    <Sheet.Content
      id="library-collections-sheet"
      side="bottom"
      class="mx-auto max-h-[90dvh] max-w-xl overflow-y-auto rounded-t-3xl p-[20px] px-[16px] pb-[40px] sm:p-[24px]"
      showCloseButton={false}
      onOpenAutoFocus={(event) => {
        // This action sheet starts at its visible Edit control, unlike an
        // information/search sheet with potentially offscreen editable fields.
        if (editButton?.isConnected) {
          event.preventDefault();
          editButton.focus({ preventScroll: true });
        }
      }}
    >
      <Sheet.Header class="mb-6 flex shrink-0 flex-row flex-wrap items-center justify-between gap-3 p-0">
        <Sheet.Title class="min-w-0 font-serif text-xl sm:text-2xl">Collections</Sheet.Title>
        <div class="ms-auto flex shrink-0 items-center gap-2">
          <Button
            bind:ref={editButton}
            variant="secondary"
            class="min-h-11 rounded-full px-4"
            aria-pressed={editing}
            onclick={() => (editing = !editing)}>{editing ? 'Done' : 'Edit'}</Button
          >
          <CloseButton
            aria-label="Close collections"
            onclick={() => (open = false)}
          />
        </div>
        <Sheet.Description class="sr-only"
          >Organize books without moving their files. A book can be in several collections.</Sheet.Description
        >
      </Sheet.Header>
      <div class="shrink-0 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        <button
          class="collection-row"
          aria-current={active === 'books' ? 'page' : undefined}
          onclick={() => choose('books')}
          ><BookOpen aria-hidden="true" /><span>Books</span><span class="count">{books.length}</span
          ><CaretRight class="text-muted-foreground" aria-hidden="true" /></button
        >
        <button
          class="collection-row"
          aria-current={active === WANT_TO_READ_ID ? 'page' : undefined}
          onclick={() => choose(WANT_TO_READ_ID)}
          ><BookmarkSimple aria-hidden="true" /><span>Want to Read</span><span class="count"
            >{books.filter((book) => collectionContains(wantToRead, book)).length}</span
          ><CaretRight class="text-muted-foreground" aria-hidden="true" /></button
        >
        <button
          class="collection-row"
          aria-current={active === 'finished' ? 'page' : undefined}
          onclick={() => choose('finished')}
          ><CircleCheck aria-hidden="true" /><span>Finished</span><span class="count"
            >{finished}</span
          ><CaretRight class="text-muted-foreground" aria-hidden="true" /></button
        >
      </div>
      <div
        class="mt-6 shrink-0 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card"
      >
        {#each customCollections as collection (collection.id)}
          <div class="collection-entry">
            <button
              class="collection-row"
              aria-current={active === collection.id ? 'page' : undefined}
              onclick={() => choose(collection.id)}
              ><List aria-hidden="true" /><span class="min-w-0 [overflow-wrap:anywhere]">{collection.name}</span
              ><span class="count"
                >{books.filter((book) => collectionContains(collection, book)).length}</span
              >{#if !editing}<CaretRight
                  class="text-muted-foreground"
                  aria-hidden="true"
                />{/if}</button
            >
            {#if editing}<div class="collection-actions">
                <Button
                  variant="ghost"
                  size="icon"
                  class="size-11"
                  onclick={() => edit(collection)}
                  aria-label={`Rename collection ${collection.name}`}
                  title="Rename collection"><PencilSimple aria-hidden="true" /></Button
                ><Button
                  variant="ghost"
                  size="icon"
                  class="size-11 text-destructive hover:text-destructive"
                  onclick={() => edit(collection, true)}
                  aria-label={`Delete collection ${collection.name}`}
                  title="Delete collection"><Trash aria-hidden="true" /></Button
                >
              </div>{/if}
          </div>
        {/each}
        <button class="collection-row" onclick={() => edit()}
          ><Plus aria-hidden="true" /><span>New Collection…</span></button
        >
      </div>
      <p class="mt-4 shrink-0 text-xs text-muted-foreground">
        Collections and book overrides sync with your Manabi Reader settings when account sync is
        on. Unavailable books stay in their collections and reappear when their library is
        connected.
      </p>
    </Sheet.Content>
  </Sheet.Root>{/if}
<Dialog.Root bind:open={dialogOpen}>
  <Dialog.Content
    closeDisabled={busy}
    class="px-[16px] sm:px-[24px] [&_[data-slot=dialog-footer]_button]:min-h-11"
    onCloseAutoFocus={(event) => {
      event.preventDefault();
      void tick().then(() => {
        const sheet = document.getElementById('library-collections-sheet');
        const target =
          sheet?.querySelector<HTMLButtonElement>('[aria-current="page"]') ??
          sheet?.querySelector<HTMLButtonElement>('button') ??
          document.querySelector<HTMLElement>('[aria-label="Library shelves"]');
        target?.focus();
      });
    }}
  >
    <Dialog.Header
      ><Dialog.Title
        >{deleting
          ? 'Delete collection?'
          : target
            ? 'Rename collection'
            : 'New collection'}</Dialog.Title
      ><Dialog.Description
        >{deleting
          ? 'Only this collection is removed. Its books, progress and files are kept.'
          : 'Choose a name for this collection.'}</Dialog.Description
      ></Dialog.Header
    >
    <form
      onsubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      class="grid gap-5"
      aria-busy={busy}
    >
      {#if !deleting}<label class="grid min-w-0 gap-2"
          >Name<input
            class="min-h-11 min-w-0 w-full rounded-xl border border-input bg-background px-3 text-base sm:text-sm"
            bind:value={name}
            disabled={busy}
            required
            maxlength="240"
          /></label
        >{/if}
      {#if error}<p role="alert" class="text-destructive">{error}</p>{/if}
      <Dialog.Footer
        ><Button variant="outline" onclick={() => (dialogOpen = false)} disabled={busy}
          >Cancel</Button
        ><Button type="submit" variant={deleting ? 'destructive' : 'secondary'} disabled={busy}
          >{busy ? 'Saving…' : deleting ? 'Delete Collection' : 'Save'}</Button
        >
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<style>
  .collection-row {
    display: grid;
    grid-template-columns: min(1.5rem, 24px) minmax(0, 1fr) auto auto;
    align-items: center;
    gap: min(0.75rem, 12px);
    width: 100%;
    padding: 0.875rem min(1rem, 16px);
    text-align: left;
    font-size: 1.1rem;
    min-height: 60px;
  }
  .collection-row :global(svg) {
    width: min(1.5rem, 24px);
    height: min(1.5rem, 24px);
    flex-shrink: 0;
  }
  .collection-row:hover,
  .collection-row[aria-current='page'] {
    background: var(--muted);
  }
  .collection-row:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: -3px;
  }
  .count {
    color: var(--muted-foreground);
    font-variant-numeric: tabular-nums;
  }
  .collection-entry {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
  }
  .collection-entry > .collection-row {
    flex: 1 1 14rem;
    min-width: 0;
  }
  .collection-actions {
    display: flex;
    gap: 0.15rem;
    margin-inline-start: auto;
    padding-inline: 0.5rem;
    padding-block-end: 0.25rem;
  }
</style>
