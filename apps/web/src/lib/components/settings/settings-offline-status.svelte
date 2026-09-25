<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { getOfflineStatus, type OfflineStatus } from '$lib/service-worker/offline-status.mjs';
  import SettingsItemGroup from './settings-item-group.svelte';

  let status: OfflineStatus = { state: 'unknown', updateWaiting: false };
  let checking = true;
  const labels = {
    ready: 'App ready for offline reopening',
    incomplete: 'Offline app files are incomplete',
    unavailable: 'Offline storage is unavailable',
    preparing: 'Preparing offline app files',
    unsupported: 'Offline reopening is unavailable in this browser',
    unknown: 'Offline readiness has not been confirmed'
  };

  onMount(() => {
    let stopped = false;
    let pending = false;
    const controller = new AbortController();
    let workers: ServiceWorkerContainer | undefined;
    try {
      workers = navigator.serviceWorker;
    } catch {
      // Some privacy/security configurations deny access even to the getter.
    }
    const refresh = async () => {
      if (stopped || pending || document.visibilityState !== 'visible') return;
      pending = true;
      try {
        const result = await getOfflineStatus(workers, new URL(`${base}/`, location.origin).href, {
          signal: controller.signal
        });
        if (!stopped) {
          status = result;
          checking = false;
        }
      } finally {
        pending = false;
      }
    };
    void refresh();
    // This inspector exists only while Settings is mounted. It never registers
    // or updates workers and never blocks Library/Reader startup.
    const timer = setInterval(() => void refresh(), 15000);
    const changed = () => void refresh();
    window.addEventListener('online', changed);
    document.addEventListener('visibilitychange', changed);
    workers?.addEventListener('controllerchange', changed);
    return () => {
      stopped = true;
      controller.abort();
      clearInterval(timer);
      window.removeEventListener('online', changed);
      document.removeEventListener('visibilitychange', changed);
      workers?.removeEventListener('controllerchange', changed);
    };
  });
</script>

<SettingsItemGroup
  title="Offline reading"
  category="library"
  settingId="offline-reading"
  keywords="offline internet download cache storage PWA installation"
>
  <p role="status" class="text-sm font-medium">
    {checking ? 'Checking offline app files…' : labels[status.state]}
  </p>
  <p class="mt-2 text-sm text-muted-foreground">
    Offline support is automatic; installing a Home Screen app is optional. Books saved in this
    browser can be read offline. Remote-only books still need a connection to download.
  </p>
  {#if status.updateWaiting}
    <p class="mt-2 text-sm text-muted-foreground">
      An update is ready. It will be used after all Reader tabs and windows are closed; your current
      reading session will not be reloaded.
    </p>
  {/if}
  {#if !checking && ['preparing', 'incomplete', 'unknown'].includes(status.state)}
    <p class="mt-2 text-sm text-muted-foreground">
      Offline reopening is not yet confirmed. Use Reader online before relying on offline access.
      This status does not mean your saved books or reading progress were deleted.
    </p>
  {/if}
  <p class="mt-2 text-xs text-muted-foreground">
    This checks app files, not every book, font, dictionary, or audio file. Browser storage can be
    cleared; keep backups of important local data.
  </p>
</SettingsItemGroup>
