<script lang="ts">
  export let selected: boolean;
  export let disabled: boolean;
  export let d: string;
  export let viewBox: string;
  export let label: string;
</script>

<button
  type="button"
  class="flex min-h-24 min-w-0 flex-col items-center justify-center rounded-2xl border bg-background px-3 py-4 text-center transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-40"
  class:border-primary={selected}
  class:border-border={!selected}
  aria-pressed={selected}
  {disabled}
  on:click
>
  <svg
    class="size-10 shrink-0 md:size-12 lg:size-14"
    xmlns="http://www.w3.org/2000/svg"
    {viewBox}
    aria-hidden="true"
  >
    <path class="fill-current" {d}></path>
  </svg>
  <span class="mt-2 break-words text-sm font-medium">{label}</span>
</button>
