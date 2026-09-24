<script lang="ts">
  import { Dialog as DialogPrimitive } from 'bits-ui';
  import { XIcon } from 'phosphor-svelte';
  import { Button } from '$lib/components/ui/button/index.js';
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
    onkeydowncapture={containModalTab}
    data-slot="dialog-content"
    data-modal-close={showCloseButton}
    class={cn(
      'bg-popover text-popover-foreground data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 ring-foreground/5 dark:ring-foreground/10 writing-horizontal-tb grid max-h-[calc(100dvh-2rem)] max-w-[calc(100%_-_2rem)] gap-x-3 gap-y-6 overflow-y-auto overscroll-contain rounded-[1.75rem] p-6 text-sm shadow-xl ring-1 duration-100 sm:max-w-md fixed top-1/2 left-1/2 z-50 w-full -translate-x-1/2 -translate-y-1/2 outline-none',
      className
    )}
    {...restProps}
  >
    {@render children?.()}
    {#if showCloseButton}
      <DialogPrimitive.Close data-slot="dialog-close">
        {#snippet child({ props })}
          <Button
            variant="close"
            class="size-11 rounded-full"
            size="icon"
            {...props}
          >
            <XIcon class="size-4" weight="bold" aria-hidden="true" />
            <span class="sr-only">Close</span>
          </Button>
        {/snippet}
      </DialogPrimitive.Close>
    {/if}
  </DialogPrimitive.Content>
</DialogPortal>
