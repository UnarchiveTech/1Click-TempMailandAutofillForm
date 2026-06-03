<script lang="ts">
import { browser } from 'wxt/browser';
import Icon from '@/components/icons/Icon.svelte';
import AutoRenewToggle from '@/components/ui/AutoRenewToggle.svelte';
import FaviconImage from '@/components/ui/FaviconImage.svelte';
import TagPill from '@/components/ui/TagPill.svelte';
import { loadProviderConfig } from '@/utils/email-service.js';
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
  onNavigateToMailbox = () => {},
  onArchiveAccount = () => {},
  onRemoveAccount = () => {},
  onToggleAutoExtend = () => {},
  onMarkAllRead = () => {},
  onMarkAllUnread = () => {},
  onOpenTagDialog = () => {},
} = $props<{
  onBack?: () => void;
  currentEmailDetail?: Account | null;
  emails?: Email[];
  savedLogins?: CredentialsHistoryItem[];
  loading?: boolean;
  onOpenMessageDetail?: (mail: Email) => void;
  onRefreshMessages?: () => void;
  onExportEmail?: () => void;
  onNavigateToMailbox?: () => void;
  onArchiveAccount?: (account: Account) => void;
  onRemoveAccount?: (address: string) => void;
  onToggleAutoExtend?: (account: Account) => void;
  onMarkAllRead?: () => void;
  onMarkAllUnread?: () => void;
  onOpenTagDialog?: () => void;
}>();

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
  const s = Math.floor(msPast / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s <= 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
});

const unreadCount = $derived(emails.filter((e: Email) => e.unread).length);

const autofillLogins = $derived(
  currentEmailDetail
    ? savedLogins.filter((l: CredentialsHistoryItem) => l.email === currentEmailDetail.address)
    : []
);
const autofillCount = $derived(autofillLogins.length);

const otpCount = $derived(emails.filter((e: Email) => !!e.otp).length);

const autoRenewalCount = $derived(
  (currentEmailDetail as Account & { renewalCount?: number })?.renewalCount ?? 0
);

const supportsAutoRenew = $derived.by(() => {
  if (!currentEmailDetail?.provider) return false;
  try {
    const config = loadProviderConfig(currentEmailDetail.provider);
    return config.expiry?.renewable || false;
  } catch {
    return false;
  }
});

// Avatar stack senders (unique, up to 5)
const avatarSenders = $derived.by(() => {
  const seen = new Set<string>();
  const result: { from: string; from_name: string }[] = [];
  for (const e of emails) {
    const key = e.from || '';
    if (key && !seen.has(key)) {
      seen.add(key);
      result.push({ from: e.from || '', from_name: e.from_name || '' });
      if (result.length >= 5) break;
    }
  }
  return result;
});

const AVATAR_COLORS = [
  'bg-teal-600',
  'bg-emerald-700',
  'bg-pink-600',
  'bg-indigo-600',
  'bg-violet-600',
];
function avatarColor(email: string): string {
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) & 0xffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function avatarLetter(sender: { from: string; from_name: string }): string {
  return (sender.from_name || sender.from || '?')[0].toUpperCase();
}

// Copy email address
let copied = $state(false);
async function copyEmail() {
  if (!currentEmailDetail) return;
  try {
    await navigator.clipboard.writeText(currentEmailDetail.address);
    copied = true;
    setTimeout(() => {
      copied = false;
    }, 1500);
  } catch {
    /* ignore */
  }
}

// Autofill favicon domains (unique, up to 8)
const autofillDomains = $derived.by(() => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const l of autofillLogins) {
    const domain = l.domain || '';
    if (domain && !seen.has(domain)) {
      seen.add(domain);
      result.push(domain);
    }
  }
  return result.slice(0, 8);
});
</script>

<!-- Top action bar -->
<div class="flex items-center justify-between gap-1 px-3 py-2 border-b border-md-outline-variant">
  <div class="flex items-center gap-1">
    <!-- Mark all read -->
    <button
      class="w-7 h-7 flex items-center justify-center rounded-lg bg-transparent hover:bg-md-surface-variant transition-colors"
      title="Mark all as read"
      aria-label="Mark all emails as read"
      onclick={onMarkAllRead}
    >
      <Icon name="mail" class="w-3.5 h-3.5 text-md-on-surface/60" />
    </button>
    <!-- Mark all unread -->
    <button
      class="w-7 h-7 flex items-center justify-center rounded-lg bg-transparent hover:bg-md-surface-variant transition-colors"
      title="Mark all as unread"
      aria-label="Mark all emails as unread"
      onclick={onMarkAllUnread}
    >
      <Icon name="mail" class="w-3.5 h-3.5 text-md-primary" />
    </button>
  </div>
  <div class="flex items-center gap-1">
    <!-- Archive -->
    {#if currentEmailDetail}
      <button
        class="w-7 h-7 flex items-center justify-center rounded-lg bg-transparent hover:bg-md-surface-variant transition-colors"
        title="Archive mailbox"
        aria-label="Archive mailbox"
        onclick={() => { if (currentEmailDetail) onArchiveAccount(currentEmailDetail); }}
      >
        <Icon name="archive" class="w-3.5 h-3.5 text-md-on-surface/60" />
      </button>
      <!-- Delete -->
      <button
        class="w-7 h-7 flex items-center justify-center rounded-lg bg-transparent hover:bg-md-error/20 transition-colors"
        title="Delete mailbox"
        aria-label="Delete mailbox"
        onclick={() => { if (currentEmailDetail) onRemoveAccount(currentEmailDetail.address); }}
      >
        <Icon name="trash" class="w-3.5 h-3.5 text-md-error/70" />
      </button>
    {/if}
    <!-- Refresh -->
    <button
      class="w-7 h-7 flex items-center justify-center rounded-lg bg-transparent hover:bg-md-surface-variant transition-colors"
      title="Refresh Messages"
      aria-label="Refresh messages"
      onclick={onRefreshMessages}
    >
      <Icon name="refresh" class="w-3.5 h-3.5 text-md-on-surface/60" />
    </button>
    <!-- Export -->
    <button
      class="w-7 h-7 flex items-center justify-center rounded-lg bg-transparent hover:bg-md-surface-variant transition-colors"
      title="Export Emails"
      aria-label="Export emails"
      onclick={onExportEmail}
    >
      <Icon name="download" class="w-3.5 h-3.5 text-md-on-surface/60" />
    </button>
  </div>
</div>

{#if currentEmailDetail}
  <div class="flex-1 px-4 py-3 space-y-3 overflow-y-auto">

    <!-- Email address + Copy button -->
    <div class="flex items-center gap-2">
      <span class="font-mono text-sm font-bold flex-1 min-w-0 truncate">{currentEmailDetail.address}</span>
      <button
        class="flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium transition-colors {copied ? 'bg-md-primary/20 text-md-primary' : 'bg-md-surface-variant hover:bg-md-secondary-container text-md-on-surface/70'}"
        onclick={copyEmail}
        aria-label="Copy email address"
      >
        <Icon name="copy" class="w-3 h-3" />
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>

    <!-- Provider row: favicon + name -->
    <div class="flex items-center gap-2">
      <div class="w-5 h-5 rounded flex items-center justify-center overflow-hidden bg-md-surface-container-low flex-shrink-0">
        <FaviconImage
          domain={currentEmailDetail.provider}
          size={20}
          class="w-4 h-4 object-contain"
          fallbackLetter={currentEmailDetail.provider[0]?.toUpperCase() ?? 'P'}
          fallbackColor="bg-md-secondary-container"
        />
      </div>
      <span class="text-xs text-md-on-surface/60 capitalize">{currentEmailDetail.provider}</span>
    </div>

    <!-- Tag row -->
    <div class="flex items-center gap-2">
      <TagPill
        tag={currentEmailDetail.tag}
        tagColor={currentEmailDetail.tagColor}
        onClick={onOpenTagDialog}
        showIcon={true}
      />
    </div>

    <!-- Auto Renew toggle -->
    {#if supportsAutoRenew && currentEmailDetail.expiresAt}
      <div class="flex items-center gap-2">
        <AutoRenewToggle
          autoRenew={currentEmailDetail.autoExtend || false}
          onToggle={() => { if (currentEmailDetail) onToggleAutoExtend(currentEmailDetail); }}
        />
      </div>
    {/if}

    <!-- Received Mails + avatar stack -->
    <div class="space-y-1.5">
      <div class="text-xs text-md-primary font-medium">
        Received Mails: {currentEmailDetail.received ?? emails.length}{unreadCount > 0 ? ` (${unreadCount} unread)` : ''}
      </div>
      <!-- Avatar stack -->
      {#if avatarSenders.length > 0}
        <div class="flex items-center gap-1.5">
          <div class="flex -space-x-2">
            {#each avatarSenders as sender, i}
              <div
                class="w-6 h-6 rounded-full border-2 border-md-surface flex items-center justify-center text-[9px] font-bold text-white {avatarColor(sender.from)} flex-shrink-0"
                title={sender.from_name || sender.from}
                style="z-index: {avatarSenders.length - i};"
              >
                {avatarLetter(sender)}
              </div>
            {/each}
          </div>
          {#if emails.length > 0}
            <span class="text-[10px] text-md-on-surface/50">{emails.length > 1 ? `${emails.length} senders` : '1 sender'}</span>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Stats row: auto-renewals + OTPs -->
    <div class="flex items-center gap-3">
      <div class="flex items-center gap-1 text-xs text-md-on-surface/60">
        <Icon name="refresh" class="w-3 h-3 text-md-primary/60" />
        <span>{autoRenewalCount} auto-renewal{autoRenewalCount !== 1 ? 's' : ''}</span>
      </div>
      <div class="flex items-center gap-1 text-xs text-md-on-surface/60">
        <Icon name="lock" class="w-3 h-3 text-md-primary/60" />
        <span>{otpCount} OTP{otpCount !== 1 ? 's' : ''} received</span>
      </div>
    </div>

    <!-- Used in Autofill row -->
    <div class="space-y-1.5">
      <div class="text-xs text-md-on-surface/60">Used in Autofill ({autofillCount})</div>
      <!-- Favicon stack of autofill sites -->
      {#if autofillDomains.length > 0}
        <div class="flex flex-wrap gap-1.5">
          {#each autofillDomains as domain}
            <div
              class="w-6 h-6 rounded-md bg-md-surface-container-low flex items-center justify-center overflow-hidden border border-md-outline-variant/30"
              title={domain}
            >
              <FaviconImage
                {domain}
                size={20}
                class="w-4 h-4 object-contain"
                fallbackLetter={domain[0]?.toUpperCase() ?? '?'}
                fallbackColor="bg-md-secondary-container"
              />
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="text-xs text-md-on-surface/60">Created {createdAgo}</div>

    <!-- View Mailbox button -->
    <div class="pt-2">
      <button
        class="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-md-primary/10 hover:bg-md-primary/20 text-md-primary text-sm font-medium transition-colors"
        onclick={onNavigateToMailbox}
        aria-label="View emails in mailbox"
      >
        <Icon name="mail" class="w-4 h-4" />
        View Emails in Mailbox
      </button>
    </div>

  </div>
{/if}
