<script lang="ts">
import IconDownload from '@/components/icons/IconDownload.svelte';
import IconRefresh from '@/components/icons/IconRefresh.svelte';
import type { Account, Email } from '@/utils/types.js';

let {
  currentEmailDetail = null,
  emails = [],
  loading = false,
  onOpenMessageDetail = () => {},
  onRefreshMessages = () => {},
  onExportEmail = () => {},
} = $props<{
  onBack?: () => void;
  currentEmailDetail?: Account | null;
  emails?: Email[];
  loading?: boolean;
  onOpenMessageDetail?: (mail: Email) => void;
  onRefreshMessages?: () => void;
  onExportEmail?: () => void;
}>();
</script>

<div class="flex items-center justify-end gap-2 px-4 py-2 border-b border-md-outline-variant">
  <button class="w-8 h-8 flex items-center justify-center rounded-lg bg-transparent hover:bg-md-surface-variant transition-colors" title="Refresh Messages" aria-label="Refresh messages" onclick={onRefreshMessages}>
    <IconRefresh class="w-4 h-4 text-md-on-surface/60" />
  </button>
  <button class="w-8 h-8 flex items-center justify-center rounded-lg bg-transparent hover:bg-md-surface-variant transition-colors" title="Export Emails" aria-label="Export emails" onclick={onExportEmail}>
    <IconDownload class="w-4 h-4 text-md-on-surface/60" />
  </button>
</div>
{#if currentEmailDetail}
  <div class="flex-1 px-4 py-3 space-y-3 overflow-y-auto" style="scrollbar-width: thin; scrollbar-color: var(--md-primary) transparent;">
    <div class="font-mono text-sm font-bold">{currentEmailDetail.address}</div>
    <div class="text-xs text-md-on-surface/60">Provider: {currentEmailDetail.provider}</div>
    <div class="text-xs text-md-primary">Received Mails: {currentEmailDetail.received}</div>
    <div class="text-xs text-md-on-surface/60">Last Used: {currentEmailDetail.lastUsed}</div>
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
