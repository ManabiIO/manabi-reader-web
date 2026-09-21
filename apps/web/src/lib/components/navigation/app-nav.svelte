<script lang="ts">
  import { page } from '$app/stores';
  import { base, resolve } from '$app/paths';
  import * as Sheet from '$lib/components/ui/sheet';
  import { Button } from '$lib/components/ui/button';
  import {
    BookOpenIcon as BookOpen,
    ChartBarIcon as ChartNoAxesCombined,
    CloudIcon as Cloud,
    FileArrowUpIcon as FileInput,
    FolderOpenIcon as FolderOpen,
    GearIcon as Settings,
    ListIcon as MenuIcon
  } from 'phosphor-svelte';
  export let iconOnly = false;
  let open = false;
  const destinations = [
    {
      path: '/manage',
      label: 'Library',
      icon: BookOpen,
      detail: 'Books on this device and connected storage'
    },
    {
      path: '/statistics',
      label: 'Statistics',
      icon: ChartNoAxesCombined,
      detail: 'Reading time, characters, and activity'
    },
    {
      path: '/settings',
      label: 'Settings',
      icon: Settings,
      detail: 'Appearance, reading, data, and goals'
    },
    {
      path: '/connections',
      label: 'Accounts and libraries',
      icon: Cloud,
      detail: 'Manabi account, cloud drives, and local folders'
    },
    {
      path: '/shared-library',
      label: 'Shared libraries',
      icon: FolderOpen,
      detail: 'Manage shared local-folder libraries'
    },
    {
      path: '/import-ttu',
      label: 'Import from Ttu Ebook Reader',
      icon: FileInput,
      detail: 'Bring books, bookmarks, and reading data'
    }
  ] as const;
</script>

<Sheet.Root bind:open>
  <Sheet.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        variant="ghost"
        size={iconOnly ? 'icon' : 'default'}
        class={iconOnly ? 'size-11 shrink-0 rounded-full' : 'min-h-9'}
        aria-label={iconOnly ? 'Main menu' : 'Navigate'}
        title={iconOnly ? 'Main menu' : undefined}
      >
        <MenuIcon
          class={iconOnly ? 'size-5' : 'size-4'}
          aria-hidden="true"
        />{#if !iconOnly}Navigate{/if}
      </Button>
    {/snippet}
  </Sheet.Trigger>
  <Sheet.Content
    side={iconOnly ? 'left' : 'right'}
    class="w-[min(24rem,calc(100vw-1rem))] overflow-y-auto"
    showCloseButton={false}
  >
    <Sheet.Header>
      <Sheet.Title>Manabi Reader</Sheet.Title>
      <Sheet.Description>Your books. Your reading space.</Sheet.Description>
      <Button variant="ghost" class="absolute right-3 top-3" onclick={() => (open = false)}
        >Close</Button
      >
    </Sheet.Header>
    <nav aria-label="Main navigation" class="grid gap-1 p-3">
      {#each destinations as destination (destination.path)}
        <a
          aria-label={destination.label}
          href={resolve(destination.path)}
          onclick={() => (open = false)}
          class="flex items-start gap-3 rounded-2xl p-3 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
          class:bg-accent={$page.url.pathname === base + destination.path}
          aria-current={$page.url.pathname === base + destination.path ? 'page' : undefined}
        >
          <svelte:component
            this={destination.icon}
            class="mt-0.5 size-4 shrink-0"
            aria-hidden="true"
          />
          <span
            ><span class="block font-medium">{destination.label}</span><span
              class="mt-1 block text-xs text-muted-foreground">{destination.detail}</span
            ></span
          >
        </a>
      {/each}
    </nav>
  </Sheet.Content>
</Sheet.Root>
