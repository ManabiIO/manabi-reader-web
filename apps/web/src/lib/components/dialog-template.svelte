<section class="ui-panel min-w-0 rounded-3xl bg-popover p-5 text-popover-foreground sm:p-6">
  {#if $$slots.header}<h2 class="mb-5 text-lg font-semibold"><slot name="header" /></h2>{/if}
  <slot name="content" />
  <footer class="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
    <slot name="footer" />
  </footer>
</section>
