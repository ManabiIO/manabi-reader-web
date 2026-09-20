<script lang="ts">
  import BookCover from './book-cover.svelte';
  import type { ShelfBook } from './view-model';
  export let books: ShelfBook[];
  export let hero = false;
  $: visible = books.slice(0, hero ? 5 : 2);
</script>

<div class="cover-stack" class:hero aria-hidden="true" data-cover-count={visible.length}>
  {#each visible as book, index}
    <div class="stack-item" class:front={index === 0} style:--index={index}>
      <BookCover imagePath={book.imagePath} title={book.title} direction={book.direction} />
    </div>
  {/each}
</div>

<style>
  .cover-stack {
    position: relative;
    width: 100%;
    height: 100%;
  }
  .stack-item {
    position: absolute;
    width: 90%;
    height: 94%;
    bottom: 6%;
    right: 0;
    z-index: 1;
  }
  .stack-item.front {
    bottom: 0;
    left: 0;
    right: auto;
    z-index: 5;
  }
  .hero {
    width: min(100%, 30rem);
    aspect-ratio: 1.4;
    height: auto;
    margin-inline: auto;
  }
  .hero .stack-item {
    width: 40%;
    height: 90%;
    bottom: 5%;
    left: 18%;
    right: auto;
    z-index: 3;
  }
  .hero .stack-item:nth-child(3) {
    left: auto;
    right: 18%;
  }
  .hero .stack-item:nth-child(4) {
    width: 35%;
    height: 80%;
    bottom: 10%;
    left: 1%;
    z-index: 2;
  }
  .hero .stack-item:nth-child(5) {
    width: 35%;
    height: 80%;
    bottom: 10%;
    right: 1%;
    left: auto;
    z-index: 2;
  }
  .hero .stack-item.front {
    width: 46%;
    height: 100%;
    bottom: 0;
    left: 27%;
    z-index: 5;
  }
</style>
