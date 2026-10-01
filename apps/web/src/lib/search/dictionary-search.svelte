<script lang="ts">
  import { onMount } from 'svelte';
  import { queryTask, type SearchState } from './query-task.mjs';
  import {
    dictionaryLease,
    type DictionaryResult,
    type DictionaryRuntime,
    type DictionaryStatus
  } from './dictionary-runtime';
  export let query = '';
  export let full = false;
  export let expand: () => void;
  export let onquery: (query: string) => void;
  let mounted = false,
    signature = '',
    attempt = 0,
    installing = false,
    retryableError = false,
    statusSignature = '',
    statusAttempt = 0,
    statusLoading = false,
    statusError = '',
    managing = '',
    pendingDelete = '',
    setupOpen = false,
    message = '';
  let state: SearchState<DictionaryResult> = { state: 'idle' };
  let dictionaryStatus: DictionaryStatus | undefined;
  let runtime: DictionaryRuntime | undefined;
  let lease: ReturnType<typeof dictionaryLease>;
  let installController: AbortController | undefined;
  let statusController: AbortController | undefined;
  let manageController: AbortController | undefined;
  const task = queryTask<DictionaryResult>((next) => {
    state = next;
    if (next.state === 'error') retryableError = true;
    if (full && next.state === 'ready' && next.value?.dictionaryCount === 0) setupOpen = true;
  });
  $: nextSignature = JSON.stringify([query, full, attempt, installing]);
  $: if (mounted && signature !== nextSignature) {
    signature = nextSignature;
    search();
  }
  $: nextStatusSignature = JSON.stringify([full, statusAttempt]);
  $: if (mounted && statusSignature !== nextStatusSignature) {
    statusSignature = nextStatusSignature;
    if (full) void refreshStatus();
    else {
      statusController?.abort();
      statusError = '';
      pendingDelete = '';
    }
  }
  $: disabledTitles = new Set(dictionaryStatus?.preferences.disabled ?? []);
  function search() {
    task.stop();
    state = { state: 'idle' };
    retryableError = false;
    if (!query.trim() || installing) return;
    if ([...query].length > 256) {
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
      if (
        value.version !== 1 ||
        value.query !== needle.trim() ||
        typeof value.prefix !== 'boolean'
      )
        throw new Error('The dictionary returned a mismatched search response.');
      publish({ state: 'ready', value });
    });
  }
  function reopenRuntime() {
    task.stop();
    lease.release();
    lease = dictionaryLease();
    runtime = undefined;
    attempt++;
    statusAttempt++;
  }
  function retry() {
    reopenRuntime();
  }
  async function refreshStatus() {
    statusController?.abort();
    const controller = (statusController = new AbortController());
    statusLoading = true;
    statusError = '';
    try {
      const opened = await lease.get();
      controller.signal.throwIfAborted();
      const next = await opened.client.status({ signal: controller.signal });
      controller.signal.throwIfAborted();
      if (mounted && full) dictionaryStatus = next;
    } catch (error) {
      if (!controller.signal.aborted && mounted && full)
        statusError =
          error instanceof Error ? error.message : 'Installed dictionaries could not be loaded.';
    } finally {
      if (statusController === controller) {
        statusController = undefined;
        if (mounted) statusLoading = false;
      }
    }
  }
  async function toggleDictionary(title: string, enabled: boolean) {
    if (managing || installing) return;
    managing = title;
    pendingDelete = '';
    message = enabled ? `Enabling ${title}…` : `Disabling ${title}…`;
    task.stop();
    try {
      const opened = await lease.get();
      const next = await opened.client.setEnabled(title, enabled);
      if (!mounted) return;
      dictionaryStatus = next;
      message = `${enabled ? 'Enabled' : 'Disabled'} ${title}.`;
      reopenRuntime();
    } catch (error) {
      if (mounted)
        message = error instanceof Error ? error.message : 'Dictionary settings could not be saved.';
    } finally {
      if (mounted) managing = '';
    }
  }
  async function deleteDictionary(title: string) {
    if (managing || installing || pendingDelete !== title) return;
    managing = title;
    message = `Deleting ${title}…`;
    task.stop();
    const controller = (manageController = new AbortController());
    try {
      const opened = await lease.get();
      controller.signal.throwIfAborted();
      const next = await opened.client.deleteDictionary(title, { signal: controller.signal });
      controller.signal.throwIfAborted();
      if (!mounted) return;
      dictionaryStatus = next;
      pendingDelete = '';
      message = `Deleted ${title}.`;
      reopenRuntime();
    } catch (error) {
      if (!controller.signal.aborted && mounted)
        message = error instanceof Error ? error.message : 'Dictionary could not be deleted.';
    } finally {
      if (manageController === controller) manageController = undefined;
      if (mounted) managing = '';
    }
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
    if (installing || managing) return;
    installing = true;
    message = 'Preparing dictionary…';
    const controller = (installController = new AbortController());
    let imported = false;
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
      imported = true;
      if (!file) await opened.client.setDefault('installed', result.summary.title);
      if (mounted) setupOpen = false;
      if (mounted)
        message = result.cancelledAfterCommit
          ? 'The dictionary finished installing before cancellation.'
          : `Installed ${result.summary.title}.${result.warnings.length ? ' Some entries could not be imported.' : ''}`;
    } catch (error) {
      if (mounted)
        message = error instanceof Error ? error.message : 'Dictionary installation failed.';
    } finally {
      if (mounted) {
        if (imported) {
          // The current translator can retain stale headword fields after a
          // commit. Reopen against the durable dictionary before searching.
          reopenRuntime();
        }
        installing = false;
        if (!imported) {
          attempt++;
          statusAttempt++;
        }
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
      statusController?.abort();
      manageController?.abort();
      lease.release();
    };
  });
</script>

<section
  aria-labelledby="dictionary-search-heading"
  aria-busy={state.state === 'loading' || installing || statusLoading || !!managing}
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
      {state.error}{#if retryableError}
        <button type="button" onclick={retry}>Retry dictionary</button>
      {/if}
    </p>
  {:else if state.value}
    {#if state.value.dictionaryCount === 0}
      <p class="note">
        No enabled local dictionary yet. {#if !full}<button type="button" onclick={expand}
            >Set up dictionary</button
          >{/if}
      </p>
    {:else}
      {#if state.value.prefix}<p class="note">
          Showing prefix matches for <span lang="ja">{state.value.matchedQuery}</span>
        </p>{:else if state.value.matchedQuery !== query.trim()}<p class="note">
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
            No dictionary matches. Keep typing, try kana or another spelling, or use a trailing * for an explicit prefix search.
          </p>{/if}
      {/if}
    {/if}
  {/if}
  {#if full}
    <details class="setup" bind:open={setupOpen}>
      <summary>Local dictionaries</summary>
      <p class="note">
        These dictionaries stay in this browser and are separate from your extension’s dictionaries.
        Import your existing Yomitan ZIPs or install Jitendex. Nothing installs automatically.
      </p>
      {#if statusLoading}
        <p class="note" role="status">Loading installed dictionaries…</p>
      {:else if statusError}
        <p class="note" role="status">
          {statusError} <button type="button" onclick={() => void refreshStatus()}>Retry list</button>
        </p>
      {:else if dictionaryStatus?.dictionaries.length}
        <ul class="dictionary-list" aria-label="Installed local dictionaries">
          {#each dictionaryStatus.dictionaries as dictionary (dictionary.title)}
            <li class="dictionary-row">
              <span class="dictionary-copy"
                ><strong>{dictionary.title}</strong><small
                  >{disabledTitles.has(dictionary.title) ? 'Disabled' : 'Enabled'}{dictionary.revision
                    ? ` · ${dictionary.revision}`
                    : ''}</small
                >{#if dictionary.author}<small>{dictionary.author}</small>{/if}</span
              >
              <span class="dictionary-actions">
                <button
                  type="button"
                  disabled={installing || !!managing}
                  aria-label={`${disabledTitles.has(dictionary.title) ? 'Enable' : 'Disable'} ${dictionary.title}`}
                  onclick={() =>
                    void toggleDictionary(dictionary.title, disabledTitles.has(dictionary.title))}
                  >{disabledTitles.has(dictionary.title) ? 'Enable' : 'Disable'}</button
                >
                {#if pendingDelete === dictionary.title}
                  <span class="delete-confirm" role="group" aria-label={`Delete ${dictionary.title}`}>
                    <span>Delete this dictionary?</span>
                    <button
                      type="button"
                      disabled={installing || !!managing}
                      aria-label={`Confirm delete ${dictionary.title}`}
                      onclick={() => void deleteDictionary(dictionary.title)}>Delete</button
                    >
                    <button
                      type="button"
                      disabled={installing || !!managing}
                      aria-label={`Cancel deleting ${dictionary.title}`}
                      onclick={() => (pendingDelete = '')}>Cancel</button
                    >
                  </span>
                {:else}
                  <button
                    type="button"
                    disabled={installing || !!managing}
                    aria-label={`Delete ${dictionary.title}`}
                    onclick={() => (pendingDelete = dictionary.title)}>Delete…</button
                  >
                {/if}
              </span>
            </li>
          {/each}
        </ul>
      {:else if dictionaryStatus}
        <p class="note">No local dictionaries are installed.</p>
      {/if}
      <div class="setup-actions">
        <button type="button" disabled={installing || !!managing} onclick={() => void install()}
          >Install Jitendex</button
        ><label class="upload"
          >Import dictionary ZIP<input
            type="file"
            accept=".zip,application/zip"
            disabled={installing || !!managing}
            onchange={chooseArchive}
          /></label
        >{#if installing}<button type="button" onclick={() => installController?.abort()}
            >Cancel installation</button
          >{/if}
      </div>
      <p class="note">
        Jitendex by Stephen Kraus · CC BY-SA 4.0. Includes JMdict, Tatoeba and JmdictFurigana data.
        The full dictionary retains its source labels.
      </p>
    </details>
    {#if message}<p class="note" role="status">{message}</p>{/if}
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
  .dictionary-list {
    margin-block: 0.75rem 1rem;
  }
  .dictionary-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.75rem 0;
    border-bottom: 1px solid var(--border);
  }
  .dictionary-copy {
    display: grid;
    gap: 0.15rem;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .dictionary-actions,
  .delete-confirm {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .delete-confirm > span {
    font-size: 0.8rem;
    color: var(--muted-foreground);
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
  @media (max-width: 640px) {
    .dictionary-row {
      align-items: stretch;
      flex-direction: column;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation: none;
    }
  }
</style>
