<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { account, accountScope, currentUser, request } from '$lib/manabi/client';
  import { offlineMediaProfile } from '$lib/manabi/media-profile';
  import { VideoWorkspace } from '$lib/media/workspace';
  import { chooseCloudVideo } from '$lib/media/cloud-browser';
  import { ProfileLifetime } from '$lib/media/profile-lifetime';
  import type { WorkspaceConnection } from '$lib/media/workspace';
  import '$lib/media/media.css';

  let host: HTMLDivElement;
  onMount(() => {
    const lifetime = new ProfileLifetime<WorkspaceConnection>(
      offlineMediaProfile,
      (scope, connection) => new VideoWorkspace(host, {
        scope,
        booksURL: `${base}/manage`,
        runtimeBase: `${base}/moss`,
        // Checked against the actual installed dependency by the full app typecheck.
        loadBunny: () => import('$lib/manabi/media-runtime').then(module => module.mediaRuntime),
        ...connection
      }),
      error => { host.textContent = error instanceof Error ? error.message : String(error); }
    );
    const stop = account.subscribe(state => {
      let connection: WorkspaceConnection | undefined;
      if (state.status === 'available' && state.session?.user) {
        const admitted = accountScope();
        const transport = {
          userId: admitted.userId,
          isCurrent: () => {
            try {
              return currentUser()?.id === admitted.userId &&
                accountScope().generation === admitted.generation;
            } catch { return false; }
          },
          request
        };
        connection = {
          transport,
          chooseConnected: (open, signal) => chooseCloudVideo(transport, open, signal)
        };
      }
      void lifetime.update({
        status: state.status,
        userId: state.session?.user?.id ?? null,
        connection
      });
    });
    return () => { stop(); void lifetime.stop(); };
  });
</script>

<svelte:head><title>Videos — Manabi Reader</title></svelte:head>
<div bind:this={host}></div>
