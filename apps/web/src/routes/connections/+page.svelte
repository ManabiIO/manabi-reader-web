<script lang="ts">
  import { davSyncStatus, setDavBookSync } from '$lib/webdav/sync';
  import DavConnections from '$lib/webdav/connections.svelte';
  import { WebDavSource } from '$lib/webdav/source';
  import { DavError } from '$lib/webdav/client';
  import AppNav from '$lib/components/navigation/app-nav.svelte';
  import { Button } from '$lib/components/ui/button';
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
    syncBook,
    syncAllLinkedBooks
  } from '$lib/manabi/books';
  import { personalSyncStatus, resolvePersonalConflict } from '$lib/manabi/personal-sync';
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
  let nativeFolders = false;
  let busy = false;
  let message = '';
  let lastImported: { bookId: number; title: string } | null = null;
  let preferenceChoice: 'remote' | 'local' = 'remote';
  let navigation = 0;
  let stopped = false;
  const connectionReturn = encodeURIComponent(resolve('/connections'));

  function report(error: unknown) {
    message =
      error instanceof IntegrationError || error instanceof DavError
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
  async function openDav(value: WebDavSource) {
    await action(async () => {
      source = value;
      sourceName = value.configuration.name;
      trail = [{ id: value.root, name: sourceName }];
      await browse(value.root, false);
    });
  }
  async function openLocal(library: LocalLibrary) {
    source = new LocalLibrarySource(library);
    sourceName = library.name;
    trail = [{ id: '', name: library.name }];
    await browse('', false);
  }
  async function openCloud(connection: CloudConnection, root: string) {
    const owner = currentUser()?.id;
    if (!owner) throw new IntegrationError('sign_in_required');
    source = new CloudLibrary(connection.id, owner, root);
    sourceName = `${providerLabels[connection.provider] ?? connection.provider} · ${root}`;
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

<header
  class="app-header flex min-h-12 items-center justify-end border-b border-border bg-card px-3"
>
  <AppNav />
</header>

<svelte:head><title>Accounts and libraries · Manabi Reader</title></svelte:head>

<main class="connections-page">
  <nav aria-label="Reader navigation" class="page-navigation">
    <Button href={resolve('/manage')} variant="link" size="sm">← Books</Button>
    <Button href={resolve('/settings')} variant="link" size="sm">Reader settings</Button>
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
        <Button
          href="/accounts/login/?next={connectionReturn}"
          rel="external"
          variant="default"
          size="lg">Sign in to Manabi</Button
        >
        <Button
          href="/accounts/signup/?next={connectionReturn}"
          rel="external"
          variant="outline"
          size="lg">Create a Manabi account</Button
        >
      </div>
    {/if}
    {#if $account.status === 'offline'}<p>You are offline. Local reading remains available.</p>{/if}
    {#if $account.status === 'unavailable'}<p>
        Manabi account services are not available on this deployment. Local libraries still work.
      </p>{/if}
    <Button
      variant="ghost"
      disabled={busy}
      onclick={() =>
        action(async () => {
          await refreshAccount(true);
          await reload();
        })}>Refresh connections</Button
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
            <button
              class="destructive-action"
              disabled={busy}
              on:click={() => action(() => disconnect(connection))}
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

  <DavConnections
    onbrowse={openDav}
    onchange={async (id) => {
      if (source?.id === id) {
        source = null;
        entries = [];
        navigation++;
      }
      await refreshLinkedBooks();
    }}
  />

  <section aria-labelledby="local-heading">
    <h2 id="local-heading">Local folders</h2>
    <p>
      Choose a folder already on this device, including locally available iCloud Drive, Dropbox,
      OneDrive, or Google Drive folders.
    </p>
    {#if nativeFolders}
      <Button variant="outline" disabled={busy} onclick={pickLocal}>Add local folder</Button>
    {:else}
      <p>
        Persistent folder access needs a compatible browser, such as desktop Chrome or Edge. You can
        still <a href={resolve('/manage')}>import individual books</a>.
      </p>
    {/if}
    {#each localLibraries as library (library.id)}
      <article class="library" aria-label="Local library {library.name}">
        <h3>{library.name}</h3>
        <p>{library.writable ? 'Series editing allowed.' : 'Read-only book access.'}</p>
        <div class="actions">
          <button disabled={busy} on:click={() => action(() => openLocal(library))}
            >Browse {library.name}</button
          >
          <button disabled={busy} on:click={() => grant(library, false)}>Reconnect folder</button>
          <button disabled={busy} on:click={() => grant(library, true)}>Allow series editing</button
          >
          <button
            class="destructive-action"
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
      Reading does not modify original books. Series edits in a writable folder move selected
      originals and write .manabi-reader.yaml. Personal reading data stays in IndexedDB and syncs
      through Manabi when signed in. A local folder save does not confirm that your operating system
      has finished its cloud upload.
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
      <p>
        {source instanceof WebDavSource
          ? 'Import books for offline reading. WebDAV reading-data sync is a separate opt-in action below; original book files are never changed.'
          : 'Verified books sync personal reading data through your Manabi account. Folder write access is not required.'}
      </p>
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
                  lastImported = await importLibraryBook(
                    source,
                    entry,
                    !(source instanceof WebDavSource)
                  );
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
          <Button href={resolve(`/b?id=${lastImported.bookId}`)} variant="default"
            >Read {lastImported.title}</Button
          >
        </p>{/if}
    </section>
  {/if}

  <section aria-labelledby="reading-sync-heading">
    <h2 id="reading-sync-heading">Personal reading sync</h2>
    <p role="status">
      {$personalSyncStatus.message || 'Verified books and annotations sync when signed in.'}
    </p>
    {#each $personalSyncStatus.conflicts as conflict (conflict.id)}
      <article class="library" aria-label="Sync conflict for {conflict.bookKey}">
        <h3>{conflict.kind} conflict</h3>
        <p>{conflict.bookKey} · {conflict.fields.join(', ')}</p>
        {#if conflict.kind === 'annotation'}
          <p>Device note: {String(conflict.local?.body ?? '(empty or deleted)')}</p>
          <p>Account note: {String(conflict.remote?.body ?? '(empty or deleted)')}</p>
        {/if}
        <div class="actions">
          <button
            disabled={busy}
            on:click={() => action(() => resolvePersonalConflict(conflict.id, 'local'))}
            >Keep device copy</button
          >
          <button
            disabled={busy}
            on:click={() => action(() => resolvePersonalConflict(conflict.id, 'remote'))}
            >Use account copy</button
          >
        </div>
      </article>
    {/each}
    <Button variant="secondary" disabled={busy} onclick={() => action(syncAllLinkedBooks)}
      >Sync personal reading data now</Button
    >
    {#if !$linkedBooks.length}<p>
        Verified local books and annotations sync through your account even without a linked cloud
        library.
      </p>{/if}
    {#each $linkedBooks as link (link.id)}
      <article class="library" aria-label="Reading sync for {link.title}">
        {#if link.sourceId.startsWith('webdav-')}
          <label
            ><input
              type="checkbox"
              checked={link.syncEnabled}
              disabled={busy}
              on:change={(event) =>
                action(async () => {
                  await setDavBookSync(link.id, event.currentTarget.checked);
                  await refreshLinkedBooks();
                })}
            /> Sync this book’s reading data with WebDAV</label
          >
          <p class="hint">
            No Manabi server is used. Sync runs while the Library is visible, not while reading or
            after closing the app. Same-field conflicts require a choice.
          </p>
          {#if $davSyncStatus[link.id]?.state === 'conflict'}
            <p>{$davSyncStatus[link.id]?.conflicts?.join(', ')}</p>
            <button disabled={busy} on:click={() => action(() => syncBook(link.id, 'local'))}
              >{$davSyncStatus[link.id]?.missing
                ? 'Restore WebDAV file from this device'
                : 'Keep device conflicts'}</button
            >
            {#if !$davSyncStatus[link.id]?.missing}<button
                disabled={busy}
                on:click={() => action(() => syncBook(link.id, 'remote'))}
                >Use WebDAV conflicts</button
              >{/if}
          {/if}
        {/if}
        <h3><a href={resolve(`/b?id=${link.bookId}`)}>{link.title}</a></h3>
        <p role="status">
          {$bookSyncStatus[link.id]?.message ?? 'Ready to sync through your account.'}
        </p>
        <button disabled={busy} on:click={() => action(() => syncBook(link.id))}
          >Sync {link.title}</button
        >
      </article>
    {/each}
  </section>
</main>

<style>
  .connections-page {
    max-width: 68rem;
    margin: 0 auto;
    padding: 24px 16px;
    writing-mode: horizontal-tb;
    line-height: 1.55;
  }
  nav,
  .actions,
  .quick-settings {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    align-items: center;
  }
  .page-navigation {
    margin-inline: -8px;
    gap: 2px;
  }
  header {
    margin: 24px 0;
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
    background: var(--card);
    border-radius: 16px;
    padding: 20px;
    margin: 16px 0;
    color: var(--card-foreground);
  }
  p {
    margin: 0.6rem 0;
  }
  a {
    color: var(--primary);
    text-decoration: underline;
    text-underline-offset: 0.16em;
  }
  button:not([data-slot='button']) {
    display: inline-flex;
    min-height: 44px;
    max-width: 100%;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 8px 14px;
    background: var(--background);
    color: var(--foreground);
    font-size: 0.9375rem;
    font-weight: 500;
    text-align: center;
    text-decoration: none;
    overflow-wrap: anywhere;
    cursor: pointer;
  }
  button:not([data-slot='button']):hover {
    background: var(--muted);
  }
  button.destructive-action {
    border-color: transparent;
    background: color-mix(in oklch, var(--destructive) 10%, transparent);
    color: var(--destructive);
  }
  button.destructive-action:hover {
    background: color-mix(in oklch, var(--destructive) 18%, transparent);
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
    min-height: 44px;
    background: var(--background);
    border: 1px solid var(--input);
    border-radius: 10px;
    padding: 8px 10px;
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
      padding: 16px 12px;
    }
    section {
      padding: 16px;
    }
    .file-entry {
      align-items: flex-start;
      flex-direction: column;
      gap: 0.1rem;
    }
  }
</style>
