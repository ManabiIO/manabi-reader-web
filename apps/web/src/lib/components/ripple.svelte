<script lang="ts">
  // Legacy call sites keep the same decoration hook, but Rhea feedback is CSS-only.
  // In particular, focusout during modal removal must not write reactive state.
  function feedback(node: HTMLElement) {
    const parent = node.parentElement;
    if (!parent) return;
    const added = ['relative', 'overflow-hidden', 'rhea-interactive'].filter(
      (name) => !parent.classList.contains(name)
    );
    parent.classList.add(...added);
    return {
      destroy() {
        parent.classList.remove(...added);
      }
    };
  }
</script>

<span use:feedback class="rhea-feedback pointer-events-none absolute inset-0" aria-hidden="true"
></span>

<style>
  .rhea-feedback {
    background: currentColor;
    border-radius: inherit;
    opacity: 0;
    transition: opacity 100ms ease;
  }
  :global(.rhea-interactive:not(:disabled):hover) > .rhea-feedback {
    opacity: 0.05;
  }
  :global(.rhea-interactive:not(:disabled):active) > .rhea-feedback {
    opacity: 0.1;
  }
  :global(.rhea-interactive:focus-visible) {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    .rhea-feedback {
      transition: none;
    }
  }
</style>
