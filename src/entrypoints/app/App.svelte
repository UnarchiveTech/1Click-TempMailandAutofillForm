<script lang="ts">
import { isLoading } from 'svelte-i18n';
import AppLayout from '@/ui/blocks/layout/AppLayout.svelte';
import AppLoadingSkeleton from '@/ui/components/composites/AppLoadingSkeleton.svelte';

let initialLocaleReady = $state(false);
$effect(() => {
  if (!$isLoading) initialLocaleReady = true;
});
</script>

{#if !initialLocaleReady && $isLoading}
  <AppLoadingSkeleton className="flex flex-col justify-center gap-3 h-screen p-3 bg-md-surface text-md-on-surface" />
{:else}
  <AppLayout context="app" />
{/if}

