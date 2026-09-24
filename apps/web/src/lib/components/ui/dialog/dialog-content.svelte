<script lang="ts">
  import { Dialog as DialogPrimitive } from 'bits-ui';
  import CloseButton from '$lib/components/ui/close-button.svelte';
  import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';
  import * as Dialog from './index.js';
  import DialogPortal from './dialog-portal.svelte';
  import type { Snippet } from 'svelte';
  import type { ComponentProps } from 'svelte';
  import { containModalTab } from '$lib/hooks/focus-trap-fallback.js';

  let {
    ref = $bindable(null),
    class: className,
    portalProps,
    children,
    showCloseButton = true,
    onkeydowncapture,
    ...restProps
  }: WithoutChildrenOrChild<DialogPrimitive.ContentProps> & {
    portalProps?: WithoutChildrenOrChild<ComponentProps<typeof DialogPortal>>;
    children: Snippet;
    showCloseButton?: boolean;
  } = $props();
</script>

<DialogPortal {...portalProps}>
  <Dialog.Overlay />
  <DialogPrimitive.Content
    bind:ref
    onkeydowncapture={(event) => {
      onkeydowncapture?.(event);
      containModalTab(event);
    }}
    data-modal-close-button={showCloseButton ? '' : undefined}
    data-slot="dialog-content"
    class={cn(
      'bg-popover text-popover-foreground data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 ring-foreground/5 dark:ring-foreground/10 grid max-h-[calc(100dvh-max(1rem,env(safe-area-inset-top))-max(1rem,env(safe-area-inset-bottom)))] max-w-[calc(100%_-_2rem)] gap-6 overflow-y-auto overscroll-contain rounded-[min(var(--radius-4xl),24px)] p-6 text-sm shadow-xl ring-1 duration-100 sm:max-w-md fixed top-[calc(50%+(env(safe-area-inset-top)-env(safe-area-inset-bottom))/2)] left-1/2 z-50 w-full -translate-x-1/2 -translate-y-1/2 outline-none',
      className
    )}
    {...restProps}
  >
    {@render children?.()}
    {#if showCloseButton}
      <DialogPrimitive.Close data-slot="dialog-close">
        {#snippet child({ props })}
          <CloseButton {...props} class="absolute top-4 end-4" />
        {/snippet}
      </DialogPrimitive.Close>
    {/if}
  </DialogPrimitive.Content>
</DialogPortal>
