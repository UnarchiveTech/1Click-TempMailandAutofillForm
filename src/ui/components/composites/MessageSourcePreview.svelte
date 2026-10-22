<script lang="ts">
import { onMount } from 'svelte';
import { t } from 'svelte-i18n';
import Btn from '@/ui/components/primitives/Btn.svelte';
import { formatFullDateTime } from '@/utils/time/time-format.js';
import type { Email } from '@/utils/types.js';

let {
  message,
  inbox,
  body,
  onBack,
}: {
  message: Email;
  inbox: string;
  body: string;
  onBack: () => void;
} = $props();
let root: HTMLDivElement;
onMount(() => {
  root.focus({ preventScroll: true });
  const keydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onBack();
  };
  root.addEventListener('keydown', keydown);
  return () => root.removeEventListener('keydown', keydown);
});
</script>

<div bind:this={root} class="dialog-content-stack outline-none" tabindex="-1" role="region" aria-label={$t('attachmentLibrary.viewMessage')}>
  <div><Btn variant="ghost" icon="back" label={$t('common.backToResults')} onclick={onBack} /></div>
  <p class="ui-row-primary text-md-on-surface break-words">{message.subject || $t('addressView.noSubject')}</p>
  <p class="ui-support text-md-on-surface-variant break-words"><bdi>{message.from_name || message.from || $t('attachmentLibrary.unknownSender')}</bdi></p>
  <p class="ui-support text-md-on-surface-variant break-words"><bdi>{inbox}</bdi> · {formatFullDateTime(message.received_at)}</p>
  <p class="text-body-sm text-md-on-surface whitespace-pre-wrap break-words" data-selectable-text>{body || $t('attachmentLibrary.bodyMissing')}</p>
</div>
