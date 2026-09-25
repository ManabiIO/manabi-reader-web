<script lang="ts">
  import AppNav from '$lib/components/navigation/app-nav.svelte';
  import { Button } from '$lib/components/ui/button';
  export let leavePageLink: string;
</script>

<header
  class="app-header flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-3 py-2 text-foreground sm:px-6"
>
  <div class="flex items-center gap-3">
    <Button href={leavePageLink} variant="ghost">Back</Button><span class="font-semibold"
      >Settings</span
    >
  </div>
  <AppNav />
</header>
