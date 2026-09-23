<script lang="ts">
  import { tick } from 'svelte';
  import * as Sheet from '$lib/components/ui/sheet';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import {
    BookOpenIcon as BookOpen,
    BookmarkSimpleIcon as BookmarkSimple,
    CaretRightIcon as CaretRight,
    CheckCircleIcon as CircleCheck,
    ListIcon as List,
    PencilSimpleIcon as PencilSimple,
    PlusIcon as Plus,
    TrashIcon as Trash,
    XIcon
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
      class="mx-auto max-h-[90dvh] max-w-xl overflow-y-auto rounded-t-3xl p-5 pb-10 sm:p-6"
      showCloseButton={false}
    >
      <Sheet.Header class="mb-6 flex flex-row items-center justify-between gap-3 p-0">
        <Sheet.Title class="font-serif text-2xl">Collections</Sheet.Title>
        <div class="flex shrink-0 gap-2">
          <Button
            variant="secondary"
            class="min-h-11 rounded-full px-4"
            aria-pressed={editing}
            onclick={() => (editing = !editing)}>{editing ? 'Done' : 'Edit'}</Button
          >
          <Button
            variant="secondary"
            size="icon"
            class="size-11 rounded-full"
            aria-label="Close collections"
            title="Close"
            onclick={() => (open = false)}><XIcon class="size-5" aria-hidden="true" /></Button
          >
        </div>
        <Sheet.Description class="sr-only"
          >Organize books without moving their files. A book can be in several collections.</Sheet.Description
        >
      </Sheet.Header>
      <div class="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
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
        class="mt-6 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card"
      >
        {#each customCollections as collection (collection.id)}
          <div class="collection-entry">
            <button
              class="collection-row"
              aria-current={active === collection.id ? 'page' : undefined}
              onclick={() => choose(collection.id)}
              ><List aria-hidden="true" /><span class="min-w-0 break-words">{collection.name}</span
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
      <p class="mt-4 text-xs text-muted-foreground">
        Collections and book overrides sync with your Manabi Reader settings when account sync is
        on. Unavailable books stay in their collections and reappear when their library is
        connected.
      </p>
    </Sheet.Content>
  </Sheet.Root>{/if}
<Dialog.Root bind:open={dialogOpen}>
  <Dialog.Content
    class="max-h-[85dvh] overflow-y-auto [&_[data-slot=dialog-close]]:top-3 [&_[data-slot=dialog-close]]:right-3 [&_[data-slot=dialog-close]]:size-11 [&_[data-slot=dialog-footer]_button]:min-h-11"
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
      ><Dialog.Title class="pr-8"
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
    >
      {#if !deleting}<label class="grid gap-2"
          >Name<input
            class="min-h-11 rounded-xl border border-input bg-background px-3"
            bind:value={name}
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
        ></Dialog.Footer
      >
    </form>
  </Dialog.Content>
</Dialog.Root>

<style>
  .collection-row {
    display: grid;
    grid-template-columns: 1.5rem minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    padding: 0.875rem 1rem;
    text-align: left;
    font-size: 1.1rem;
    min-height: 60px;
  }
  .collection-row :global(svg) {
    width: 1.5rem;
    height: 1.5rem;
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
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
  }
  .collection-actions {
    display: flex;
    gap: 0.15rem;
    padding-right: 0.5rem;
  }
</style>
