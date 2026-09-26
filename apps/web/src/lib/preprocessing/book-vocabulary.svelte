<script lang="ts">
  import type { VocabularySnapshot } from './index.d.mts';
  export let snapshot: VocabularySnapshot = { words: [], processedChapters: 0, totalChapters: 0 };
  export let openWord: (word: VocabularySnapshot['words'][number]) => void;
  let query = '';
  $: terms = snapshot.words.filter(
    (word) => word.term.includes(query.trim()) || (word.reading ?? '').includes(query.trim())
  );
</script>

<section aria-label="Book vocabulary">
  <h2>Book vocabulary</h2>
  <p role="status">{snapshot.processedChapters} of {snapshot.totalChapters} chapters processed</p>
  <label>Find a word <input type="search" bind:value={query} /></label>
  {#if terms.length === 0}
    <p>
      {snapshot.processedChapters < snapshot.totalChapters
        ? 'Vocabulary appears as chapters are processed.'
        : 'No matching words.'}
    </p>
  {:else}
    <ul>
      {#each terms as word (word.key)}
        <li>
          <button type="button" on:click={() => openWord(word)}>
            <span>{word.term}</span>
            {#if word.reading && word.reading !== word.term}<span>（{word.reading}）</span>{/if}
            <span class="occurrences"
              >{word.count} occurrences · {word.chapters.length} chapters</span
            >
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  ul {
    list-style: none;
    padding: 0;
  }
  li {
    border-bottom: 1px solid var(--border);
  }
  button {
    width: 100%;
    min-height: 44px;
    padding: 0.75rem;
    text-align: start;
  }
  button:focus-visible,
  input:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  input {
    padding: 0.5rem;
    min-height: 44px;
  }
  .occurrences {
    display: block;
    font-size: 0.85rem;
    color: var(--muted-foreground);
  }
</style>
