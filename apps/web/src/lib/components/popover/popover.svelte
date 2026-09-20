<script lang="ts">
  import { Popover as Primitive } from 'bits-ui';
  import { onDestroy, createEventDispatcher, tick } from 'svelte';
  import { popovers } from './popover';
  import { CLOSE_POPOVER } from '$lib/data/events';
  export let contentText = '';
  export let containerStyles = '';
  export let innerContainerStyles = '';
  export let contentStyles = 'padding: 0';
  export let eventType = 'click';
  export let fallbackPlacements = ['left', 'bottom', 'right'];
  export let placement = 'top';
  export let singlePopover = true;
  export let xOffset = 0;
  export let yOffset = 10;
  export let label = '';
  const dispatch = createEventDispatcher<{ open: void }>();
  const id = Symbol('popover');
  let isOpen = false;
  let customAnchor: HTMLElement | null = null;
  $: side = placement.split('-')[0] as 'top' | 'right' | 'bottom' | 'left';
  $: align = (placement.split('-')[1] ?? 'center') as 'start' | 'center' | 'end';
  $: if (isOpen && singlePopover && !$popovers.includes(id)) isOpen = false;
  function changed(open: boolean) {
    if (open) {
      if (singlePopover) popovers.replace(id);
      else popovers.add(id);
      void tick().then(() => dispatch('open'));
    } else popovers.remove(id);
  }
  export function toggleOpen(reference?: HTMLElement | Event) {
    if (reference instanceof HTMLElement) customAnchor = reference;
    const next = !isOpen;
    changed(next);
    isOpen = next;
  }
  function externalClose(node: HTMLElement) {
    const close = () => {
      isOpen = false;
      changed(false);
    };
    node.addEventListener(CLOSE_POPOVER, close);
    return {
      destroy() {
        node.removeEventListener(CLOSE_POPOVER, close);
      }
    };
  }
  onDestroy(() => popovers.remove(id));
</script>

<Primitive.Root bind:open={isOpen} onOpenChange={changed}>
  <div data-popover class="flex items-center" style={containerStyles}>
    {#if $$slots.icon}
      <div style={innerContainerStyles}><slot /></div>
      <Primitive.Trigger
        class="inline-flex min-h-8 items-center justify-center rounded-xl px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={label || contentText || 'More information'}
        openOnHover={eventType !== 'click'}
      >
        <slot name="icon" />
      </Primitive.Trigger>
    {:else if $$slots.default}
      <Primitive.Trigger
        class="inline-flex items-center gap-2 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={innerContainerStyles}
        openOnHover={eventType !== 'click'}><slot /></Primitive.Trigger
      >
    {/if}
  </div>
  <Primitive.Portal>
    <Primitive.Content
      {side}
      {align}
      {customAnchor}
      sideOffset={yOffset}
      alignOffset={xOffset}
      avoidCollisions={fallbackPlacements.length > 0}
      collisionPadding={8}
      data-popover
      data-ui-overlay={isOpen ? 'open' : undefined}
      class="z-[70] max-h-[75dvh] max-w-[min(32rem,90vw)] overflow-auto rounded-2xl border border-border bg-popover p-2 text-sm text-popover-foreground shadow-lg outline-none"
      style={contentStyles}
    >
      <div use:externalClose class:whitespace-pre-wrap={!!contentText}>
        {#if contentText}<p class="p-2">{contentText}</p>{:else}<slot name="content" />{/if}
      </div>
    </Primitive.Content>
  </Primitive.Portal>
</Primitive.Root>
