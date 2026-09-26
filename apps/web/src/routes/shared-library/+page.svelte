<script lang="ts">
  import AppNav from '$lib/components/navigation/app-nav.svelte';
  import { Button } from '$lib/components/ui/button';
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import type BooksDb from '$lib/data/database/books-db/versions/books-db';
  import type { BooksDbStorageSource } from '$lib/data/database/books-db/versions/books-db';
  import { account } from '$lib/manabi/client';
  import { allLinkedBooks } from '$lib/manabi/books';
  import { visibleLibraryEntries } from '$lib/library/account-visibility';
  import { BaseStorageHandler } from '$lib/data/storage/handler/base-handler';
  import { database, autoReplication$, syncTarget$ } from '$lib/data/store';
  import { AutoReplicationType } from '$lib/functions/replication/replication-options';
  import { inspectTtuRoot } from '$lib/manabi/ttu-folder-contract';
  import { sharedPublishChoices } from '$lib/manabi/shared-title-selection';
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
  let localRows: BooksDb['data']['value'][] = [];
  $: viewer = $account.session?.user?.id ?? null;
  $: localBooks = sharedPublishChoices(
    visibleLibraryEntries(localRows, $allLinkedBooks, viewer).cards
  );
  $: {
    viewer;
    imports = [];
    exports = [];
  }
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
    localRows = await (await database.db).getAll('data');
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

<header
  class="app-header flex min-h-12 items-center justify-end border-b border-border bg-card px-3"
>
  <AppNav />
</header>

<svelte:head><title>Shared Ttu Ebook Reader libraries · Manabi Reader</title></svelte:head>

<main>
  <nav aria-label="Reader navigation" class="page-navigation">
    <Button href={resolve('/manage')} variant="link" size="sm">Books</Button>
    <Button href={resolve('/connections')} variant="link" size="sm"
      >Accounts and local book folders</Button
    >
    <Button href={resolve('/settings')} variant="link" size="sm">Storage settings</Button>
  </nav>
  <h1>Shared Ttu Ebook Reader libraries</h1>
  <p>
    Use the same <code>ttu-reader-data</code> library as Ttu Ebook Reader. This mode stores book packages,
    bookmarks, and statistics in Ttu Ebook Reader’s existing format—not private Manabi Web sidecars.
  </p>
  <section aria-labelledby="connect-folder">
    <h2 id="connect-folder">Connect a local or cloud-synced folder</h2>
    <p>
      Select <code>ttu-reader-data</code> itself, or its parent. Selecting the root does not create another
      nested library. Books already downloaded locally remain readable without an account.
    </p>
    {#if supported}
      <Button variant="default" disabled={busy} onclick={() => choose(false)}
        >Add existing shared folder</Button
      >
      <Button variant="outline" disabled={busy} onclick={() => choose(true)}
        >Create shared library in a folder</Button
      >
    {:else}
      <p>
        This browser does not expose the modern directory picker. Individual file import still works
        from the Books page.
      </p>
    {/if}
    <p>
      Read/write permission is requested because this is a sync destination. For read-only access to
      ordinary EPUB files, use <a href={resolve('/connections')}>Add local folder</a> instead.
    </p>
  </section>
  <p role="status">{message}</p>
  {#if sources.length}
    <section aria-labelledby="connected-folder">
      <h2 id="connected-folder">Connected shared library</h2>
      <label
        >Shared folder<select bind:value={selected} disabled={busy} on:change={() => run(refresh)}
          >{#each sources as item (item.name)}<option value={item.name}>{item.name}</option
            >{/each}</select
        ></label
      >
      {#if source}
        <p>{filesystemData(source).fsPath}</p>
        <div class="actions">
          <Button variant="outline" disabled={busy} onclick={reconnect}
            >Reconnect folder permission</Button
          >
          <Button
            variant="default"
            disabled={busy}
            onclick={() =>
              run(async () => {
                if (!source) return;
                await openSharedFolder(source);
                await goto(resolve('/manage'));
              })}>Open shared library</Button
          >
          <Button variant="ghost" disabled={busy} onclick={() => run(refresh)}
            >Refresh shared library</Button
          >
        </div>
        <label
          ><input
            type="checkbox"
            checked={$syncTarget$ === source.name && $autoReplication$ === AutoReplicationType.All}
            disabled={busy}
            on:change={(event) => setAutomatic(event.currentTarget.checked)}
          />Use this library as the automatic Ttu Ebook Reader import/export target</label
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
      {#each remoteTitles as title (title)}<label
          ><input type="checkbox" bind:group={imports} value={title} />{title}</label
        >{/each}
      {#if !remoteTitles.length}<p>
          No Ttu Ebook Reader book packages are present yet. A folder of EPUBs alone is not a Ttu
          Ebook Reader library; publish selected books below.
        </p>{/if}
      <Button
        variant="secondary"
        disabled={busy || !source || !imports.length}
        onclick={() =>
          run(async () => {
            if (!source) return;
            await transferSharedBooks(source, 'import', imports);
            await refresh();
            message = 'Selected books, bookmarks and statistics imported.';
          })}>Import selected shared books</Button
      >
    </section>
    <section aria-labelledby="publish-books">
      <h2 id="publish-books">Publish browser books</h2>
      <p>
        Publish only the books you select. This creates Ttu Ebook Reader book packages and their
        reading-data files; it does not modify original EPUB files or replace existing shared
        packages.
      </p>
      {#each localBooks.filter((book) => !remoteTitles.includes(book.title)) as book (book.title)}
        <div>
          <label
            ><input
              type="checkbox"
              bind:group={exports}
              value={book.title}
              disabled={busy || book.copies !== 1}
            />{book.title}</label
          >
          {#if book.copies !== 1}
            <p class="note">
              {book.copies} local copies share this title. Ttu Ebook Reader libraries identify books
              by title. Resolve the duplicate titles before sharing; your local copies are unchanged.
            </p>
          {/if}
        </div>
      {/each}
      <Button
        variant="secondary"
        disabled={busy || !source || !exports.length}
        onclick={() =>
          run(async () => {
            if (!source) return;
            await transferSharedBooks(source, 'publish', exports);
            await refresh();
            message =
              'Selected books published in Ttu Ebook Reader format. Your cloud client manages remote upload.';
          })}>Publish selected browser books</Button
      >
    </section>
  {/if}
  <section aria-labelledby="native-compatibility">
    <h2 id="native-compatibility">Using the native Manabi app</h2>
    <p>
      The native app’s current main-branch Ttu Ebook Reader integration reads a Google Drive <code
        >ttu-reader-data</code
      > library. Point both apps at the same visible library, and ensure their Google authorizations
      can see the same files. The same Google account alone does not guarantee that.
    </p>
    <p>
      Native OneDrive, Dropbox, and local Ttu Ebook Reader-folder connections are not implemented by
      the existing Google-only native connector. The managed cloud connections on the Accounts page
      currently use a different reading-data format and are not a replacement for this
      shared-library mode.
    </p>
  </section>
</main>

<style>
  main {
    max-width: 64rem;
    margin: auto;
    padding: 24px 16px;
    writing-mode: horizontal-tb;
    line-height: 1.6;
  }
  nav,
  .actions {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    align-items: center;
  }
  .page-navigation {
    margin-inline: -8px;
    gap: 2px;
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
    border: 1px solid var(--border);
    background: var(--card);
    border-radius: 16px;
    padding: 20px;
    margin: 16px 0;
    color: var(--card-foreground);
  }
  p {
    margin: 0.75rem 0;
  }
  a {
    color: var(--primary);
    text-decoration: underline;
  }
  label {
    display: flex;
    gap: 10px;
    align-items: center;
    margin: 10px 0;
    flex-wrap: wrap;
  }
  label > input[type='checkbox'] {
    width: 20px;
    height: 20px;
    flex-shrink: 0;
    accent-color: var(--primary);
  }
  select {
    min-height: 44px;
    max-width: 100%;
    background: var(--background);
    border: 1px solid var(--input);
    border-radius: 10px;
    padding: 8px 10px;
    color: var(--foreground);
  }
  .note {
    font-size: 0.9rem;
  }
  code {
    overflow-wrap: anywhere;
  }
  @media (max-width: 36rem) {
    main {
      padding: 16px 12px;
    }
    section {
      padding: 16px;
    }
  }
</style>
