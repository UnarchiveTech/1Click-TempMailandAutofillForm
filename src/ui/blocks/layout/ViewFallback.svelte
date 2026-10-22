<script lang="ts">
import { t } from 'svelte-i18n';
import LoadingState from './LoadingState.svelte';

let { failed = false }: { failed?: boolean } = $props();
</script>

{#if failed}
  <div
    class="flex items-center justify-center h-full p-4 text-sm text-md-error"
    role="alert"
    aria-label={$t('errors.viewLoadFailed')}
  >
    {$t('errors.viewLoadFailed')}
  </div>
{:else}
  <LoadingState />
{/if}
