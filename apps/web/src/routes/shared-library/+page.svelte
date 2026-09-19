<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { goto } from '$app/navigation';
  import type { BooksDbStorageSource } from '$lib/data/database/books-db/versions/books-db';
  import { BaseStorageHandler } from '$lib/data/storage/handler/base-handler';
  import { database, autoReplication$, syncTarget$ } from '$lib/data/store';
  import { AutoReplicationType } from '$lib/functions/replication/replication-options';
  import { inspectTtuRoot } from '$lib/manabi/ttu-folder-contract';
  import {
    addSharedFolder,
    filesystemData,
    openSharedFolder,
    reconnectSharedFolder,
    sharedFolderSources,
    transferSharedBooks
  } from '$lib/manabi/shared-library';

  let sources: BooksDbStorageSource[] = [];
  let selected = '';
  let remoteTitles: string[] = [];
  let localTitles: string[] = [];
  let imports: string[] = [];
  let exports: string[] = [];
  let busy = false;
  let message = '';
  let supported = false;
  $: source = sources.find((item) => item.name === selected);

  async function run(work: () => Promise<unknown>) {
    if (busy) return;
    busy = true;
    message = '';
    try {
      await work();
    } catch (error) {
      message =
        error instanceof Error
          ? error.message
          : 'The folder could not be accessed. Existing books were not removed.';
    } finally {
      busy = false;
    }
  }
  async function refresh() {
    sources = await sharedFolderSources();
    if (!sources.some((item) => item.name === selected)) selected = sources[0]?.name ?? '';
    localTitles = (await (await database.db).getAll('data'))
      .filter((book) => Boolean(book.elementHtml))
      .map((book) => book.title);
    const current = sources.find((item) => item.name === selected);
    remoteTitles = current
      ? (await inspectTtuRoot(filesystemData(current).directoryHandle)).map(
          BaseStorageHandler.desanitizeFilename
        )
      : [];
    imports = [];
    exports = [];
  }
  function choose(create: boolean) {
    if (busy) return;
    const picking = addSharedFolder(create);
    void run(async () => {
      const added = await picking;
      if (!added) return;
      selected = added.name;
      await refresh();
      message =
        'Shared library connected. No books were uploaded and your sync target was not changed.';
    });
  }
  function reconnect() {
    if (!source || busy) return;
    const permission = reconnectSharedFolder(source);
    void run(async () => {
      await permission;
      await refresh();
    });
  }
  function setAutomatic(enabled: boolean) {
    if (!source) return;
    if (enabled) {
      syncTarget$.next(source.name);
      autoReplication$.next(AutoReplicationType.All);
    } else if ($syncTarget$ === source.name) {
      syncTarget$.next('');
      autoReplication$.next(AutoReplicationType.Off);
    }
  }
  onMount(() => {
    supported = window.isSecureContext && 'showDirectoryPicker' in window;
    void run(refresh);
  });
</script>

<svelte:head><title>Shared TTU libraries · Manabi Reader</title></svelte:head>

<main>
  <nav aria-label="Reader navigation">
    <a href="{base}/manage">Books</a><a href="{base}/connections">Accounts and local book folders</a
    ><a href="{base}/settings">Storage settings</a>
  </nav>
  <h1>Shared TTU libraries</h1>
  <p>
    Use the same <code>ttu-reader-data</code> library as TTU Reader. This mode stores book packages,
    bookmarks, and statistics in TTU’s existing format—not private Manabi Web sidecars.
  </p>
  <section aria-labelledby="connect-folder">
    <h2 id="connect-folder">Connect a local or cloud-synced folder</h2>
    <p>
      Select <code>ttu-reader-data</code> itself, or its parent. Selecting the root does not create another
      nested library. Books already downloaded locally remain readable without an account.
    </p>
    {#if supported}
      <button disabled={busy} on:click={() => choose(false)}>Add existing shared folder</button>
      <button disabled={busy} on:click={() => choose(true)}
        >Create shared library in a folder</button
      >
    {:else}
      <p>
        This browser does not expose the modern directory picker. Individual file import still works
        from the Books page.
      </p>
    {/if}
    <p>
      Read/write permission is requested because this is a sync destination. For read-only access to
      ordinary EPUB files, use <a href="{base}/connections">Add local folder</a> instead.
    </p>
  </section>
  <p role="status">{message}</p>
  {#if sources.length}
    <section aria-labelledby="connected-folder">
      <h2 id="connected-folder">Connected shared library</h2>
      <label
        >Shared folder<select bind:value={selected} disabled={busy} on:change={() => run(refresh)}
          >{#each sources as item}<option value={item.name}>{item.name}</option>{/each}</select
        ></label
      >
      {#if source}
        <p>{filesystemData(source).fsPath}</p>
        <button disabled={busy} on:click={reconnect}>Reconnect folder permission</button>
        <button
          disabled={busy}
          on:click={() =>
            run(async () => {
              if (!source) return;
              await openSharedFolder(source);
              await goto(`${base}/manage`);
            })}>Open shared library</button
        >
        <button disabled={busy} on:click={() => run(refresh)}>Refresh shared library</button>
        <label
          ><input
            type="checkbox"
            checked={$syncTarget$ === source.name && $autoReplication$ === AutoReplicationType.All}
            disabled={busy}
            on:change={(event) => setAutomatic(event.currentTarget.checked)}
          />Use this library as the automatic TTU import/export target</label
        >
        <p class="note">
          This replaces the current automatic sync target. Read the shared copy from “Open shared
          library” so its identity stays associated with this source. Concurrent edits from other
          apps may require conflict recovery; the OS cloud client finishes its own upload
          separately.
        </p>
      {/if}
    </section>
    <section aria-labelledby="shared-books">
      <h2 id="shared-books">Shared books</h2>
      {#each remoteTitles as title}<label
          ><input type="checkbox" bind:group={imports} value={title} />{title}</label
        >{/each}
      {#if !remoteTitles.length}<p>
          No TTU book packages are present yet. A folder of EPUBs alone is not a TTU library;
          publish selected books below.
        </p>{/if}
      <button
        disabled={busy || !source || !imports.length}
        on:click={() =>
          run(async () => {
            if (!source) return;
            await transferSharedBooks(source, 'import', imports);
            await refresh();
            message = 'Selected books, bookmarks and statistics imported.';
          })}>Import selected shared books</button
      >
    </section>
    <section aria-labelledby="publish-books">
      <h2 id="publish-books">Publish browser books</h2>
      <p>
        Publish only the books you select. This creates TTU book packages and their reading-data
        files; it does not modify original EPUB files or replace existing shared packages.
      </p>
      {#each localTitles.filter((title) => !remoteTitles.includes(title)) as title}<label
          ><input type="checkbox" bind:group={exports} value={title} />{title}</label
        >{/each}
      <button
        disabled={busy || !source || !exports.length}
        on:click={() =>
          run(async () => {
            if (!source) return;
            await transferSharedBooks(source, 'publish', exports);
            await refresh();
            message =
              'Selected books published in TTU format. Your cloud client manages remote upload.';
          })}>Publish selected browser books</button
      >
    </section>
  {/if}
  <section aria-labelledby="native-compatibility">
    <h2 id="native-compatibility">Using the native Manabi app</h2>
    <p>
      The native app’s current main-branch TTU integration reads a Google Drive <code
        >ttu-reader-data</code
      > library. Point both apps at the same visible library, and ensure their Google authorizations
      can see the same files. The same Google account alone does not guarantee that.
    </p>
    <p>
      Native OneDrive, Dropbox, and local TTU-folder connections are not implemented by the existing
      Google-only native connector. The managed cloud connections on the Accounts page currently use
      a different reading-data format and are not a replacement for this shared-library mode.
    </p>
  </section>
</main>

<style>
  main {
    max-width: 64rem;
    margin: auto;
    padding: 1.25rem;
    writing-mode: horizontal-tb;
    line-height: 1.6;
  }
  nav {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
  }
  h1 {
    font-size: 2rem;
    font-weight: 700;
    margin: 1rem 0;
  }
  h2 {
    font-size: 1.3rem;
    font-weight: 650;
  }
  section {
    border: 1px solid var(--line);
    background: var(--surface);
    border-radius: 0.6rem;
    padding: 1rem;
    margin: 1rem 0;
  }
  p {
    margin: 0.75rem 0;
  }
  a {
    color: var(--accent);
    text-decoration: underline;
  }
  label {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    margin: 0.6rem 0;
  }
  button,
  select {
    background: transparent;
    border: 1px solid var(--line);
    border-radius: 0.35rem;
    padding: 0.45rem 0.75rem;
    margin: 0.25rem;
  }
  button:disabled {
    opacity: 0.5;
  }
  .note {
    font-size: 0.9rem;
  }
  code {
    overflow-wrap: anywhere;
  }
</style>
