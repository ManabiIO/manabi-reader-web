<script lang="ts">
  import HardDrive from '@lucide/svelte/icons/hard-drive';
  export let provider: string | undefined = undefined;
  export let name = '';
  const labels: Record<string, string> = {
    google: 'Google Drive',
    dropbox: 'Dropbox',
    onedrive: 'OneDrive',
    local: 'Local folder'
  };
  $: label = `${labels[provider || ''] || 'Connected library'}${name && provider === 'local' ? `: ${name}` : ''}`;
</script>

{#if provider}
  <span
    class="inline-flex shrink-0 items-center text-muted-foreground"
    title={label}
    aria-label={label}
    role="img"
  >
    {#if provider === 'local'}<HardDrive class="size-4" aria-hidden="true" />
    {:else}
      <svg class="size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        {#if provider === 'google'}
          <path
            d="M8.3 2h7.4L23 15h-7.4L8.3 2ZM7.1 3.9l3.7 6.4L3.5 23 0 16.6 7.1 3.9ZM7.2 17H22l-3.5 6H3.7l3.5-6Z"
          />
        {:else if provider === 'dropbox'}
          <path
            d="m6 2 6 4-6 4-6-4 6-4Zm12 0 6 4-6 4-6-4 6-4ZM6 10l6 4-6 4-6-4 6-4Zm12 0 6 4-6 4-6-4 6-4Zm-6 5 6 4-6 4-6-4 6-4Z"
          />
        {:else if provider === 'onedrive'}
          <path d="M9 5a6 6 0 0 1 10.8 3.5A5 5 0 0 1 19 18H5a5 5 0 1 1 1.1-9.9A6 6 0 0 1 9 5Z" />
        {:else}<path d="M3 5h7l2 2h9v13H3V5Zm2 4v9h14V9H5Z" />{/if}
      </svg>
    {/if}
  </span>
{/if}
