<script lang="ts">
import { t } from 'svelte-i18n';

let { class: className = '' }: { class?: string } = $props();
</script>

<div class="flex items-center justify-center h-full {className}" aria-busy="true" aria-label={$t('common.loading')}>
  <div class="text-sm text-md-on-surface/50">{$t('common.loading')}</div>
</div>
