<script lang="ts">
  import * as Sheet from '$lib/components/ui/sheet';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import BookOpen from '@lucide/svelte/icons/book-open';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import List from '@lucide/svelte/icons/list';
  import Plus from '@lucide/svelte/icons/plus';
  import {
    organization,
    createCollection,
    renameCollection,
    removeCollection,
    type Collection
  } from './organization';
  import { isFinished } from './completion';
  import type { ShelfBook } from './view-model';
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
  $: keys = new Set(books.map((book) => book.key));
  $: finished = books.filter(isFinished).length;
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

<Sheet.Root bind:open>
  <Sheet.Content
    side="bottom"
    class="mx-auto max-h-[85dvh] max-w-xl overflow-y-auto rounded-t-3xl p-6 pb-10"
  >
    <Sheet.Header class="mb-6 pr-10">
      <Sheet.Title class="font-serif text-2xl">Collections</Sheet.Title>
      <Sheet.Description
        >Organize books without moving their files. A book can be in several collections.</Sheet.Description
      >
    </Sheet.Header>
    <div class="mb-5 flex justify-end">
      <Button variant="outline" onclick={() => (editing = !editing)}
        >{editing ? 'Done' : 'Edit collections'}</Button
      >
    </div>
    <div class="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
      <button
        class="collection-row"
        aria-current={active === 'books' ? 'page' : undefined}
        on:click={() => choose('books')}
        ><BookOpen aria-hidden="true" /><span>Books</span><span class="count">{books.length}</span
        ></button
      >
      <button
        class="collection-row"
        aria-current={active === 'finished' ? 'page' : undefined}
        on:click={() => choose('finished')}
        ><CircleCheck aria-hidden="true" /><span>Finished</span><span class="count">{finished}</span
        ></button
      >
    </div>
    <div
      class="mt-6 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card"
    >
      {#each $organization.collections as collection (collection.id)}
        <div>
          <button
            class="collection-row"
            aria-current={active === collection.id ? 'page' : undefined}
            on:click={() => choose(collection.id)}
            ><List aria-hidden="true" /><span class="min-w-0 break-words">{collection.name}</span
            ><span class="count">{collection.members.filter((key) => keys.has(key)).length}</span
            ></button
          >
          {#if editing}<div class="flex gap-2 px-5 pb-4">
              <Button
                variant="outline"
                onclick={() => edit(collection)}
                aria-label={`Rename collection ${collection.name}`}>Rename</Button
              ><Button
                variant="destructive"
                onclick={() => edit(collection, true)}
                aria-label={`Delete collection ${collection.name}`}>Delete collection</Button
              >
            </div>{/if}
        </div>
      {/each}
      <button class="collection-row" on:click={() => edit()}
        ><Plus aria-hidden="true" /><span>New Collection…</span></button
      >
    </div>
    <p class="mt-4 text-xs text-muted-foreground">
      Collections and display names are saved in this browser. Original files and series folders are
      unchanged.
    </p>
  </Sheet.Content>
</Sheet.Root>
<Dialog.Root bind:open={dialogOpen}>
  <Dialog.Content>
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
    <form on:submit|preventDefault={submit} class="grid gap-5">
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
        ><Button type="submit" variant={deleting ? 'destructive' : 'default'} disabled={busy}
          >{busy ? 'Saving…' : deleting ? 'Delete Collection' : 'Save'}</Button
        ></Dialog.Footer
      >
    </form>
  </Dialog.Content>
</Dialog.Root>

<style>
  .collection-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    width: 100%;
    padding: 1rem 1.25rem;
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
    margin-left: auto;
    color: var(--muted-foreground);
    font-variant-numeric: tabular-nums;
  }
</style>
