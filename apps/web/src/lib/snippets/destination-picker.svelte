<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { Button } from '$lib/components/ui/button';
  import { sourceDescriptors, type SourceDescriptor } from '../library/catalog';
  import { requestDocumentWriteAccess } from '../manabi/client';
  import { integrationDB } from '../manabi/persistence';
  import { reconnectLocalLibrary } from '../manabi/sources';
  import type { Destination, Guard } from './database';
  import { capability, folders, makeFolder, type StorageCapability } from './storage';
  export let initial: Destination | undefined = undefined;
  export let guard: Guard;
  export let choose: (destination: Destination | undefined, remember: boolean) => void;
  export let allowDevice = true;
  let sources: SourceDescriptor[] = [];
  let selected: SourceDescriptor | undefined;
  let trail: { id: string; name: string }[] = [];
  let entries: { id: string; name: string }[] = [];
  let capabilities: StorageCapability | undefined;
  let remember = false,
    busy = false,
    error = '',
    newName = '',
    generation = 0;
  const identity = (source: SourceDescriptor) =>
    JSON.stringify([source.owner, source.id, source.root]);
  $: parent = trail.at(-1)?.id ?? selected?.root ?? '';
  async function browse(
    source: SourceDescriptor,
    path = source.root,
    name = source.name,
    reset = false
  ) {
    const run = ++generation;
    busy = true;
    error = '';
    try {
      guard();
      const cap = await capability(source, guard);
      guard();
      const children = await folders(source, path, guard);
      guard();
      if (run !== generation) return;
      selected = source;
      capabilities = cap;
      entries = children;
      trail = reset
        ? [
            { id: source.root, name: source.name },
            ...(path !== source.root ? [{ id: path, name }] : [])
          ]
        : [...trail, { id: path, name }];
    } catch (reason) {
      if (run === generation)
        error = reason instanceof Error ? reason.message : 'Cannot browse this source.';
    } finally {
      if (run === generation) busy = false;
    }
  }
  async function grant() {
    if (!selected) return;
    const source = selected;
    try {
      guard();
      if (source.owner) {
        if (!['google', 'dropbox', 'onedrive'].includes(source.provider))
          throw new Error('This provider does not support document writes.');
        await requestDocumentWriteAccess(source.provider, source.id);
        guard();
      } else if (source.provider === 'local') {
        const entry = await (await integrationDB()).get('localLibraries', source.id);
        guard();
        if (!entry) throw new Error('Reconnect this folder.');
        await reconnectLocalLibrary(entry, true);
        guard();
        await browse(source, parent, trail.at(-1)?.name, true);
      }
    } catch (reason) {
      error = reason instanceof Error ? reason.message : 'Permission could not be granted.';
    }
  }
  async function mkdir() {
    if (!selected || !newName.trim() || busy) return;
    busy = true;
    error = '';
    try {
      const id = await makeFolder({ source: selected, parent }, newName.trim(), guard);
      await browse(selected, id, newName.trim());
      newName = '';
    } catch (reason) {
      error = reason instanceof Error ? reason.message : 'The folder could not be created.';
    } finally {
      busy = false;
    }
  }
  onMount(() => {
    let live = true;
    void (async () => {
      try {
        const found = await sourceDescriptors();
        guard();
        if (!live) return;
        sources = found;
        const original =
          initial && found.find((source) => identity(source) === identity(initial!.source));
        if (original)
          await browse(original, initial!.parent, initial!.parent || original.name, true);
        else if (sources.length === 1)
          await browse(sources[0], sources[0].root, sources[0].name, true);
      } catch (reason) {
        if (live) error = reason instanceof Error ? reason.message : 'Cannot load destinations.';
      }
    })();
    return () => {
      live = false;
      generation++;
    };
  });
</script>

<div class="destination-picker">
  <p>
    Save the document in one connected location. Collections and reading history stay attached when
    it moves.
  </p>
  <label
    >Storage source
    <select
      aria-label="Storage source"
      value={selected ? identity(selected) : ''}
      onchange={(event) => {
        const source = sources.find((item) => identity(item) === event.currentTarget.value);
        if (source) void browse(source, source.root, source.name, true);
      }}
    >
      <option value="" disabled>Choose a source</option>
      {#each sources as source (identity(source))}<option value={identity(source)}
          >{source.provider} · {source.name}</option
        >{/each}
    </select>
  </label>
  {#if selected}
    <nav aria-label="Destination folder">
      {#each trail as part, index (part.id)}
        <button
          disabled={busy}
          onclick={() => {
            trail = trail.slice(0, index);
            void browse(selected!, part.id, part.name);
          }}>{part.name || 'Root'}</button
        >
        {#if index < trail.length - 1}<span aria-hidden="true"> › </span>{/if}
      {/each}
    </nav>
    <div class="folder-list">
      {#each entries as folder (folder.id)}<button
          disabled={busy}
          onclick={() => browse(selected!, folder.id, folder.name)}>📁 {folder.name}</button
        >{:else}<p>{busy ? 'Loading folders…' : 'No subfolders. You can save here.'}</p>{/each}
    </div>
    {#if selected.provider === 'local'}<p>
        Close other applications editing these files before saving. This browser cannot lock out
        external file editors.
      </p>{/if}
    {#if capabilities?.write}
      <form
        onsubmit={(event) => {
          event.preventDefault();
          void mkdir();
        }}
      >
        <input
          aria-label="New folder name"
          placeholder="New folder name"
          bind:value={newName}
          maxlength="100"
        />
        <Button type="submit" variant="secondary" disabled={busy || !newName.trim()}
          >Create folder</Button
        >
      </form>
      <label class="remember"
        ><input type="checkbox" bind:checked={remember} /> Use this location for new snippets</label
      >
      <Button disabled={busy} onclick={() => choose({ source: selected!, parent }, remember)}
        >Use this folder</Button
      >
    {:else if capabilities}
      <p>
        {capabilities.reason ||
          'This source is read-only. Authorize document editing to save here.'}
      </p>
      {#if selected.provider !== 'webdav' && !capabilities.reason}<Button onclick={grant}
          >Allow document editing</Button
        >{/if}
      {#if selected.provider === 'google'}<p>
          Google will request access to files in your Drive so Manabi can edit documents inside your
          selected library folders.
        </p>{/if}
    {/if}
  {/if}
  {#if allowDevice}<Button variant="ghost" onclick={() => choose(undefined, false)}
      >Keep on this device only</Button
    >{/if}
  <a href={resolve('/connections')}>Manage connected libraries</a>
  {#if error}<p role="alert">{error}</p>{/if}
</div>

<style>
  .destination-picker {
    display: grid;
    gap: 1rem;
  }
  label {
    display: grid;
    gap: 0.4rem;
  }
  select,
  input:not([type='checkbox']) {
    background: var(--background);
    color: var(--foreground);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    padding: 0.65rem;
    width: 100%;
  }
  nav button,
  a {
    text-decoration: underline;
  }
  .folder-list {
    max-height: 14rem;
    overflow-y: auto;
    display: grid;
    gap: 0.3rem;
  }
  .folder-list button {
    text-align: start;
    padding: 0.7rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
  }
  .remember {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  form {
    display: flex;
    gap: 0.6rem;
  }
  p {
    color: var(--muted-foreground);
  }
</style>
