<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import {
    account,
    currentUser,
    refreshAccount,
    request,
    connectProvider,
    signOut,
    providerLabels,
    IntegrationError
  } from '$lib/manabi/client';
  import { preferenceStatus, enablePreferenceSync, syncPreferences } from '$lib/manabi/preferences';
  import {
    bookSyncStatus,
    linkedBooks,
    refreshLinkedBooks,
    importLibraryBook,
    setBookSync,
    syncBook,
    syncAllLinkedBooks
  } from '$lib/manabi/books';
  import { integrationDB, type LocalLibrary } from '$lib/manabi/persistence';
  import {
    CloudLibrary,
    LocalLibrarySource,
    addLocalLibrary,
    reconnectLocalLibrary,
    removeLocalLibrary,
    supportsLocalLibraries,
    supportedBook,
    type CloudConnection,
    type LibraryEntry,
    type LibrarySource
  } from '$lib/manabi/sources';
  import { fontSize$, writingMode$ } from '$lib/data/store';

  let connections: CloudConnection[] = [];
  let localLibraries: LocalLibrary[] = [];
  let folderPicker: {
    connection: CloudConnection;
    folders: LibraryEntry[];
    selected: string[];
  } | null = null;
  let source: LibrarySource | null = null;
  let sourceName = '';
  let entries: LibraryEntry[] = [];
  let trail: { id: string; name: string }[] = [];
  let cursor = '';
  let canWrite = false;
  let syncImported = true;
  let nativeFolders = false;
  let busy = false;
  let message = '';
  let lastImported: { bookId: number; title: string } | null = null;
  let preferenceChoice: 'remote' | 'local' = 'remote';
  let navigation = 0;
  let stopped = false;

  function report(error: unknown) {
    message =
      error instanceof IntegrationError
        ? error.message
        : error instanceof DOMException && error.name === 'AbortError'
          ? ''
          : 'The operation could not complete. Original books and local reading data were kept.';
  }
  async function action(work: () => Promise<unknown>) {
    if (busy) return;
    busy = true;
    message = '';
    try {
      await work();
    } catch (error) {
      report(error);
    } finally {
      busy = false;
    }
  }
  async function reload() {
    localLibraries = await (await integrationDB()).getAll('localLibraries');
    await refreshLinkedBooks();
    if (currentUser())
      connections = (await request<{ items: CloudConnection[] }>('connections/')).items;
    else connections = [];
  }
  async function pickLocal() {
    // addLocalLibrary opens the native picker before its first asynchronous DB call.
    const pending = addLocalLibrary();
    await action(async () => {
      const library = await pending;
      if (library) {
        await reload();
        await openLocal(library);
      }
    });
  }
  async function grant(library: LocalLibrary, write: boolean) {
    const pending = reconnectLocalLibrary(library, write);
    await action(async () => {
      await pending;
      await reload();
      await openLocal(library);
    });
  }
  async function openLocal(library: LocalLibrary) {
    source = new LocalLibrarySource(library);
    sourceName = library.name;
    canWrite = library.writable;
    syncImported = library.writable;
    trail = [{ id: '', name: library.name }];
    await browse('', false);
  }
  async function openCloud(connection: CloudConnection, root: string) {
    const owner = currentUser()?.id;
    if (!owner) throw new IntegrationError('sign_in_required');
    source = new CloudLibrary(connection.id, owner, root);
    sourceName = `${providerLabels[connection.provider] ?? connection.provider} · ${root}`;
    canWrite = true;
    syncImported = true;
    trail = [{ id: root, name: 'Selected folder' }];
    await browse(root, false);
  }
  async function browse(parent: string, more = false) {
    const activeSource = source;
    if (!activeSource) return;
    const serial = ++navigation;
    const result = await activeSource.list(parent, more ? cursor : '');
    if (serial !== navigation || source !== activeSource || stopped) return;
    entries = more ? [...entries, ...result.items] : result.items;
    cursor = result.cursor;
    lastImported = null;
  }
  async function enter(entry: LibraryEntry) {
    trail = [...trail, { id: entry.id, name: entry.name }];
    await browse(entry.id);
  }
  async function chooseFolders(connection: CloudConnection) {
    const result = await request<{ items: LibraryEntry[] }>(
      `connections/${connection.id}/folders/`
    );
    folderPicker = { connection, folders: result.items, selected: [...connection.roots] };
  }
  async function saveFolders() {
    if (!folderPicker) return;
    await request(`connections/${folderPicker.connection.id}/folders/`, {
      method: 'PUT',
      value: { roots: folderPicker.selected }
    });
    folderPicker = null;
    await reload();
  }
  async function disconnect(connection: CloudConnection) {
    const result = await request<{
      provider_revocation_confirmed: boolean;
      provider_revocation_supported?: boolean;
    }>(`connections/${connection.id}/`, { method: 'DELETE' });
    if (source?.id === connection.id) {
      source = null;
      entries = [];
    }
    await reload();
    message =
      result.provider_revocation_supported === false
        ? 'Disconnected locally. Remove Manabi access in the provider account settings to revoke its authorization.'
        : result.provider_revocation_confirmed
          ? 'Cloud access disconnected. Downloaded books are still available locally.'
          : 'Disconnected locally. Manabi will retry provider revocation; you can also remove access in the provider’s account settings.';
  }
  onMount(() => {
    nativeFolders = supportsLocalLibraries();
    void action(async () => {
      await refreshAccount();
      await reload();
    });
    let previous: string | null | undefined;
    const unsubscribe = account.subscribe(({ session }) => {
      const user = session?.user?.id ?? null;
      if (user !== previous) {
        previous = user;
        connections = [];
        folderPicker = null;
        if (source?.owner !== null) {
          source = null;
          entries = [];
          navigation += 1;
        }
        void reload().catch(report);
      }
    });
    return () => {
      stopped = true;
      unsubscribe();
      navigation += 1;
    };
  });
</script>

<svelte:head><title>Accounts and libraries · Manabi Reader</title></svelte:head>

<main class="connections-page">
  <nav aria-label="Reader navigation">
    <a href={resolve('/manage')}>← Books</a><a href={resolve('/settings')}>Reader settings</a>
  </nav>
  <header>
    <h1>Accounts and libraries</h1>
    <p>Read locally. Connect only the services you choose.</p>
  </header>
  {#if message}<p role="status" class="notice">{message}</p>{/if}

  <section aria-labelledby="account-heading">
    <h2 id="account-heading">Manabi account</h2>
    {#if $account.session?.user}
      <p>Signed in as <strong>{$account.session.user.username}</strong>.</p>
      <button
        disabled={busy}
        on:click={() =>
          action(async () => {
            await signOut();
            await reload();
          })}>Sign out</button
      >
      <div class="preference-controls">
        <label
          ><input
            type="checkbox"
            checked={$preferenceStatus.enabled}
            disabled={busy}
            on:change={(event) =>
              action(() => enablePreferenceSync(event.currentTarget.checked, preferenceChoice))}
          />
          Sync reader settings with this Manabi account</label
        >
        {#if !$preferenceStatus.enabled}
          <label
            >When first enabling sync
            <select bind:value={preferenceChoice}>
              <option value="remote">Use account settings when they exist</option>
              <option value="local">Use this device’s settings</option>
            </select>
          </label>
        {/if}
        <p role="status" aria-label="Settings sync status">
          Settings sync: {$preferenceStatus.state}
        </p>
        {#if $preferenceStatus.state === 'conflict'}
          <p>These preferences changed in both places: {$preferenceStatus.conflicts.join(', ')}.</p>
          <button disabled={busy} on:click={() => action(() => syncPreferences('local'))}
            >Keep this device’s settings</button
          >
          <button disabled={busy} on:click={() => action(() => syncPreferences('remote'))}
            >Use account settings</button
          >
        {:else if $preferenceStatus.enabled}
          <button disabled={busy} on:click={() => action(() => syncPreferences())}
            >Sync settings now</button
          >
        {/if}
        <div class="quick-settings">
          <label
            >Font size<input
              type="number"
              min="8"
              max="96"
              step="1"
              bind:value={$fontSize$}
            /></label
          >
          <label
            >Writing direction<select bind:value={$writingMode$}
              ><option value="vertical-rl">Vertical</option><option value="horizontal-tb"
                >Horizontal</option
              ></select
            ></label
          >
        </div>
        <p class="hint">
          Settings sync does not upload your books, local folder handles, fonts, or cloud
          credentials.
        </p>
      </div>
    {:else}
      <p>An account is optional. Sign in to sync your preferences and connect cloud libraries.</p>
      <div class="actions">
        <a class="button" rel="external" href="/accounts/login/?next=/Reader-Web/connections"
          >Sign in to Manabi</a
        >
        <a class="button" rel="external" href="/accounts/signup/?next=/Reader-Web/connections"
          >Create a Manabi account</a
        >
      </div>
    {/if}
    {#if $account.status === 'offline'}<p>You are offline. Local reading remains available.</p>{/if}
    {#if $account.status === 'unavailable'}<p>
        Manabi account services are not available on this deployment. Local libraries still work.
      </p>{/if}
    <button
      disabled={busy}
      on:click={() =>
        action(async () => {
          await refreshAccount();
          await reload();
        })}>Refresh connections</button
    >
  </section>

  <section aria-labelledby="cloud-heading">
    <h2 id="cloud-heading">Cloud libraries</h2>
    <p>
      Connect your storage account once, then select the book folders Manabi may use. No developer
      application setup is needed.
    </p>
    {#if $account.session?.user}
      <div class="actions">
        {#each $account.session.providers as provider (provider)}
          <button disabled={busy} on:click={() => action(() => connectProvider(provider))}
            >Connect {providerLabels[provider] ?? provider}</button
          >
        {/each}
      </div>
      {#if !$account.session.providers.length}<p>
          Cloud providers have not been enabled by this deployment’s operator yet.
        </p>{/if}
      {#each connections as connection (connection.id)}
        <article
          class="library"
          aria-label="{providerLabels[connection.provider] ?? connection.provider} connection"
        >
          <h3>{providerLabels[connection.provider] ?? connection.provider}</h3>
          {#if connection.needs_reconnect}<p role="status">
              This connection needs authorization again. Connect it again before removing this old
              connection.
            </p>{/if}
          <div class="actions">
            <button disabled={busy} on:click={() => action(() => chooseFolders(connection))}
              >Choose folders</button
            >
            <button disabled={busy} on:click={() => action(() => disconnect(connection))}
              >Disconnect cloud account</button
            >
          </div>
          {#if !connection.roots.length}<p>
              No folders selected. Manabi will not read files from this connection.
            </p>{/if}
          {#each connection.roots as root (root)}
            <button disabled={busy} on:click={() => action(() => openCloud(connection, root))}
              >Browse selected folder {root}</button
            >
          {/each}
        </article>
      {/each}
    {:else}<p>Sign in above to connect Google Drive, OneDrive, or Dropbox.</p>{/if}
    {#if folderPicker}
      <form on:submit|preventDefault={() => action(saveFolders)} aria-label="Select cloud folders">
        <h3>Folders Manabi may use</h3>
        <p class="hint">
          The provider’s OAuth permission may cover more than these folders. Manabi restricts book
          access to your selection.
        </p>
        {#each folderPicker.folders as folder (folder.id)}
          <label class="folder-choice"
            ><input
              type="checkbox"
              bind:group={folderPicker.selected}
              value={folder.id}
            />{folder.name}<small>{folder.id}</small></label
          >
        {/each}
        <div class="actions">
          <button type="submit" disabled={busy}>Save folder access</button><button
            type="button"
            on:click={() => (folderPicker = null)}>Cancel</button
          >
        </div>
      </form>
    {/if}
  </section>

  <section aria-labelledby="local-heading">
    <h2 id="local-heading">Local folders</h2>
    <p>
      Choose a folder already on this device, including locally available iCloud Drive, Dropbox,
      OneDrive, or Google Drive folders.
    </p>
    {#if nativeFolders}
      <button disabled={busy} on:click={pickLocal}>Add local folder</button>
    {:else}
      <p>
        Persistent folder access needs a compatible browser, such as desktop Chrome or Edge. You can
        still <a href={resolve('/manage')}>import individual books</a>.
      </p>
    {/if}
    {#each localLibraries as library (library.id)}
      <article class="library" aria-label="Local library {library.name}">
        <h3>{library.name}</h3>
        <p>{library.writable ? 'Folder write-back enabled.' : 'Read-only book access.'}</p>
        <div class="actions">
          <button disabled={busy} on:click={() => action(() => openLocal(library))}
            >Browse {library.name}</button
          >
          <button disabled={busy} on:click={() => grant(library, false)}>Reconnect folder</button>
          <button disabled={busy} on:click={() => grant(library, true)}
            >Allow reading-data write-back</button
          >
          <button
            disabled={busy}
            on:click={() =>
              action(async () => {
                await removeLocalLibrary(library.id);
                if (source?.id === library.id) {
                  source = null;
                  entries = [];
                }
                await reload();
              })}>Disconnect local folder</button
          >
        </div>
      </article>
    {/each}
    <p class="hint">
      Original books are never modified. Reading data uses a separate .manabi-reader directory. A
      local save does not confirm that your operating system has finished its cloud upload.
    </p>
  </section>

  {#if source}
    <section aria-labelledby="browse-heading">
      <h2 id="browse-heading">Browse {sourceName}</h2>
      <nav aria-label="Folder path">
        {#each trail as part, index (part.id)}
          <button
            disabled={busy}
            on:click={() =>
              action(async () => {
                trail = trail.slice(0, index + 1);
                await browse(part.id);
              })}>{part.name}</button
          >
        {/each}
      </nav>
      <label
        ><input type="checkbox" bind:checked={syncImported} disabled={!canWrite} />Sync progress and
        reading statistics to this library</label
      >
      {#if !canWrite}<p>Enable folder write-back above to use this option.</p>{/if}
      {#each entries as entry (entry.id)}
        <div class="file-entry">
          <span
            >{entry.kind === 'folder' ? 'Folder: ' : ''}{entry.name}<small>{entry.id}</small></span
          >
          {#if entry.kind === 'folder'}
            <button disabled={busy} on:click={() => action(() => enter(entry))}
              >Open folder {entry.name}</button
            >
          {:else if supportedBook(entry.name)}
            <button
              disabled={busy}
              on:click={() =>
                action(async () => {
                  if (!source) return;
                  lastImported = await importLibraryBook(source, entry, syncImported && canWrite);
                  message = `Imported ${lastImported.title}. It is now available offline.`;
                })}>Import {entry.name}</button
            >
          {/if}
        </div>
      {/each}
      {#if !entries.length}<p>No supported books or subfolders here.</p>{/if}
      {#if cursor}<button
          disabled={busy}
          on:click={() => action(() => browse(trail[trail.length - 1].id, true))}
          >Load more files</button
        >{/if}
      {#if lastImported}<p>
          <a class="button" href={resolve(`/b?id=${lastImported.bookId}`)}
            >Read {lastImported.title}</a
          >
        </p>{/if}
    </section>
  {/if}

  <section aria-labelledby="reading-sync-heading">
    <h2 id="reading-sync-heading">Linked books and reading sync</h2>
    <button disabled={busy} on:click={() => action(syncAllLinkedBooks)}
      >Sync linked books now</button
    >
    {#if !$linkedBooks.length}<p>
        Import a book from a library above to link its reading data.
      </p>{/if}
    {#each $linkedBooks as link (link.id)}
      <article class="library" aria-label="Reading sync for {link.title}">
        <h3><a href={resolve(`/b?id=${link.bookId}`)}>{link.title}</a></h3>
        <label
          ><input
            type="checkbox"
            checked={link.syncEnabled}
            disabled={busy}
            on:change={(event) => action(() => setBookSync(link.id, event.currentTarget.checked))}
          />Sync this book’s progress and statistics</label
        >
        <p role="status">
          {$bookSyncStatus[link.id]?.message ??
            (link.syncEnabled ? 'Ready to sync.' : 'Reading sync is off.')}
        </p>
        {#if link.syncEnabled}<button
            disabled={busy}
            on:click={() => action(() => syncBook(link.id))}>Sync {link.title}</button
          >{/if}
        {#if $bookSyncStatus[link.id]?.state === 'conflict'}
          <div class="actions">
            <button disabled={busy} on:click={() => action(() => syncBook(link.id, 'local'))}
              >Keep this device’s reading data</button
            >
            {#if $bookSyncStatus[link.id]?.branches}
              {#each $bookSyncStatus[link.id].branches ?? [] as branch (branch.id)}
                <button
                  disabled={busy}
                  on:click={() => action(() => syncBook(link.id, 'remote', branch.id))}
                  >Use folder copy saved {branch.createdAt}</button
                >
              {/each}
            {:else}
              <button disabled={busy} on:click={() => action(() => syncBook(link.id, 'remote'))}
                >Use the library’s reading data</button
              >
            {/if}
          </div>
        {/if}
      </article>
    {/each}
  </section>
</main>

<style>
  .connections-page {
    max-width: 68rem;
    margin: 0 auto;
    padding: 1.25rem;
    writing-mode: horizontal-tb;
    line-height: 1.55;
  }
  nav,
  .actions,
  .quick-settings {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
    align-items: center;
  }
  header {
    margin: 1.5rem 0;
  }
  h1 {
    font-size: 2rem;
    font-weight: 700;
  }
  h2 {
    font-size: 1.35rem;
    font-weight: 650;
    margin-bottom: 0.6rem;
  }
  h3 {
    font-size: 1.08rem;
    font-weight: 650;
    margin-bottom: 0.4rem;
  }
  section {
    border: 1px solid var(--border);
    background: var(--muted);
    border-radius: 0.75rem;
    padding: 1.25rem;
    margin: 1rem 0;
  }
  p {
    margin: 0.6rem 0;
  }
  a {
    color: var(--primary);
    text-decoration: underline;
    text-underline-offset: 0.16em;
  }
  button,
  .button {
    display: inline-block;
    border: 1px solid var(--border);
    border-radius: 0.4rem;
    padding: 0.45rem 0.75rem;
    margin: 0.25rem 0;
    text-decoration: none;
    cursor: pointer;
  }
  button:hover,
  .button:hover {
    background: var(--accent);
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  button:focus-visible,
  a:focus-visible,
  input:focus-visible,
  select:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 3px;
  }
  .library,
  form {
    border-top: 1px solid var(--border);
    margin-top: 1rem;
    padding-top: 1rem;
  }
  label {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    margin: 0.6rem 0;
    flex-wrap: wrap;
  }
  input[type='number'] {
    width: 5rem;
  }
  input[type='number'],
  select {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 0.3rem;
    padding: 0.3rem;
  }
  .preference-controls {
    margin-top: 1rem;
  }
  .notice {
    border-left: 3px solid currentColor;
    padding: 0.75rem;
    background: var(--card);
  }
  .hint,
  small {
    font-size: 0.87rem;
    color: var(--muted-foreground);
  }
  small {
    display: block;
    overflow-wrap: anywhere;
  }
  .file-entry {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.55rem 0;
    border-bottom: 1px solid var(--border);
  }
  .file-entry span {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .folder-choice {
    align-items: baseline;
  }
  @media (max-width: 36rem) {
    .connections-page {
      padding: 0.75rem;
    }
    section {
      padding: 0.9rem;
    }
    .file-entry {
      align-items: flex-start;
      flex-direction: column;
      gap: 0.1rem;
    }
  }
</style>
