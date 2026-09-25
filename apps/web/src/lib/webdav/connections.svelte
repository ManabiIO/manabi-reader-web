<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { WebDavClient } from './client';
  import {
    configureDav,
    davSource,
    davSources,
    disconnectDav,
    type DavConfiguration,
    type WebDavSource
  } from './source';
  export let onbrowse: (source: WebDavSource) => Promise<void>;
  export let ondisconnect: (id: string) => Promise<void>;
  let sources: DavConfiguration[] = [];
  let editing: string | null = null;
  let name = '',
    url = '',
    username = '',
    password = '';
  let remember = false,
    writable = false,
    busy = false,
    message = '',
    mounted = false;
  let controller: AbortController | undefined;
  function edit(source?: DavConfiguration) {
    controller?.abort();
    editing = source?.id ?? `webdav-${crypto.randomUUID()}`;
    name = source?.name ?? '';
    url = source?.url ?? '';
    username = source?.username ?? '';
    password = source?.password ?? '';
    remember = source?.password !== undefined;
    writable = source?.writable ?? false;
    message = '';
  }
  async function run(work: () => Promise<void>) {
    if (busy) return;
    busy = true;
    message = '';
    try {
      await work();
    } catch (error) {
      if (mounted && !(error instanceof DOMException && error.name === 'AbortError'))
        message =
          error instanceof Error ? error.message : 'WebDAV could not complete this operation.';
    } finally {
      if (mounted) busy = false;
    }
  }
  async function save() {
    if (!editing) return;
    const config = { id: editing, name: name.trim(), url: url.trim(), username, writable };
    const secret = password,
      persist = remember;
    controller?.abort();
    const active = (controller = new AbortController());
    // A connection test is read-only; saving never creates a folder or uploads data.
    await new WebDavClient(config.url, config.username, secret, active.signal).list();
    active.signal.throwIfAborted();
    if (!mounted) return;
    await configureDav(config, secret, persist);
    if (!mounted) return;
    sources = await davSources();
    editing = null;
    password = '';
    message = 'WebDAV connected. Books are read-only; reading-data sync remains a separate choice.';
  }
  onMount(() => {
    mounted = true;
    void run(async () => {
      sources = await davSources();
    });
    return () => {
      mounted = false;
      controller?.abort();
      password = '';
    };
  });
</script>

<section aria-labelledby="webdav-heading" class="dav-settings">
  <h2 id="webdav-heading">WebDAV</h2>
  <p>Connect directly to your HTTPS WebDAV folder. No Manabi account or proxy is required.</p>
  <p class="text-sm text-muted-foreground">
    The server must allow this reader’s origin through CORS, including PROPFIND, GET, MKCOL and PUT,
    and expose a strong ETag header for reading-data sync. A successful read test does not verify
    write permission.
  </p>
  <Button variant="secondary" disabled={!mounted || busy} onclick={() => edit()}
    >Add WebDAV folder</Button
  >
  {#if message}<p role="status">{message}</p>{/if}
  {#if editing}
    <form
      aria-label="WebDAV connection"
      onsubmit={(event) => {
        event.preventDefault();
        void run(save);
      }}
    >
      <label>Name<Input required maxlength={240} bind:value={name} disabled={busy} /></label>
      <label
        >WebDAV folder URL<Input
          required
          type="url"
          bind:value={url}
          disabled={busy}
          placeholder="https://cloud.example/remote.php/dav/files/name/Books/"
        /></label
      >
      <label>Username<Input autocomplete="username" bind:value={username} disabled={busy} /></label>
      <label
        >Password or app password<Input
          type="password"
          autocomplete="current-password"
          bind:value={password}
          disabled={busy}
        /></label
      >
      <label class="choice"
        ><input type="checkbox" bind:checked={remember} disabled={busy} /> Remember password on this
        device</label
      >
      <p class="text-sm text-muted-foreground">
        Otherwise the password is kept only for this tab. A remembered password is stored in this
        site’s browser database, not encrypted with a separate key. Use a limited app password.
        Credentials are not exported or sent to Manabi.
      </p>
      <label class="choice"
        ><input type="checkbox" bind:checked={writable} disabled={busy} /> Allow reading-data write-back
        in .manabi-reader</label
      >
      <p class="text-sm text-muted-foreground">
        Original books are never modified. Enabling permission does not start sync; enable it for
        individual books below.
      </p>
      <div class="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>Test and save WebDAV</Button>
        <Button
          type="button"
          variant="ghost"
          onclick={() => {
            controller?.abort();
            editing = null;
            password = '';
          }}>Cancel</Button
        >
      </div>
    </form>
  {/if}
  {#each sources as item (item.id)}
    <article aria-label={`WebDAV ${item.name}`}>
      <h3>{item.name}</h3>
      <p class="break-all text-sm">{item.url}</p>
      <div class="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={busy}
          onclick={() => run(async () => onbrowse(await davSource(item.id)))}
          >Browse {item.name}</Button
        >
        <Button variant="outline" disabled={busy} onclick={() => edit(item)}
          >Unlock or edit {item.name}</Button
        >
        <Button
          variant="ghost"
          disabled={busy}
          onclick={() =>
            run(async () => {
              await disconnectDav(item.id);
              await ondisconnect(item.id);
              sources = await davSources();
            })}>Disconnect {item.name}</Button
        >
      </div>
    </article>
  {/each}
</section>

<style>
  .dav-settings {
    margin-block: 1.5rem;
  }
  h2 {
    font-size: 1.35rem;
    font-weight: 600;
  }
  h3 {
    font-size: 1.1rem;
    font-weight: 600;
  }
  p {
    margin-block: 0.65rem;
  }
  form,
  article {
    margin-top: 1rem;
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: 1rem;
  }
  form {
    display: grid;
    gap: 0.8rem;
  }
  label {
    display: grid;
    gap: 0.35rem;
  }
  label.choice {
    display: flex;
    align-items: start;
    gap: 0.5rem;
  }
  .choice input {
    margin-top: 0.3rem;
  }
</style>
