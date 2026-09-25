<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import {
    connectWebDAV,
    disconnectWebDAV,
    lockWebDAV,
    webdavConnections,
    webdavUnlocked,
    WebDAVSource,
    type WebDAVConnection
  } from './connection';
  export let onbrowse: (source: WebDAVSource) => Promise<void>;
  export let ondisconnect: (id: string) => void;
  let connections: WebDAVConnection[] = [];
  let open = false,
    busy = false,
    alive = true;
  let name = '',
    url = '',
    username = '',
    password = '',
    writable = false;
  let editing: string | undefined;
  let error = '',
    status = '';
  let request: AbortController | undefined;
  const refresh = async () => {
    const list = await webdavConnections();
    if (alive) connections = list;
  };
  function edit(connection?: WebDAVConnection) {
    editing = connection?.id;
    name = connection?.name ?? '';
    url = connection?.url ?? '';
    username = connection?.username ?? '';
    writable = connection?.writable ?? false;
    password = '';
    open = true;
    error = '';
    status = '';
  }
  async function save() {
    if (busy) return;
    busy = true;
    error = '';
    status = '';
    request = new AbortController();
    const secret = password;
    password = '';
    try {
      const result = await connectWebDAV(
        { name, url, username, writable },
        secret,
        editing,
        request.signal
      );
      if (!alive) {
        lockWebDAV(result.id);
        return;
      }
      await refresh();
      open = false;
      status = `Connected to ${result.name}. Password retained only in this tab.`;
    } catch (cause) {
      if (alive)
        error = request.signal.aborted
          ? 'Connection test canceled.'
          : cause instanceof Error
            ? cause.message
            : 'Could not connect to WebDAV.';
    } finally {
      if (alive) busy = false;
      request = undefined;
    }
  }
  async function browse(connection: WebDAVConnection) {
    error = '';
    try {
      await onbrowse(new WebDAVSource(connection));
    } catch (cause) {
      if (alive) error = cause instanceof Error ? cause.message : 'Cannot browse this folder.';
    }
  }
  async function remove(connection: WebDAVConnection) {
    try {
      await disconnectWebDAV(connection.id);
      ondisconnect(connection.id);
      await refresh();
      status = 'Disconnected. Downloaded books and reading history were kept.';
    } catch (cause) {
      if (alive) error = cause instanceof Error ? cause.message : 'Could not disconnect.';
    }
  }
  onMount(() => {
    void refresh().catch((cause) => {
      if (alive)
        error = cause instanceof Error ? cause.message : 'Could not load WebDAV connections.';
    });
  });
  onDestroy(() => {
    alive = false;
    request?.abort();
    password = '';
  });
</script>

<section aria-labelledby="webdav-heading" class="webdav-settings">
  <h2 id="webdav-heading">WebDAV libraries</h2>
  <p>
    Connect directly to an HTTPS WebDAV folder on your NAS or storage service. No Manabi account,
    proxy, or server is required.
  </p>
  <Button variant="secondary" disabled={busy} onclick={() => edit()}>Add WebDAV library</Button>
  {#if error}<p role="alert" class="mt-3 text-sm text-destructive">{error}</p>{/if}
  {#if status}<p role="status" class="mt-3 text-sm text-muted-foreground">{status}</p>{/if}
  {#if open}<form
      class="mt-4 grid gap-3 rounded-2xl border border-border p-4"
      aria-label="Connect WebDAV"
      onsubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label
        >Library name<input
          required
          maxlength="240"
          bind:value={name}
          disabled={busy}
          autocomplete="off"
        /></label
      >
      <label
        >HTTPS folder URL<input
          required
          type="url"
          placeholder="https://storage.example.com/books/"
          bind:value={url}
          disabled={busy}
          autocapitalize="none"
          spellcheck="false"
        /></label
      >
      <label
        >Username<input
          bind:value={username}
          maxlength="512"
          disabled={busy}
          autocomplete="username"
          autocapitalize="none"
          spellcheck="false"
        /></label
      >
      <label
        >App password<input
          type="password"
          bind:value={password}
          maxlength="4096"
          disabled={busy}
          autocomplete="current-password"
        /></label
      >
      <label class="flex items-start gap-2"
        ><input type="checkbox" bind:checked={writable} disabled={busy} />Allow explicit uploads of
        new files. Existing files are never overwritten.</label
      >
      <p class="text-xs text-muted-foreground">
        Only the name, URL, username, and upload choice are saved here. Passwords are not stored on
        disk, exported, synced, or sent to Manabi. Unlock again after reloading this tab.
      </p>
      <div class="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}
          >{busy ? 'Testing connection…' : 'Test and connect'}</Button
        >
        <Button
          variant="ghost"
          type="button"
          onclick={() => {
            request?.abort();
            if (!busy) {
              open = false;
              password = '';
            }
          }}>Cancel</Button
        >
      </div>
    </form>{/if}
  {#each connections as connection (connection.id)}<article
      class="mt-4 rounded-2xl border border-border p-4"
      aria-label={`WebDAV library ${connection.name}`}
    >
      <h3 class="break-words font-semibold">{connection.name}</h3>
      <p class="break-all text-sm text-muted-foreground">{connection.url}</p>
      <p class="text-sm">
        {webdavUnlocked(connection.id) ? 'Unlocked in this tab' : 'Locked'} · {connection.writable
          ? 'New-file uploads allowed'
          : 'Read-only'}
      </p>
      <div class="mt-3 flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={!webdavUnlocked(connection.id) || busy}
          onclick={() => browse(connection)}>Browse {connection.name}</Button
        >
        <Button variant="outline" disabled={busy} onclick={() => edit(connection)}
          >Unlock / edit</Button
        >
        {#if webdavUnlocked(connection.id)}<Button
            variant="ghost"
            onclick={() => {
              lockWebDAV(connection.id);
              connections = [...connections];
              ondisconnect(connection.id);
            }}>Lock</Button
          >{/if}
        <Button variant="ghost" disabled={busy} onclick={() => remove(connection)}
          >Disconnect</Button
        >
      </div>
    </article>{/each}
  <details class="mt-4 text-sm">
    <summary>Server setup and privacy</summary>
    <p class="mt-2">
      The folder must allow your reader’s exact origin through CORS, with OPTIONS, PROPFIND, GET,
      and PUT when uploading. Allow Authorization, Content-Type, Depth, and If-None-Match request
      headers. Use an app password and a trusted HTTPS certificate; redirects are not followed.
    </p>
    <p class="mt-2">
      Books stay on your server until opened or explicitly imported. Imported copies work offline.
      Personal reading state remains local, with optional Manabi account sync; no automatic sidecar
      writes occur. Export a backup explicitly to upload it here. ZIP downloads remain untouched for
      migration or recovery.
    </p>
  </details>
</section>

<style>
  label {
    display: grid;
    gap: 0.35rem;
    font-size: 0.9rem;
  }
  label.flex {
    display: flex;
  }
  input:not([type='checkbox']) {
    min-width: 0;
    width: 100%;
    min-height: 44px;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--input);
    border-radius: 0.65rem;
    background: var(--background);
    color: var(--foreground);
  }
  h2 {
    font-size: 1.25rem;
    font-weight: 650;
  }
  p {
    margin: 0.75rem 0;
  }
</style>
