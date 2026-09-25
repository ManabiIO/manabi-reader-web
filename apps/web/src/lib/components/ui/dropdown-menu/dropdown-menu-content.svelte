<script lang="ts">
  import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui';
  import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';
  import DropdownMenuPortal from './dropdown-menu-portal.svelte';
  import { onDestroy, tick, type ComponentProps } from 'svelte';

  let {
    ref = $bindable(null),
    sideOffset = 4,
    align = 'start',
    portalProps,
    class: className,
    onOpenAutoFocus,
    onCloseAutoFocus,
    ...restProps
  }: DropdownMenuPrimitive.ContentProps & {
    portalProps?: WithoutChildrenOrChild<ComponentProps<typeof DropdownMenuPortal>>;
  } = $props();

  let focusGeneration = 0;
  let lastNode: HTMLElement | null = null;
  onDestroy(() => {
    focusGeneration += 1;
    lastNode = null;
  });
</script>

<DropdownMenuPortal {...portalProps}>
  <DropdownMenuPrimitive.Content
    bind:ref
    onOpenAutoFocus={(event) => {
      const generation = ++focusGeneration;
      if (ref) lastNode = ref;
      onOpenAutoFocus?.(event);
      if (event.defaultPrevented) return;
      // Cancel the deferred default even before the forwarded ref is ready.
      // Native keyboard entry may already have focused an item by the tick;
      // never reset that item or a subsequent ArrowDown choice to the menu.
      event.preventDefault();
      void tick().then(() => {
        const node = ref;
        if (
          generation !== focusGeneration ||
          !node?.isConnected ||
          node.dataset.state !== 'open'
        )
          return;
        lastNode = node;
        if (!node.contains(node.ownerDocument.activeElement)) node.focus({ preventScroll: true });
      });
    }}
    onCloseAutoFocus={(event) => {
      focusGeneration += 1;
      const node = ref ?? lastNode;
      onCloseAutoFocus?.(event);
      if (event.defaultPrevented) return;
      // FocusScope can briefly unmount and remount while an open menu
      // repositions. That is not a menu close, so do not restore focus to the
      // trigger and erase a keyboard choice made in the still-open menu.
      // Genuine Escape/outside/selection closes expose data-state="closed"
      // before close autofocus and retain Bits UI's normal focus restoration.
      if (node?.isConnected && node.dataset.state === 'open') event.preventDefault();
    }}
    data-slot="dropdown-menu-content"
    {sideOffset}
    {align}
    class={cn(
      'writing-horizontal-tb data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 ring-foreground/5 dark:ring-foreground/10 bg-popover text-popover-foreground min-w-32 rounded-2xl p-1 shadow-lg ring-1 duration-100 z-50 max-h-(--bits-dropdown-menu-content-available-height) w-(--bits-dropdown-menu-anchor-width) origin-(--bits-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto data-closed:overflow-hidden',
      className
    )}
    {...restProps}
  />
</DropdownMenuPortal>
