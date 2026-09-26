<script lang="ts" module>
  export type Side = 'top' | 'right' | 'bottom' | 'left';
</script>

<script lang="ts">
  import { Dialog as SheetPrimitive } from 'bits-ui';
  import CloseButton from '$lib/components/ui/close-button.svelte';
  import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';
  import SheetOverlay from './sheet-overlay.svelte';
  import SheetPortal from './sheet-portal.svelte';
  import type { Snippet } from 'svelte';
  import type { ComponentProps } from 'svelte';
  import { focusModalStart } from '$lib/hooks/focus-modal-start';
  import { containModalTab } from '$lib/hooks/focus-trap-fallback.js';
  import { preserveModalFocus } from '$lib/hooks/preserve-modal-focus.js';

  let {
    ref = $bindable(null),
    class: className,
    side = 'right',
    showCloseButton = true,
    closeDisabled = false,
    onEscapeKeydown,
    onInteractOutside,
    onkeydowncapture,
    onOpenAutoFocus,
    portalProps,
    overlayProps,
    children,
    ...restProps
  }: WithoutChildrenOrChild<SheetPrimitive.ContentProps> & {
    portalProps?: WithoutChildrenOrChild<ComponentProps<typeof SheetPortal>>;
    overlayProps?: ComponentProps<typeof SheetOverlay>;
    side?: Side;
    showCloseButton?: boolean;
    closeDisabled?: boolean;
    children: Snippet;
  } = $props();
</script>

<SheetPortal {...portalProps}>
  <SheetOverlay {...overlayProps} />
  <SheetPrimitive.Content
    bind:ref
    onEscapeKeydown={(event) => {
      onEscapeKeydown?.(event);
      if (closeDisabled) event.preventDefault();
    }}
    onInteractOutside={(event) => {
      onInteractOutside?.(event);
      if (closeDisabled) event.preventDefault();
    }}
    onkeydowncapture={(event) => {
      onkeydowncapture?.(event);
      containModalTab(event);
    }}
    onOpenAutoFocus={(event) => {
      preserveModalFocus(event, ref, onOpenAutoFocus);
      if (!event.defaultPrevented && ref) focusModalStart(event, ref);
    }}
    data-modal-close-button={showCloseButton ? '' : undefined}
    data-slot="sheet-content"
    data-side={side}
    class={cn(
      'bg-popover text-popover-foreground fixed z-50 flex max-h-dvh flex-col overflow-y-auto overscroll-contain bg-clip-padding text-sm shadow-xl transition duration-200 ease-in-out data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-[side=bottom]:data-open:slide-in-from-bottom-10 data-[side=left]:data-open:slide-in-from-left-10 data-[side=right]:data-open:slide-in-from-right-10 data-[side=top]:data-open:slide-in-from-top-10 data-closed:animate-out data-closed:fade-out-0 data-[side=bottom]:data-closed:slide-out-to-bottom-10 data-[side=left]:data-closed:slide-out-to-left-10 data-[side=right]:data-closed:slide-out-to-right-10 data-[side=top]:data-closed:slide-out-to-top-10',
      className
    )}
    {...restProps}
  >
    {@render children?.()}
    {#if showCloseButton}
      <SheetPrimitive.Close data-slot="sheet-close">
        {#snippet child({ props })}
          <CloseButton {...props} disabled={closeDisabled} class="absolute top-[16px] end-[16px]" />
        {/snippet}
      </SheetPrimitive.Close>
    {/if}
  </SheetPrimitive.Content>
</SheetPortal>
