<script lang="ts">
import Icon from '@/components/icons/Icon.svelte';

let { onDismiss = () => {} }: { onDismiss?: () => void } = $props();
</script>

<!-- Occupies header chrome (not fixed overlay) so it never covers content/dialogs -->
<div
  class="shrink-0 flex items-center gap-2 px-2.5 py-2 min-h-[36px] bg-md-error text-md-on-error text-xs font-medium rounded-xl"
  role="alert"
  aria-live="assertive"
>
  <Icon name="wifiOff" class="w-4 h-4 shrink-0" />
  <span class="flex-1 min-w-0 leading-snug">No internet connection. Some features may not work.</span>
  <button
    type="button"
    class="shrink-0 w-6 h-6 flex items-center justify-center rounded-full hover:bg-white/20 transition-colors"
    aria-label="Dismiss offline notice"
    onclick={onDismiss}
  >
    <Icon name="x" class="w-3.5 h-3.5" />
  </button>
</div>
