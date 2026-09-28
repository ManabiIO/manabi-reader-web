<script lang="ts">
  import { onMount } from 'svelte';
  import { queryTask, type SearchState } from './query-task.mjs';
  import {
    dictionaryLease,
    type DictionaryResult,
    type DictionaryRuntime
  } from './dictionary-runtime';
  export let query = '';
  export let full = false;
  export let expand: () => void;
  export let onquery: (query: string) => void;
  let mounted = false,
    signature = '',
    attempt = 0,
    installing = false,
    message = '';
  let state: SearchState<DictionaryResult> = { state: 'idle' };
  let runtime: DictionaryRuntime | undefined;
  let lease: ReturnType<typeof dictionaryLease>;
  let installController: AbortController | undefined;
  const task = queryTask<DictionaryResult>((next) => {
    state = next;
  });
  $: nextSignature = JSON.stringify([query, full, attempt, installing]);
  $: if (mounted && signature !== nextSignature) {
    signature = nextSignature;
    search();
  }
  function search() {
    task.stop();
    state = { state: 'idle' };
    if (!query.trim() || installing) return;
    if (query.length > 256) {
      state = {
        state: 'error',
        error:
          'Use a dictionary query of 256 characters or fewer. Titles and content can use longer queries.'
      };
      return;
    }
    const needle = query,
      detailed = full;
    task.start(async (signal, publish) => {
      const opened = await lease.get();
      signal.throwIfAborted();
      runtime = opened;
      const value = await opened.client.search(needle, detailed, { signal });
      signal.throwIfAborted();
      if (value.version !== 1 || value.query !== needle.trim())
        throw new Error('The dictionary returned a mismatched search response.');
      publish({ state: 'ready', value });
    });
  }
  function retry() {
    task.stop();
    lease.release();
    lease = dictionaryLease();
    attempt++;
  }
  function definitions(node: HTMLElement, value: DictionaryResult) {
    const dispose =
      runtime && value.lookup
        ? runtime.render(node, value.lookup, runtime.client, onquery)
        : undefined;
    return {
      destroy() {
        dispose?.();
      }
    };
  }
  async function install(file?: File) {
    if (installing) return;
    installing = true;
    message = 'Preparing dictionary…';
    const controller = (installController = new AbortController());
    try {
      const opened = await lease.get();
      controller.signal.throwIfAborted();
      const blob =
        file ??
        (await opened.installDefault({
          signal: controller.signal,
          onProgress: (loaded, total) => {
            if (mounted) message = `Downloading dictionary… ${Math.floor((loaded / total) * 100)}%`;
          }
        }));
      if (blob.size > 256 * 1024 * 1024 || !blob.size)
        throw new Error('Choose a dictionary ZIP between 1 byte and 256 MiB.');
      message = 'Importing dictionary…';
      const result = await opened.client.importDictionary(blob, {
        signal: controller.signal,
        onProgress: () => {}
      });
      if (!file) await opened.client.setDefault('installed', result.summary.title);
      if (mounted)
        message = result.cancelledAfterCommit
          ? 'The dictionary finished installing before cancellation.'
          : `Installed ${result.summary.title}.${result.warnings.length ? ' Some entries could not be imported.' : ''}`;
    } catch (error) {
      if (mounted)
        message = error instanceof Error ? error.message : 'Dictionary installation failed.';
    } finally {
      if (mounted) {
        installing = false;
        attempt++;
      }
      if (installController === controller) installController = undefined;
    }
  }
  function chooseArchive(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void install(file);
  }
  onMount(() => {
    lease = dictionaryLease();
    mounted = true;
    return () => {
      mounted = false;
      task.stop();
      installController?.abort();
      lease.release();
    };
  });
</script>

<section
  aria-labelledby="dictionary-search-heading"
  aria-busy={state.state === 'loading' || installing}
>
  <header>
    <h2 id="dictionary-search-heading">Dictionary</h2>
    {#if !full}<button type="button" onclick={expand}
        >See all dictionary results <span aria-hidden="true">→</span></button
      >{/if}
  </header>
  {#if state.state === 'loading'}
    <p class="note" role="status">
      <span class="spinner" aria-hidden="true"></span>Searching dictionary…
    </p>
  {:else if state.state === 'error'}
    <p class="note" role="status">
      {state.error} <button type="button" onclick={retry}>Retry dictionary</button>
    </p>
  {:else if state.value}
    {#if state.value.dictionaryCount === 0}
      <p class="note">
        No enabled local dictionary yet. {#if !full}<button type="button" onclick={expand}
            >Set up dictionary</button
          >{/if}
      </p>
    {:else}
      {#if state.value.matchedQuery !== query.trim()}<p class="note">
          Showing matches for <span lang="ja">{state.value.matchedQuery}</span>
        </p>{/if}
      {#if full && state.value.lookup}
        {#key state.value}<div class="full-dictionary" use:definitions={state.value}></div>{/key}
      {:else}
        <ul aria-label="Dictionary previews">
          {#each state.value.preview.items as item (item.id)}
            <li>
              <button type="button" class="preview" onclick={expand}>
                <span class="headword" lang="ja">{item.term}</span
                >{#if item.reading !== item.term}<span class="reading" lang="ja"
                    >{item.reading}</span
                  >{/if}
                {#each item.senses.slice(0, 1) as sense}<span class="sense"
                    >{sense.text}<small
                      >{sense.source}{sense.tags.length
                        ? ` · ${sense.tags.join(' · ')}`
                        : ''}</small
                    ></span
                  >{/each}
                {#if !item.senses.length}<span class="note">Open full definition</span>{/if}
              </button>
            </li>
          {/each}
        </ul>
        {#if !state.value.preview.items.length}<p class="note">
            No dictionary matches. Try kana, another spelling, or a trailing * for prefix search.
          </p>{/if}
      {/if}
    {/if}
  {/if}
  {#if full}
    <details class="setup" open={state.value?.dictionaryCount === 0}>
      <summary>Local dictionaries</summary>
      <p class="note">
        These dictionaries stay in this browser and are separate from your extension’s dictionaries.
        Import your existing Yomitan ZIPs or install Jitendex. Nothing installs automatically.
      </p>
      <div class="setup-actions">
        <button type="button" disabled={installing} onclick={() => void install()}
          >Install Jitendex</button
        ><label class="upload"
          >Import dictionary ZIP<input
            type="file"
            accept=".zip,application/zip"
            disabled={installing}
            onchange={chooseArchive}
          /></label
        >{#if installing}<button type="button" onclick={() => installController?.abort()}
            >Cancel installation</button
          >{/if}
      </div>
      {#if message}<p class="note" role="status">{message}</p>{/if}
      <p class="note">
        Jitendex by Stephen Kraus · CC BY-SA 4.0. Includes JMdict, Tatoeba and JmdictFurigana data.
        The full dictionary retains its source labels.
      </p>
    </details>
  {/if}
</section>

<style>
  section {
    min-width: 0;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }
  h2 {
    font-size: 1.125rem;
    font-weight: 650;
  }
  button,
  summary,
  .upload {
    min-height: 44px;
    border-radius: 0.65rem;
    padding: 0.65rem 0.8rem;
  }
  button:focus-visible,
  summary:focus-visible,
  .upload:focus-within {
    outline: 2px solid currentColor;
    outline-offset: 3px;
  }
  header button,
  .note button {
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0.5rem 0 0;
    display: grid;
    gap: 0.5rem;
  }
  .preview {
    display: block;
    text-align: start;
    width: 100%;
    padding: 1rem;
    border: 1px solid var(--border);
  }
  .preview:hover {
    background: var(--muted);
  }
  .headword {
    font-size: 1.4rem;
    font-weight: 600;
  }
  .reading {
    font-size: 0.9rem;
    margin-inline-start: 0.7rem;
  }
  .sense {
    display: block;
    margin-top: 0.4rem;
    line-height: 1.65;
    overflow-wrap: anywhere;
  }
  small {
    display: block;
    font-size: 0.75rem;
    opacity: 0.75;
  }
  .note {
    font-size: 0.875rem;
    line-height: 1.6;
    color: var(--muted-foreground);
    margin: 0.7rem 0;
    overflow-wrap: anywhere;
  }
  .spinner {
    display: inline-block;
    width: 0.8rem;
    height: 0.8rem;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin-inline-end: 0.4rem;
  }
  .setup {
    margin-top: 1.25rem;
    border-top: 1px solid var(--border);
    padding-top: 0.5rem;
  }
  .setup-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }
  .setup-actions > button,
  .upload {
    background: var(--muted);
  }
  .upload {
    position: relative;
    overflow: hidden;
    cursor: pointer;
  }
  .upload input {
    position: absolute;
    inset: 0;
    opacity: 0;
    width: 100%;
    cursor: pointer;
  }
  .full-dictionary :global(.dictionary-entry) {
    border-bottom: 1px solid var(--border);
    padding: 1.5rem 0;
  }
  .full-dictionary :global(.headword) {
    font-size: 1.6rem;
    line-height: 2;
  }
  .full-dictionary :global(.dictionary-name),
  .full-dictionary :global(.frequency) {
    font-size: 0.8rem;
    color: var(--muted-foreground);
    margin: 0.8rem 0 0.4rem;
  }
  .full-dictionary :global(ol) {
    list-style: decimal;
    padding-inline-start: 1.5rem;
    line-height: 1.75;
  }
  .full-dictionary :global(img) {
    max-width: 100%;
    height: auto;
  }
  .full-dictionary {
    overflow-wrap: anywhere;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation: none;
    }
  }
</style>
