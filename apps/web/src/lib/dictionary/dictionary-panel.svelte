<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { ProviderController, type ManagedProvider, type TransitionState } from './provider-controller';
  import { loadRuntime, archivePath } from './assets';
  import { ExtensionBridge } from './extension-bridge';
  import type { Provider, Runtime, WebClient, DictionaryStatus, Result, Recommended, Scanner } from './api';

  const key = 'manabi-reader.dictionary-provider.v1';
  let provider: Provider = 'builtin';
  let phase: TransitionState['phase'] = 'idle';
  let panelOpen = false, popupOpen = false, busy = false, mounted = false, started = false;
  let message = '', error = '', coexistence = '', query = '', offlineReady = false;
  let status: DictionaryStatus | undefined;
  let catalog: Recommended[] = [];
  let runtime: Runtime | undefined, client: WebClient | undefined, scanner: Scanner | undefined;
  let controller: ProviderController;
  let results: HTMLDivElement;
  let popupDisposer: (() => void) | undefined;
  let operation: AbortController | undefined;
  let lookup: AbortController | undefined;
  let generation = 0;
  let scannerAuthorized = false;
  let uncoordinatedConsent = false;
  let route = '';
  const displayError = (value: unknown) => value instanceof Error ? value.message : String(value);
  const bytes = (value?: number) => value === undefined ? 'Unavailable' : `${(value / 1024 / 1024).toFixed(1)} MiB`;
  $: defaultInstalled = status?.dictionaries.some((d) => /^Jitendex(?:\b|\s)/i.test(d.title)) ?? false;
  $: routeKey = $page.url.pathname + $page.url.search;
  $: if (mounted && routeKey !== route) {
    route = routeKey;
    if (started) void choose(provider, false);
  }

  function clearPopup() {
    popupOpen = false; lookup?.abort(); lookup = undefined;
    popupDisposer?.(); popupDisposer = undefined; results?.replaceChildren();
  }
  function showResult(value: Result, expected: number, owner: WebClient, module: Runtime) {
    if (generation !== expected || client !== owner || provider !== 'builtin') return;
    popupDisposer?.(); popupDisposer = module.render(results, value, owner, (text) => { query = text; void search(); });
    popupOpen = true;
  }
  function managed(mode: Provider): ManagedProvider {
    if (mode !== 'builtin') return { async start() { message = mode === 'extension' ? 'Reader lookup is disabled. Use your extension’s normal scan gesture.' : 'Reader lookup is off. Independently installed extensions are not controlled by this setting.'; }, stopAccepting() {}, async close() {} };
    const bridge = new ExtensionBridge((text) => { coexistence = text; });
    let owned: WebClient | undefined, ownedScanner: Scanner | undefined;
    let accepts = true;
    const epoch = ++generation;
    return {
      async start(signal) {
        error = ''; message = 'Checking dictionary ownership…';
        const coordinated = await bridge.suspend(signal); signal.throwIfAborted();
        const module = await loadRuntime(signal, (text) => { if (accepts) message = text; });
        signal.throwIfAborted();
        owned = new module.Client();
        const opened = await owned.open(); signal.throwIfAborted();
        if (!accepts) throw new DOMException('Cancelled', 'AbortError');
        runtime = module; client = owned; status = opened; offlineReady = module.offlineReady;
        catalog = await module.presets.recommendedDictionaries(); signal.throwIfAborted();
        ownedScanner = module.createScanner(owned, document.body, {
          includeSelector: '.book-content, .book-content *',
          onResult: (result) => { if (accepts && owned) showResult(result, epoch, owned, module); },
          onError: (e) => { if (accepts) error = e.message; }
        });
        scanner = ownedScanner; scannerAuthorized = coordinated || uncoordinatedConsent;
        if (scannerAuthorized) ownedScanner.start();
        message = opened.dictionaries.length ? 'Ready. Hold Shift and hover Japanese text, or tap text on a touch device.' : 'Install Jitendex below, or import a compatible Yomitan dictionary ZIP.';
      },
      stopAccepting() {
        accepts = false; generation += 1; ownedScanner?.stop();
        operation?.abort(); clearPopup();
      },
      async close() {
        try { await owned?.close(); }
        finally {
          if (client === owned) { client = undefined; scanner = undefined; status = undefined; runtime = undefined; catalog = []; }
          await bridge.release();
        }
      }
    };
  }
  async function choose(mode: Provider, persist = true) {
    provider = mode; started = true; error = ''; busy = false;
    if (persist) {
      try { localStorage.setItem(key, mode); }
      catch { error = 'The browser could not save your provider selection.'; }
    }
    try { await controller.select(mode); } catch (e) { error = displayError(e); }
  }
  function openPanel() {
    panelOpen = true; clearPopup();
    if (!started || phase === 'failed') void choose(provider, false);
  }
  async function search() {
    const owner = client, module = runtime, epoch = generation;
    if (!owner || !module || provider !== 'builtin' || busy || !query.trim()) return;
    lookup?.abort(); const abort = new AbortController(); lookup = abort;
    try {
      const result = await owner.lookup(query.trim().slice(0, 256), { signal: abort.signal });
      if (!abort.signal.aborted) showResult(result, epoch, owner, module);
    } catch (e) { if (!abort.signal.aborted && epoch === generation) error = displayError(e); }
  }
  async function perform(run: (owner: WebClient, module: Runtime, signal: AbortSignal) => Promise<void>) {
    const owner = client, module = runtime, epoch = generation;
    if (!owner || !module || provider !== 'builtin' || busy) return;
    busy = true; error = ''; clearPopup(); scanner?.stop();
    const abort = new AbortController(); operation = abort;
    try { await run(owner, module, abort.signal); }
    catch (e) { if (epoch === generation) error = displayError(e); }
    finally {
      if (epoch === generation) { busy = false; operation = undefined; if (scannerAuthorized) scanner?.start(); }
    }
  }
  async function importArchive(archive: Blob, isDefault = false) {
    const expected = generation;
    await perform(async (owner, module, signal) => {
      await navigator.storage.persist?.().catch(() => false);
      let source = archive;
      if (isDefault) {
        source = await module.presets.downloadDefaultDictionary(new URL(archivePath + module.presets.DEFAULT_DICTIONARY.fileName, location.origin), {
          signal, onProgress: (done, total) => { if (generation !== expected) return; message = `Downloading Jitendex: ${bytes(done)} / ${bytes(total)}`; }
        });
      }
      signal.throwIfAborted();
      const imported = await owner.importDictionary(source, { signal, onProgress: (value) => {
        if (generation === expected && value && typeof value === 'object') {
          const p = value as { index?: number; count?: number };
          message = Number.isFinite(p.index) && Number.isFinite(p.count) ? `Importing dictionary: ${p.index}/${p.count}` : 'Importing dictionary locally…';
        }
      } });
      // A cancellation can lose to commit. Preserve the actual publication outcome.
      if (generation !== expected || client !== owner) return;
      const installed = isDefault ? await owner.setDefault('installed', imported.summary.title) : imported.status;
      if (generation !== expected || client !== owner) return;
      status = installed;
      message = `${imported.summary.title} installed.${imported.cancelledAfterCommit ? ' The import committed before cancellation took effect.' : ''}`;
      if (imported.warnings.length) error = imported.warnings.join('; ');
    });
  }
  async function setEnabled(title: string, enabled: boolean) {
    const expected = generation;
    await perform(async (owner) => { const next = await owner.setEnabled(title, enabled); if (expected !== generation) return; status = next; message = enabled ? 'Dictionary enabled.' : 'Dictionary disabled. It will not be automatically re-enabled.'; });
  }
  async function remove(title: string) {
    if (!confirm(`Delete ${title} from this browser?`)) return;
    const expected = generation;
    await perform(async (owner, _module, signal) => { const next = await owner.deleteDictionary(title, { signal }); if (expected !== generation) return; status = next; message = 'Dictionary deleted. It will not be reinstalled automatically.'; });
  }
  async function declineDefault() {
    const expected = generation;
    await perform(async (owner) => { const next = await owner.setDefault('declined'); if (expected !== generation) return; status = next; message = 'Jitendex will not be installed automatically.'; });
  }
  onMount(() => {
    try { const saved = localStorage.getItem(key); if (saved === 'builtin' || saved === 'extension' || saved === 'off') provider = saved; } catch { /* Keep a usable explicit default. */ }
    controller = new ProviderController(managed, (state) => { phase = state.phase; if (state.error) error = state.error.message; });
    route = routeKey; mounted = true;
    const firstUse = (event: PointerEvent) => {
      if (started || provider !== 'builtin' || !(event.target instanceof Element) || !event.target.closest('.book-content')) return;
      if (event.pointerType === 'touch' || event.shiftKey) openPanel();
    };
    document.addEventListener('pointerdown', firstUse, true); document.addEventListener('pointermove', firstUse, { capture: true, passive: true });
    return () => {
      mounted = false; document.removeEventListener('pointerdown', firstUse, true); document.removeEventListener('pointermove', firstUse, true);
      operation?.abort(); clearPopup(); void controller.close().catch(() => {});
    };
  });
</script>

<svelte:window on:keydown={(event) => { if (event.key === 'Escape') { panelOpen = false; clearPopup(); } }} />
<button class="dictionary-launcher" aria-label="Dictionary settings" on:click={openPanel}>Dictionary</button>
{#if panelOpen}
  <dialog open class="dictionary-settings" aria-modal="false" aria-label="Dictionary settings" data-dictionary-settings data-provider-state={phase}>
    <header><h2>Japanese dictionaries</h2><button aria-label="Close dictionary settings" on:click={() => (panelOpen = false)}>Close</button></header>
    <label>Lookup provider
      <select aria-label="Lookup provider" value={provider} on:change={(e) => choose(e.currentTarget.value as Provider)}>
        <option value="builtin">Built-in ManabiTan — recommended</option>
        <option value="extension">My Yomitan / ManabiTan extension</option>
        <option value="off">Reader lookup off</option>
      </select>
    </label>
    <p role="status" data-dictionary-progress>{message}</p>
    {#if error}<p role="alert">{error}</p>{/if}
    {#if provider === 'builtin'}
      {#if coexistence}<p class="dictionary-note">{coexistence}</p>{/if}
      {#if phase === 'failed'}<button on:click={() => choose('builtin', false)}>Retry dictionary initialization</button>{/if}
      {#if status && phase === 'active'}
        {#if !scannerAuthorized}
          <p>Built-in scanning is stopped because extension cooperation is unknown. Disable extension scanning for this site before continuing. Manual lookup and dictionary installation remain available.</p>
          <button disabled={busy} on:click={() => { uncoordinatedConsent = true; scannerAuthorized = true; scanner?.start(); }}>Enable built-in scanning</button>
        {/if}
        {#if !defaultInstalled}
          <section aria-label="Default dictionary">
            <p>{status.preferences.defaultChoice === 'unasked' ? 'Jitendex is the recommended Japanese–English dictionary.' : 'Your previous Jitendex choice is respected. Installation below is optional.'}</p>
            <button disabled={busy} on:click={() => importArchive(new Blob(), true)}>Install Jitendex</button>
            {#if status.preferences.defaultChoice === 'unasked'}<button disabled={busy} on:click={declineDefault}>Not now</button>{/if}
            <a href={runtime?.presets.DEFAULT_DICTIONARY.notices} target="_blank" rel="noopener noreferrer">Dictionary licenses and attribution</a>
          </section>
        {/if}
        <label>Import custom Yomitan dictionary ZIP
          <input aria-label="Import custom dictionary" type="file" accept=".zip,application/zip" disabled={busy} on:change={(e) => {
            const file = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (file) void importArchive(file);
          }} />
        </label>
        {#if busy}<button on:click={() => { message = 'Cancelling; waiting for the storage owner to finish…'; operation?.abort(); }}>Cancel dictionary operation</button>{/if}
        <h3>Installed</h3>
        {#each status.dictionaries as dictionary, i (dictionary.title)}
          <div class="dictionary-installed" data-dictionary-title={dictionary.title}>
            <label><input type="checkbox" checked={!status.preferences.disabled.includes(dictionary.title)} disabled={busy} on:change={(e) => setEnabled(dictionary.title, e.currentTarget.checked)} /> {dictionary.title}</label>
            <span>{status.counts.counts[i]?.terms ?? 0} term records</span>
            <button disabled={busy} on:click={() => remove(dictionary.title)}>Delete</button>
          </div>
        {:else}<p>No dictionaries installed.</p>{/each}
        <form on:submit|preventDefault={search}>
          <label>Look up Japanese <input aria-label="Japanese lookup text" bind:value={query} maxlength="256" /></label>
          <button type="submit" disabled={busy}>Look up</button>
        </form>
        <h3>Storage</h3>
        <p>{status.storage.persisted ? 'Persistent storage granted' : 'Best-effort storage — the browser may evict data'}. Site usage: {bytes(status.storage.usage)}. This includes books and other site data.</p>
        <p>{offlineReady ? 'Dictionary tools are cached for offline use.' : 'Reload online once so the service worker can serve the installed tools offline.'}</p>
        <details><summary>Recommended dictionaries</summary>
          <p>From ManabiTan’s existing catalog. Download a compatible ZIP, review its license, then import it above. Only Jitendex currently has a verified one-click static download.</p>
          {#each catalog as item}<p><a href={item.homepage} target="_blank" rel="noopener noreferrer">{item.name}</a> — {item.category}<br />{item.description} <a href={item.downloadUrl} target="_blank" rel="noopener noreferrer">Download</a></p>{/each}
        </details>
      {/if}
    {:else}
      <p>{provider === 'extension' ? 'Reader does not initialize its dictionary database or download dictionaries in extension mode.' : 'This switch cannot disable independently installed extensions.'}</p>
    {/if}
  </dialog>
{/if}
<dialog class="dictionary-popup" aria-label="Dictionary lookup" open={popupOpen} data-manabitan-web-popup>
  <button aria-label="Close dictionary lookup" on:click={clearPopup}>Close</button>
  <div bind:this={results}></div>
</dialog>

<style>
  .dictionary-launcher { position: fixed; bottom: 2.5rem; right: .75rem; z-index: 30; border: 1px solid; border-radius: .5rem; padding: .35rem .65rem; background: Canvas; color: CanvasText; }
  .dictionary-settings, .dictionary-popup { position: fixed; margin: 0; left: auto; right: 1rem; top: 4rem; z-index: 100; width: min(34rem, calc(100vw - 2rem)); max-height: calc(100dvh - 6rem); overflow: auto; padding: 1rem; border: 1px solid; border-radius: .6rem; background: Canvas; color: CanvasText; box-shadow: 0 .3rem 2rem #0005; writing-mode: horizontal-tb; font-family: system-ui, sans-serif; }
  .dictionary-popup { z-index: 110; top: auto; bottom: 1rem; }
  .dictionary-popup:not([open]) { display: none; }
  header { display: flex; align-items: center; justify-content: space-between; gap: .75rem; }
  h2 { font-size: 1.2rem; font-weight: 700; } h3 { font-weight: 650; margin-top: 1rem; }
  p { margin: .7rem 0; } label { display: block; margin: .6rem 0; } select, input:not([type='checkbox']) { max-width: 100%; border: 1px solid; padding: .25rem; background: Canvas; color: CanvasText; }
  button { border: 1px solid; padding: .25rem .55rem; margin: .15rem; border-radius: .3rem; } button:disabled { opacity: .5; }
  a { text-decoration: underline; } .dictionary-note { font-size: .85rem; } [role='alert'] { border-inline-start: .25rem solid; padding-inline-start: .5rem; }
  .dictionary-installed { border-bottom: 1px solid #8886; padding: .4rem 0; } .dictionary-installed span { font-size: .8rem; }
  .dictionary-popup :global(.headword) { font-size: 1.3rem; font-weight: 600; } .dictionary-popup :global(.dictionary-entry) { margin-bottom: 1rem; } .dictionary-popup :global(li) { margin-block: .3rem; } .dictionary-popup :global(.frequency) { font-size: .85rem; }
</style>
