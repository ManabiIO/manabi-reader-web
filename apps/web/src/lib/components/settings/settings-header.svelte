<script lang="ts">
  import AppNav from '$lib/components/navigation/app-nav.svelte';
  import { Button } from '$lib/components/ui/button';
  import { CaretLeftIcon } from 'phosphor-svelte';
  export let leavePageLink: string;
</script>

<header class="app-header settings-header border-b border-border bg-card text-foreground">
  <Button href={leavePageLink} variant="ghost" aria-label="Back" class="settings-back">
    <CaretLeftIcon class="size-5 shrink-0" aria-hidden="true" />
    <span class="back-label">Back</span>
  </Button>
  <h1 class="settings-title font-semibold">Settings</h1>
  <div class="settings-navigation"><AppNav compact /></div>
</header>

<style>
  .settings-header {
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr) 44px;
    align-items: center;
    gap: 8px;
    min-height: 64px;
    padding: 8px 12px;
  }
  .settings-title {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .settings-navigation {
    min-width: 0;
    justify-self: end;
  }
  .back-label {
    display: none;
  }
  .settings-header :global(.settings-back) {
    width: 44px;
    height: 44px;
    min-height: 44px;
    padding: 0;
    border-radius: 50%;
  }
  @media (min-width: 640px) {
    .settings-header {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      padding-inline: 24px;
    }
    .settings-navigation {
      margin-inline-start: auto;
    }
    .back-label {
      display: inline;
    }
    .settings-header :global(.settings-back) {
      width: auto;
      height: auto;
      padding: 8px 12px;
      border-radius: 12px;
    }
  }
</style>
