<script lang="ts">
import { t } from 'svelte-i18n';
import Icon from '@/ui/components/icons/Icon.svelte';

let { onDismiss = () => {} }: { onDismiss?: () => void } = $props();
</script>

<!-- Occupies header chrome (not fixed overlay) so it never covers content/dialogs -->
<div
  class="shrink-0 flex items-center gap-2 px-2.5 py-2 min-h-[36px] bg-md-error text-md-on-error text-xs font-medium rounded-xl"
  role="alert"
  aria-live="assertive"
>
  <Icon name="wifiOff" class="w-4 h-4 shrink-0" />
  <span class="flex-1 min-w-0 leading-snug">{$t('offline.noConnection')}</span>
  <button
    type="button"
    class="shrink-0 w-6 h-6 flex items-center justify-center rounded-full hover:bg-white/20 active:bg-white/30 transition-colors"
    aria-label={$t('offline.dismiss')}
    onclick={onDismiss}
  >
    <Icon name="close" class="w-3.5 h-3.5" />
  </button>
</div>
