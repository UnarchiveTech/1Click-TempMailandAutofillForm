<script lang="ts">
import Icon from '@/components/icons/Icon.svelte';

let { onDismiss = () => {} }: { onDismiss?: () => void } = $props();
</script>

<div
  class="fixed top-0 left-0 right-0 z-[2000] flex items-center justify-between gap-2 px-3 py-2 bg-md-error text-md-on-error text-xs font-medium shadow-lg"
  role="alert"
  aria-live="assertive"
>
  <div class="flex items-center gap-2">
    <Icon name="wifiOff" class="w-4 h-4 flex-shrink-0" />
    <span>No internet connection. Some features may not work.</span>
  </div>
  <button
    class="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full hover:bg-white/20 transition-colors"
    aria-label="Dismiss offline notice"
    onclick={onDismiss}
  >
    <Icon name="x" class="w-3.5 h-3.5" />
  </button>
</div>
