<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import type { ShelfBook } from './view-model';
  import type { Collection, PresentationChange } from './organization';
  import { validBookMetadata, validBookSeries } from './book-presentation';

  export let mode: 'metadata' | 'series' | 'collections';
  export let targets: ShelfBook[];
  export let collections: Collection[];
  export let seriesNames: string[];
  export let save: (change: PresentationChange) => Promise<void>;
  export let membership: (id: string, included: boolean) => Promise<void>;
  export let create: (name: string) => Promise<void>;
  export let close: () => void;
  let open = true,
    busy = false,
    alive = true,
    error = '';
  const book = targets[0];
  let title = book?.title ?? '';
  let authors = book?.creators?.map((creator) => creator.name).join('\n') ?? '';
  let authorSort = book?.creators?.map((creator) => creator.sortAs ?? '').join('\n') ?? '';
  let language = book?.metadata?.language ?? '';
  let publisher = book?.metadata?.publisher ?? '';
  let published = book?.metadata?.published ?? '';
  let description = book?.metadata?.description ?? '';
  let subjects = book?.metadata?.subjects?.join('\n') ?? '';
  let seriesName = targets.every((target) => target.series?.name === book?.series?.name)
    ? (book?.series?.name ?? '')
    : '';
  let seriesIndex =
    mode === 'metadata' && book?.series?.index !== undefined ? String(book.series.index) : '';
  let collectionName = '';
  let coverBlur = book?.coverBlur ?? false;
  onDestroy(() => {
    alive = false;
  });
  $: if (!open) close();
  async function run(work: () => Promise<void>, finish = false) {
    if (busy) return;
    busy = true;
    error = '';
    try {
      await work();
      if (alive && finish) open = false;
    } catch (cause) {
      if (alive) error = cause instanceof Error ? cause.message : 'The change could not be saved.';
    } finally {
      if (alive) busy = false;
    }
  }
  function seriesValue() {
    return seriesName.trim()
      ? {
          name: seriesName.trim().normalize('NFC'),
          ...(seriesIndex.trim() ? { index: Number(seriesIndex) } : {})
        }
      : null;
  }
  function submit() {
    void run(async () => {
      const series = seriesValue();
      if (!validBookSeries(series))
        throw new Error('Use a series name up to 240 characters and a nonnegative number.');
      if (mode === 'series') {
        await save({ series });
        return;
      }
      const sorts = authorSort.split(/\r?\n/);
      const names = authors.trim() ? authors.split(/\r?\n/) : [];
      const metadata = {
        creators: names.map((name, index) => ({
          name: name.replace(/\s+/gu, ' ').trim(),
          ...(sorts[index]?.trim() ? { sortAs: sorts[index].replace(/\s+/gu, ' ').trim() } : {})
        })),
        language: language.trim(),
        publisher: publisher.trim(),
        published: published.trim(),
        description,
        subjects: subjects
          .split(/\r?\n/)
          .map((subject) => subject.trim())
          .filter(Boolean)
      };
      if (!validBookMetadata(metadata))
        throw new Error(
          'Check the metadata: up to 32 authors and 64 tags, with no empty author lines.'
        );
      await save({ title, metadata, series, coverBlur });
    }, true);
  }
  function members(collection: Collection) {
    return targets.filter((target) =>
      target.organizationAliases.some((alias) => collection.members.includes(alias))
    ).length;
  }
  function mixed(input: HTMLInputElement, value: boolean) {
    input.indeterminate = value;
    return {
      update(next: boolean) {
        input.indeterminate = next;
      }
    };
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content closeDisabled={busy} class="sm:max-w-xl">
    <Dialog.Header>
      <Dialog.Title
        >{mode === 'metadata'
          ? 'Edit book metadata'
          : mode === 'series'
            ? 'Add to series'
            : 'Add to collection'}</Dialog.Title
      >
      <Dialog.Description
        >{mode === 'metadata'
          ? 'Edit your Library metadata. The original EPUB, reading position, notes and history are unchanged.'
          : mode === 'series'
            ? `Organize ${targets.length} selected ${targets.length === 1 ? 'book' : 'books'} in a new or existing personal series. Original files stay where they are.`
            : `Update collections for ${targets.length} selected ${targets.length === 1 ? 'book' : 'books'}. Mixed checkboxes mean only some are included.`}</Dialog.Description
      >
    </Dialog.Header>
    {#if mode === 'collections'}
      <div class="grid gap-2">
        {#each collections as collection (collection.id)}
          {@const count = members(collection)}
          <label class="flex min-h-11 items-center gap-3 rounded-xl border border-border px-3">
            <input
              type="checkbox"
              checked={count === targets.length}
              use:mixed={count > 0 && count < targets.length}
              disabled={busy}
              onchange={(event) => {
                const included = event.currentTarget.checked;
                void run(() => membership(collection.id, included));
              }}
            />
            <span class="min-w-0 break-words">{collection.name}</span>
          </label>
        {/each}
      </div>
      <form
        class="flex flex-wrap items-end gap-2"
        onsubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await create(collectionName);
            if (alive) collectionName = '';
          });
        }}
      >
        <label class="grid min-w-0 flex-1 gap-2"
          >New collection name
          <input
            class="metadata-input"
            bind:value={collectionName}
            maxlength="240"
            required
            disabled={busy}
          />
        </label>
        <Button type="submit" variant="secondary" disabled={busy}>Create</Button>
      </form>
      <Dialog.Footer
        ><Button variant="secondary" disabled={busy} onclick={() => (open = false)}>Done</Button
        ></Dialog.Footer
      >
    {:else}
      <form
        class="grid gap-4"
        onsubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <fieldset disabled={busy} class="grid min-w-0 gap-4">
          {#if mode === 'metadata'}
            <label class="grid gap-2"
              >Title<input
                class="metadata-input"
                bind:value={title}
                maxlength="1000"
                required
              /></label
            >
            <label class="grid gap-2"
              >Authors (one per line)<textarea
                class="metadata-input"
                rows="3"
                bind:value={authors}
                maxlength="16415"></textarea></label
            >
            <label class="grid gap-2"
              >Author sort names (matching lines, optional)<textarea
                class="metadata-input"
                rows="2"
                bind:value={authorSort}
                maxlength="16415"></textarea></label
            >
            <div class="grid min-w-0 gap-4 sm:grid-cols-2">
              <label class="grid min-w-0 gap-2"
                >Language<input
                  class="metadata-input"
                  bind:value={language}
                  maxlength="128"
                /></label
              >
              <label class="grid min-w-0 gap-2"
                >Published<input
                  class="metadata-input"
                  bind:value={published}
                  maxlength="128"
                  placeholder="For example, 2024-03-01"
                /></label
              >
            </div>
            <label class="grid gap-2"
              >Publisher<input
                class="metadata-input"
                bind:value={publisher}
                maxlength="512"
              /></label
            >
            <label class="grid gap-2"
              >Tags (one per line)<textarea
                class="metadata-input"
                rows="2"
                bind:value={subjects}
                maxlength="15423"></textarea></label
            >
            <label class="grid gap-2"
              >Description<textarea
                class="metadata-input"
                rows="5"
                bind:value={description}
                maxlength="16000"></textarea></label
            >
            <label class="flex min-h-11 items-center gap-3"
              ><input type="checkbox" bind:checked={coverBlur} />Blur cover</label
            >
          {/if}
          <label class="grid gap-2"
            >Series<input
              class="metadata-input"
              list="personal-series-names"
              bind:value={seriesName}
              maxlength="240"
              placeholder="Choose or enter a series name"
            /></label
          >
          <datalist id="personal-series-names"
            >{#each seriesNames as name (name)}<option value={name}></option>{/each}</datalist
          >
          {#if mode === 'metadata'}
            <label class="grid gap-2"
              >Number in series<input
                class="metadata-input"
                type="text"
                inputmode="decimal"
                bind:value={seriesIndex}
                disabled={!seriesName.trim()}
                placeholder="Optional, for example 2 or 2.5"
              /></label
            >
          {:else}
            <p class="text-sm text-muted-foreground">
              Leave the name empty to remove personal series membership. Edit individual metadata to
              set volume numbers.
            </p>
          {/if}
        </fieldset>
        <Dialog.Footer>
          <Button variant="outline" disabled={busy} onclick={() => (open = false)}>Cancel</Button>
          <Button type="submit" variant="secondary" disabled={busy}
            >{busy ? 'Saving…' : 'Save'}</Button
          >
        </Dialog.Footer>
      </form>
    {/if}
    {#if error}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
  </Dialog.Content>
</Dialog.Root>

<style>
  .metadata-input {
    width: 100%;
    min-width: 0;
    min-height: 44px;
    border: 1px solid var(--input);
    border-radius: 10px;
    background: var(--background);
    color: var(--foreground);
    padding: 0.65rem 0.75rem;
  }
  textarea {
    resize: vertical;
  }
</style>
