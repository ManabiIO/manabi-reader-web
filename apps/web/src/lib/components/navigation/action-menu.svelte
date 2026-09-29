<script lang="ts">
  import * as Menu from '$lib/components/ui/dropdown-menu';
  import { Button, type ButtonVariant } from '$lib/components/ui/button';
  import { CaretDownIcon as ChevronDown } from 'phosphor-svelte';
  export let label: string;
  export let title = '';
  export let disabled = false;
  export let open = false;
  export let variant: ButtonVariant = 'outline';
  export let iconOnly = false;
</script>

<Menu.Root bind:open>
  <Menu.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        {disabled}
        {variant}
        class={iconOnly ? 'size-[44px] min-h-[44px] rounded-full p-0' : 'min-h-9'}
        aria-label={title || label}
        title={title || label}
      >
        {#if !iconOnly}{label}{/if}<ChevronDown
          class={iconOnly ? 'size-[24px]' : 'size-3.5'}
          aria-hidden="true"
        />
      </Button>
    {/snippet}
  </Menu.Trigger>
  <Menu.Content
    align="end"
    class="max-h-[min(75dvh,36rem)] w-64 max-w-[calc(100vw-1rem)] overflow-y-auto"
  >
    <slot />
  </Menu.Content>
</Menu.Root>
