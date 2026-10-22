<script lang="ts">
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import Badge from '@/ui/components/primitives/Badge.svelte';
import { findUnsubscribeLink } from '@/utils/email/unsubscribe-link.js';
import { logError } from '@/utils/logger.js';
import type { Email } from '@/utils/types.js';
import { toastStore } from '@/utils/ui/toastStore.js';

let { email }: { email: Email } = $props();
const destination = $derived(findUnsubscribeLink(email));
async function open(event: MouseEvent) {
  event.stopPropagation();
  if (!destination) return;
  try {
    await browser.tabs.create({ url: destination });
  } catch (error) {
    logError('Failed to open sender unsubscribe action', error);
    toastStore.error($t('toasts.operationFailed'));
  }
}
</script>

{#if destination}
  <button type="button" class="inline-flex rounded-full md-action" data-unsubscribe-badge title={$t('inbox.unsubscribeHint', { values: { destination } })} onclick={open}>
    <Badge variant="neutral" size="sm" icon="mail" label={$t('inbox.unsubscribe')} />
  </button>
{/if}
