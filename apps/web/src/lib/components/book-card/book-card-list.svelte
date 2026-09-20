<script lang="ts">
  import BookCard from './book-card.svelte';
  import type { BookCardProps } from './book-card-props';
  import * as Menu from '$lib/components/ui/dropdown-menu';
  import ActionMenu from '$lib/components/navigation/action-menu.svelte';
  import { createEventDispatcher } from 'svelte';
  export let bookCards: BookCardProps[] = [];
  export let currentBookId: number | undefined;
  export let selectedBookIds: ReadonlySet<number>;
  const dispatch = createEventDispatcher<{
    bookClick: { id: number };
    removeBookClick: { id: number };
  }>();
  function dateInfo(time: number) {
    return time ? new Date(time).toLocaleString() : 'No Data';
  }
</script>

<div class="grid grid-cols-2 gap-4 pb-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
  {#each bookCards as book (book.id)}
    <article class="min-w-0" class:opacity-60={book.isPlaceholder} aria-label={book.title}>
      <div
        class="relative rounded-2xl"
        class:ring-2={selectedBookIds.has(book.id)}
        class:ring-primary={selectedBookIds.has(book.id)}
      >
        <BookCard {...book} on:click={() => dispatch('bookClick', { id: book.id })} />
        {#if selectedBookIds.has(book.id)}<span
            class="pointer-events-none absolute left-2 top-2 rounded-full bg-primary px-2 py-1 text-xs text-primary-foreground"
            >Selected</span
          >{/if}
        {#if book.id === currentBookId}<span
            class="pointer-events-none absolute right-2 top-2 rounded-full bg-card px-2 py-1 text-xs"
            >Reading</span
          >{/if}
      </div>
      <div class="mt-2 flex justify-end">
        <ActionMenu label="Book actions" title={`Actions for ${book.title}`}>
          <Menu.Item onSelect={() => dispatch('bookClick', { id: book.id })}
            >Open or select book</Menu.Item
          >
          <Menu.Separator /><Menu.Label>Book details</Menu.Label>
          <div class="space-y-2 px-2 py-2 text-xs text-muted-foreground">
            <p>Characters: {book.characters || 'No Data'}</p>
            <p>Last Read: {dateInfo(book.lastBookOpen)}</p>
            <p>Bookmarked: {dateInfo(book.lastBookmarkModified)}</p>
            <p>Last Update: {dateInfo(book.lastBookModified)}</p>
          </div>
          <Menu.Separator /><Menu.Item
            variant="destructive"
            onSelect={() => dispatch('removeBookClick', { id: book.id })}>Remove book</Menu.Item
          >
        </ActionMenu>
      </div>
    </article>
  {/each}
</div>
