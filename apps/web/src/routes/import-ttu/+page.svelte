<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import { base } from '$app/paths';
  import {
    TtuMigration,
    migratedBookChoices,
    type MigrationItem,
    type MigratedBookChoice
  } from '$lib/manabi/ttu-migration';
  import {
    importLabels,
    MigrationConflict,
    type ImportPart
  } from '$lib/manabi/ttu-migration-format';

  interface Row extends MigrationItem {
    key: string;
    source: TtuMigration;
    selected: boolean;
    targetId: number;
    status: string;
    message: string;
    bookId?: number;
  }
  let rows: Row[] = [];
  let sources: TtuMigration[] = [];
  let choices: MigratedBookChoice[] = [];
  let parts = Object.keys(importLabels) as ImportPart[];
  let busy = false;
  let message = '';
  let controller: AbortController | undefined;
  let stopped = false;
  let completed = 0;
  let total = 0;
  let page = 0;
  const pageSize = 50;
  $: visibleRows = rows.slice(page * pageSize, (page + 1) * pageSize);
  $: selected = rows.filter((row) => row.selected && !row.error);
  $: ignored = sources.reduce((count, source) => count + source.ignoredFiles, 0);

  function describe(error: unknown): string {
    if (error instanceof DOMException && error.name === 'QuotaExceededError')
      return 'Not enough browser storage. This item was not imported; completed items were kept.';
    return error instanceof Error ? error.message : 'This item could not be imported.';
  }
  async function choose(files: File[]) {
    if (busy || !files.length) return;
    busy = true;
    message = '';
    controller = new AbortController();
    for (const file of files) {
      if (controller.signal.aborted || stopped) break;
      try {
        const source = await TtuMigration.inspect(file, controller.signal);
        if (stopped) {
          await source.close();
          break;
        }
        sources = [...sources, source];
        const sourceId = crypto.randomUUID();
        rows = [
          ...rows,
          ...source.items.map((item) => ({
            ...item,
            source,
            key: `${sourceId}/${item.id}`,
            selected: !item.error,
            targetId: 0,
            status: item.error ? 'error' : 'ready',
            message: item.error ?? ''
          }))
        ];
      } catch (error) {
        if (!controller.signal.aborted) message += `${file.name}: ${describe(error)} `;
      }
    }
    try {
      choices = await migratedBookChoices();
    } catch (error) {
      message += describe(error);
    }
    if (controller.signal.aborted) message = 'Stopped inspecting files. Ready items were kept.';
    busy = false;
  }
  async function run(items: Row[], replace = false) {
    if (busy || !items.length) return;
    busy = true;
    message = '';
    controller = new AbortController();
    completed = 0;
    total = items.length;
    for (const row of items) {
      if (controller.signal.aborted || stopped) break;
      row.status = 'importing';
      row.message = 'Importing…';
      rows = rows.map((item) => (item.key === row.key ? { ...row } : item));
      try {
        const result = await row.source.importItem(
          row.id,
          { parts, targetId: row.targetId || undefined, replace },
          controller.signal
        );
        row.status = result.status;
        row.message =
          result.status === 'unchanged'
            ? 'Already imported; existing data kept.'
            : `Imported ${result.title}.`;
        row.bookId = result.bookId;
        row.selected = false;
      } catch (error) {
        row.status = error instanceof MigrationConflict ? 'conflict' : 'error';
        row.message = controller.signal.aborted
          ? 'Cancelled. This item was not imported.'
          : describe(error);
      }
      completed++;
      rows = rows.map((item) => (item.key === row.key ? { ...row } : item));
    }
    await Promise.all(sources.map((source) => source.close().catch(() => undefined)));
    let refreshError = '';
    try {
      choices = await migratedBookChoices();
    } catch (error) {
      refreshError = describe(error);
    }
    message = controller.signal.aborted
      ? 'Stopped. Completed imports were kept; unfinished items can be retried.'
      : 'Finished. Your original ZIPs are unchanged.';
    if (refreshError) message += ` ${refreshError}`;
    busy = false;
  }
  function cancel() {
    controller?.abort();
  }
  function clear() {
    if (busy) return;
    void Promise.all(sources.map((source) => source.close().catch(() => undefined)));
    page = 0;
    rows = [];
    sources = [];
    message = '';
    completed = 0;
    total = 0;
  }
  beforeNavigate(({ cancel: prevent, type }) => {
    if (!busy) return;
    if (type === 'leave') {
      prevent();
      return;
    }
    if (!window.confirm('Stop importing? Completed imports will be kept.')) prevent();
    else cancel();
  });
  onMount(() => {
    void migratedBookChoices()
      .then((value) => {
        if (!stopped) choices = value;
      })
      .catch((error) => {
        if (!stopped) message = describe(error);
      });
  });
  onDestroy(() => {
    stopped = true;
    cancel();
    void Promise.all(sources.map((source) => source.close().catch(() => undefined)));
  });
</script>

<svelte:head><title>Import from Ttu Ebook Reader · Manabi Reader</title></svelte:head>

<main class="migration-page">
  <nav aria-label="Reader navigation">
    <a href="{base}/manage">Books</a><a href="{base}/connections">Accounts and libraries</a>
  </nav>
  <h1>Import from Ttu Ebook Reader</h1>
  <section aria-labelledby="export-instructions">
    <h2 id="export-instructions">Export in Ttu Ebook Reader</h2>
    <ol>
      <li>
        In Book Manager, enter selection mode and select books or <strong>Select All Books</strong>.
      </li>
      <li>Choose <strong>Export → ZIP File</strong>.</li>
      <li>
        Include <strong>Book Data</strong>, <strong>Bookmark</strong> and
        <strong>Statistics</strong>, then choose <strong>Start</strong>.
      </li>
    </ol>
    <p>Choose the ZIPs below. A few books at a time is fine.</p>
    <details>
      <summary>Other exported data</summary>
      <p>
        Audiobook position and subtitles are supported. Export Reading Goals separately from
        Statistics → Reading Goals.
      </p>
      <p>
        Data-only ZIPs need Book Data imported first. Choose the matching imported book below. Audio
        files and the original EPUB are not included in Ttu exports.
      </p>
    </details>
  </section>
  <label class="file-picker"
    >Choose Ttu export ZIPs
    <input
      type="file"
      accept=".zip,application/zip"
      multiple
      disabled={busy}
      on:change={(event) => {
        const files = [...(event.currentTarget.files ?? [])];
        event.currentTarget.value = '';
        void choose(files);
      }}
    />
  </label>
  <p>Imports stay on this device. No sign-in or cloud access is required.</p>
  {#if message}<p role="status">{message}</p>{/if}
  {#if rows.length}
    <details>
      <summary>Data to import</summary>
      <div class="parts">
        {#each Object.entries(importLabels) as [part, label]}
          <label
            ><input type="checkbox" bind:group={parts} value={part} disabled={busy} />{label}</label
          >
        {/each}
      </div>
    </details>
    <div class="actions">
      <button
        disabled={busy}
        on:click={() => {
          rows = rows.map((row) => ({ ...row, selected: !row.error }));
        }}>Select all</button
      >
      <button
        disabled={busy}
        on:click={() => {
          rows = rows.map((row) => ({ ...row, selected: false }));
        }}>Select none</button
      >
      <button disabled={busy || !selected.length || !parts.length} on:click={() => run(selected)}
        >Import selected ({selected.length})</button
      >
      <button disabled={busy} on:click={clear}>Clear list</button>
    </div>
    {#if ignored}<p>
        {ignored} unrelated export files will not be imported. Storage connections and credentials are
        never imported.
      </p>{/if}
    {#if busy}
      <div class="actions">
        <progress value={completed} max={Math.max(total, 1)} aria-label="Import progress"
        ></progress>
        <button on:click={cancel}>Stop importing</button>
      </div>
    {/if}
    {#if rows.length > pageSize}
      <nav aria-label="Import pages">
        <button disabled={page === 0} on:click={() => page--}>Previous</button>
        <span
          >{page * pageSize + 1}–{Math.min((page + 1) * pageSize, rows.length)} of {rows.length}</span
        >
        <button disabled={(page + 1) * pageSize >= rows.length} on:click={() => page++}>Next</button
        >
      </nav>
    {/if}
    <div class="import-list" aria-label="Import preview" aria-busy={busy}>
      {#each visibleRows as row (row.key)}
        <article aria-label="Import {row.title}">
          <label class="book-choice"
            ><input
              type="checkbox"
              bind:checked={row.selected}
              disabled={busy || !!row.error}
            />{row.title}</label
          >
          <p class="details">
            {row.source.file.name} · {row.parts.map((part) => importLabels[part]).join(', ')}
          </p>
          {#if !row.parts.includes('goals') && (!row.parts.includes('book') || row.status === 'conflict')}
            <label
              >Destination book
              <select
                bind:value={row.targetId}
                disabled={busy}
                aria-label="Destination for {row.title}"
              >
                <option value={0}>Choose a previously imported book</option>
                {#each choices.filter((book) => book.sourceTitle === row.title) as book}
                  <option value={book.id}>{book.title}</option>
                {/each}
              </select>
            </label>
          {/if}
          {#if row.message}<p role="status">{row.message}</p>{/if}
          {#if row.status === 'conflict'}
            <p>Using imported data replaces conflicting reading records, not the book itself.</p>
            <button disabled={busy} on:click={() => run([row], true)}
              >Use imported data for {row.title}</button
            >
          {/if}
          {#if row.bookId}<a href="{base}/b?id={row.bookId}">Read {row.title}</a>{/if}
        </article>
      {/each}
    </div>
  {:else if busy}
    <p role="status">Inspecting ZIPs…</p>
    <button on:click={cancel}>Stop inspecting</button>
  {/if}
</main>

<style>
  .migration-page {
    max-width: 60rem;
    margin: auto;
    padding: 1.25rem;
    line-height: 1.55;
    writing-mode: horizontal-tb;
  }
  h1 {
    font-size: 1.8rem;
    font-weight: 700;
    margin: 1rem 0;
  }
  h2 {
    font-size: 1.2rem;
    font-weight: 650;
  }
  nav,
  .actions,
  .parts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
  }
  section,
  article {
    border: 1px solid var(--border, #8886);
    border-radius: 0.6rem;
    padding: 1rem;
    margin: 1rem 0;
  }
  ol {
    list-style: decimal;
    padding-left: 1.5rem;
    margin: 0.6rem 0;
  }
  p {
    margin: 0.6rem 0;
    overflow-wrap: anywhere;
  }
  label {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .file-picker {
    margin: 1rem 0;
    font-weight: 600;
  }
  .book-choice {
    font-size: 1.1rem;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .details {
    font-size: 0.9rem;
    opacity: 0.8;
  }
  details {
    margin: 0.75rem 0;
  }
  summary {
    cursor: pointer;
  }
  button,
  select {
    padding: 0.4rem 0.65rem;
    border: 1px solid #8888;
    border-radius: 0.3rem;
    background: transparent;
  }
  button:disabled {
    opacity: 0.5;
  }
  button:not(:disabled) {
    cursor: pointer;
  }
  a {
    text-decoration: underline;
    text-underline-offset: 0.15em;
  }
  input[type='file'] {
    max-width: 100%;
    font-weight: normal;
  }
  progress {
    width: min(24rem, 70vw);
  }
  :focus-visible {
    outline: 2px solid currentColor;
    outline-offset: 3px;
  }
</style>
