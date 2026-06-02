<script lang="ts">
import Icon from '@/components/icons/Icon.svelte';
import { useCurrentTime } from '@/utils/time-store.js';
import type { Account, CredentialsHistoryItem, Email } from '@/utils/types.js';

let {
  currentEmailDetail = null,
  emails = [],
  savedLogins = [],
  loading = false,
  onOpenMessageDetail = () => {},
  onRefreshMessages = () => {},
  onExportEmail = () => {},
} = $props<{
  onBack?: () => void;
  currentEmailDetail?: Account | null;
  emails?: Email[];
  savedLogins?: CredentialsHistoryItem[];
  loading?: boolean;
  onOpenMessageDetail?: (mail: Email) => void;
  onRefreshMessages?: () => void;
  onExportEmail?: () => void;
}>();

// Live time — re-evaluates every second via the shared time store
// (same pattern as AccountSelector). Without this, the template's
// `timeAgo()` is a pure function call that Svelte won't re-run on
// wall-clock advance, so "Created X ago" appears frozen.
const timeStore = useCurrentTime();
let currentTime = $state(timeStore.currentTime);

$effect(() => {
  const unsubscribe = timeStore.subscribe(() => {
    currentTime = timeStore.currentTime;
  });
  return unsubscribe;
});

const createdAgo = $derived.by(() => {
  const createdAt = currentEmailDetail?.createdAt;
  if (!createdAt) return '';
  const msPast = currentTime - createdAt;
  if (msPast < 0) return 'just now';
  const secondsPast = Math.floor(msPast / 1000);
  if (secondsPast < 60) return `${secondsPast}s ago`;
  if (secondsPast < 3600) return `${Math.floor(secondsPast / 60)}m ago`;
  if (secondsPast <= 86400) return `${Math.floor(secondsPast / 3600)}h ago`;
  return `${Math.floor(secondsPast / 86400)}d ago`;
});

const unreadCount = $derived(emails.filter((e: Email) => e.unread).length);

const autofillCount = $derived(
  currentEmailDetail
    ? savedLogins.filter((l: CredentialsHistoryItem) => l.email === currentEmailDetail.address)
        .length
    : 0
);
</script>

<div class="flex items-center justify-end gap-2 px-4 py-2 border-b border-md-outline-variant">
  <button class="w-8 h-8 flex items-center justify-center rounded-lg bg-transparent hover:bg-md-surface-variant transition-colors" title="Refresh Messages" aria-label="Refresh messages" onclick={onRefreshMessages}>
    <Icon name="refresh" class="w-4 h-4 text-md-on-surface/60" />
  </button>
  <button class="w-8 h-8 flex items-center justify-center rounded-lg bg-transparent hover:bg-md-surface-variant transition-colors" title="Export Emails" aria-label="Export emails" onclick={onExportEmail}>
    <Icon name="download" class="w-4 h-4 text-md-on-surface/60" />
  </button>
</div>
{#if currentEmailDetail}
  <div class="flex-1 px-4 py-3 space-y-3 overflow-y-auto">
    <div class="font-mono text-sm font-bold">{currentEmailDetail.address}</div>
    <div class="text-xs text-md-on-surface/60">Provider: {currentEmailDetail.provider}</div>
    <div class="text-xs text-md-primary">
      Received Mails: {currentEmailDetail.received ?? 0}{unreadCount > 0 ? ` (${unreadCount} unread)` : ''}
    </div>
    <div class="text-xs text-md-on-surface/60">Used For Autofill ({autofillCount})</div>
    <div class="text-xs text-md-on-surface/60">Created {createdAgo}</div>
    <div class="pt-3 border-t border-md-outline-variant">
      <div class="text-xs text-md-on-surface/50 mb-2">Messages</div>
      {#if loading}
        <div class="text-center py-4 text-sm text-md-on-surface/50">Loading...</div>
      {:else if emails.length === 0}
        <div class="text-center py-4 text-sm text-md-on-surface/50">No messages yet</div>
      {:else}
        {#each emails as mail}
          <button class="w-full text-left py-2 border-b border-md-outline-variant hover:bg-md-surface-variant rounded-lg bg-transparent border-0 px-1" onclick={() => onOpenMessageDetail(mail)}>
            <div class="flex justify-between text-xs text-md-on-surface/60">
              <span class="font-medium">{mail.from}</span>
              <span>{mail.time}</span>
            </div>
            <div class="text-sm font-semibold mt-0.5">{mail.subject}</div>
            {#if mail.isOtp}
              <span class="px-2 py-0.5 text-xs rounded-full bg-md-primary/20 text-md-primary mt-1">OTP: {mail.otp}</span>
            {/if}
          </button>
        {/each}
      {/if}
    </div>
  </div>
{/if}
