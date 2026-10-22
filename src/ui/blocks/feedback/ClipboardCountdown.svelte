<script lang="ts">
import { onMount } from 'svelte';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import {
  type ClipboardPurgeRecord,
  verifyClipboardPurgeInFocusedDocument,
} from '@/utils/clipboard/clipboard.js';
import { logError } from '@/utils/logger.js';
import { formatCompactDuration } from '@/utils/time/time-format.js';

let queue = $state<ClipboardPurgeRecord[]>([]);
let now = $state(Date.now());
const latest = $derived(
  [...queue].sort((a, b) => (b.copiedAt ?? b.purgeAt) - (a.copiedAt ?? a.purgeAt))[0]
);
const waiting = $derived(!!latest && (latest.purgeAt <= now || (latest.attempts ?? 0) > 0));

function update(value: unknown) {
  queue = Array.isArray(value)
    ? value.filter(
        (item): item is ClipboardPurgeRecord =>
          !!item && typeof item.hash === 'string' && Number.isFinite(item.purgeAt)
      )
    : [];
  now = Date.now();
}

onMount(() => {
  let disposed = false;
  let changed = false;
  const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && changes.clipboardPurgeQueue) {
      changed = true;
      update(changes.clipboardPurgeQueue.newValue);
    }
  };
  browser.storage.onChanged.addListener(onChanged);
  const verify = () => {
    void verifyClipboardPurgeInFocusedDocument().catch((error) =>
      logError('Failed to reconcile clipboard purge', error)
    );
  };
  window.addEventListener('focus', verify);
  document.addEventListener('visibilitychange', verify);
  verify();
  void browser.storage.local
    .get(['clipboardPurgeQueue'])
    .then((stored) => {
      if (!disposed && !changed) update(stored.clipboardPurgeQueue);
    })
    .catch((error) => logError('Failed to read clipboard countdown', error));
  return () => {
    disposed = true;
    browser.storage.onChanged.removeListener(onChanged);
    window.removeEventListener('focus', verify);
    document.removeEventListener('visibilitychange', verify);
  };
});

$effect(() => {
  if (waiting)
    void verifyClipboardPurgeInFocusedDocument().catch((error) =>
      logError('Failed to verify due clipboard clear', error)
    );
});

$effect(() => {
  if (!latest || waiting) return;
  const timer = setInterval(() => {
    now = Date.now();
  }, 1000);
  return () => clearInterval(timer);
});
</script>

{#if latest}
  <div class="px-3 py-2 bg-md-surface-container-high text-xs text-md-on-surface-variant border-b border-md-outline-variant" data-clipboard-countdown>
    <!-- A schedule is not proof of erasure. Unverified wipes stay visible. -->
    {#if waiting}
      <span role="status">{$t('clipboardControls.waiting')}</span>
    {:else}
      <span role="timer" aria-live="off">{$t('clipboardControls.countdown', { values: { time: formatCompactDuration(Math.ceil((latest.purgeAt - now) / 1000) * 1000) } })}</span>
    {/if}
  </div>
{/if}
