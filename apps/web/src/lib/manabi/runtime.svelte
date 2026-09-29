<script lang="ts">
  import SnippetCapture from '../snippets/capture.svelte';
  import { startSnippets } from '../snippets/service';
  import { isSnippetLibraryPath } from '../snippets/discovery';
  import { derived } from 'svelte/store';
  import { onMount } from 'svelte';
  import { startMediaProfileWatcher } from './media-profile';
  import { page } from '$app/stores';
  import { base, resolve } from '$app/paths';
  import { refreshAccount } from './client';
  import { startPreferenceSync } from './preferences';
  import { bookSyncStatus, startBookSync } from './books';
  import { personalSyncStatus } from './personal-sync';

  $: needsAttention =
    ['conflict', 'legacy_statistics'].includes($personalSyncStatus.state) ||
    Object.values($bookSyncStatus).some((status) =>
      ['conflict', 'needs_reconnect', 'permission_required', 'unauthorized'].includes(status.state)
    );
  onMount(() => {
    const stopMediaProfile = startMediaProfileWatcher();
    const stopSnippets = startSnippets(
      derived(page, (current) => isSnippetLibraryPath(current.url.pathname, base))
    );
    const stopPreferences = startPreferenceSync();
    const stopBooks = startBookSync();
    let lastRefreshStarted = 0;
    const refresh = (force = false) => {
      const now = Date.now();
      // Refocusing a newly mounted page must not start a duplicate request. In
      // WebKit that request can surface as a CORS page error if the tab closes.
      if (!force && now - lastRefreshStarted < 30_000) return;
      lastRefreshStarted = now;
      void refreshAccount(force);
    };
    const refreshOnline = () => refresh(true);
    const refreshFocus = () => refresh();
    refresh();
    window.addEventListener('online', refreshOnline);
    window.addEventListener('focus', refreshFocus);
    return () => {
      stopMediaProfile();
      stopSnippets();
      stopPreferences();
      stopBooks();
      window.removeEventListener('online', refreshOnline);
      window.removeEventListener('focus', refreshFocus);
    };
  });
</script>

<SnippetCapture />

{#if needsAttention && $page.url.pathname !== `${base}/connections`}
  <aside role="status">
    <a href={resolve('/connections')}
      >Reading sync needs attention. Your local reading data is safe.</a
    >
  </aside>
{/if}

<style>
  aside {
    position: fixed;
    bottom: 3.5rem;
    right: 1rem;
    z-index: 30;
    max-width: 22rem;
    padding: 0.65rem 1rem;
    border-radius: 0.5rem;
    background: var(--card);
    color: var(--foreground);
    border: 1px solid var(--border);
    box-shadow: 0 2px 8px #0003;
    font:
      14px/1.4 system-ui,
      sans-serif;
    writing-mode: horizontal-tb;
  }
  a {
    text-decoration: underline;
  }
</style>
