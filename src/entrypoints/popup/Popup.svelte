<script lang="ts">
import { isLoading } from 'svelte-i18n';
import AppLayout from '@/ui/blocks/layout/AppLayout.svelte';
import AppLoadingSkeleton from '@/ui/components/composites/AppLoadingSkeleton.svelte';

// Only the initial dictionary load blocks mounting. Later language changes
// must preserve navigation, open dialogs and unsaved input in AppLayout.
let initialLocaleReady = $state(false);
$effect(() => {
  if (!$isLoading) initialLocaleReady = true;
});
</script>

{#if !initialLocaleReady && $isLoading}
  <AppLoadingSkeleton
    className="w-[360px] h-[600px] flex flex-col justify-center gap-3 p-3 bg-md-surface text-md-on-surface overflow-hidden"
  />
{:else}
  <div class="w-[360px] max-w-[360px] h-[600px] max-h-[600px] overflow-hidden flex flex-col box-border">
    <AppLayout context="popup" />
  </div>
{/if}
