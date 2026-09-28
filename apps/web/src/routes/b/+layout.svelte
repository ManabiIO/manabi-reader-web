<script lang="ts">
  import { page } from '$app/stores';
</script>

<!-- The reader page owns async loading, location state and a mounted publication.
     Reuse it for view/search changes within one book, never across book IDs. -->
{#key Number($page.url.searchParams.get('id'))}
  <slot />
{/key}
