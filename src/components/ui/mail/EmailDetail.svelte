<script lang="ts">
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import Icon from '@/components/icons/Icon.svelte';
import AutoRenewToggle from '@/components/ui/AutoRenewToggle.svelte';
import FaviconImage from '@/components/ui/FaviconImage.svelte';
import TagPill from '@/components/ui/TagPill.svelte';
import { avatarColor } from '@/utils/avatar-color.js';
import { loadProviderConfig } from '@/utils/email-service.js';
import { getMailboxReadState } from '@/utils/mailbox-read-state.js';
import { getDomainAvatarStack } from '@/utils/sender-avatars.js';
import { timeAgo } from '@/utils/time.js';
import { useCurrentTime } from '@/utils/time-store.js';
import type { Account, CredentialsHistoryItem, Email, Identity } from '@/utils/types.js';

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
  onUnarchiveAccount = () => {},
  onRemoveAccount = () => {},
  onToggleAutoExtend = () => {},
  onMarkAllRead = () => {},
  onMarkAllUnread = () => {},
  onOpenTagDialog = () => {},
  onOpenSavedLogins = (_email: string) => {},
  onOpenIdentities = (_email: string) => {},
  onAddressDomainChanged = (_address: string) => {},
  showToast = (_msg: string, _type?: string, _undo?: (() => void | Promise<void>) | null) => {},
  /** When true (split view), toolbar buttons show icon + text label */
  showToolbarLabels = false,
} = $props<{
  onBack?: () => void;
  currentEmailDetail?: Account | null;
  emails?: Email[];
  savedLogins?: CredentialsHistoryItem[];
  loading?: boolean;
  onOpenMessageDetail?: (thread: Email[]) => void;
  onRefreshMessages?: () => void;
  onExportEmail?: () => void;
  onNavigateToMailbox?: () => void;
  onArchiveAccount?: (account: Account) => void;
  onUnarchiveAccount?: (account: Account) => void;
  onRemoveAccount?: (address: string) => void;
  onToggleAutoExtend?: (account: Account) => void;
  onMarkAllRead?: () => void;
  onMarkAllUnread?: () => void;
  onOpenTagDialog?: () => void;
  onOpenSavedLogins?: (email: string) => void;
  onOpenIdentities?: (email: string) => void;
  onAddressDomainChanged?: (address: string) => void;
  showToast?: (message: string, type?: string, undo?: (() => void | Promise<void>) | null) => void;
  showToolbarLabels?: boolean;
}>();

const detailToolbarClass = $derived(
  showToolbarLabels
    ? 'inline-flex items-center gap-1.5 h-9 px-2.5 shrink-0 rounded-full border-0 bg-transparent transition-colors text-xs font-semibold whitespace-nowrap'
    : 'w-9 h-9 shrink-0 flex items-center justify-center rounded-full border-0 bg-transparent transition-colors'
);

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
const mailboxReadState = $derived(getMailboxReadState(emails));

const autofillLogins = $derived(
  currentEmailDetail
    ? savedLogins.filter(
        (l: CredentialsHistoryItem) =>
          (l.email || '').toLowerCase() === (currentEmailDetail.address || '').toLowerCase()
      )
    : []
);
const autofillCount = $derived(autofillLogins.length);
const autofillDomains = $derived(
  [
    ...new Set(
      autofillLogins
        .map((l: CredentialsHistoryItem) => (l.domain || '').toLowerCase().replace(/^www\./, ''))
        .filter((d: string): d is string => !!d)
    ),
  ].slice(0, 8) as string[]
);

let usageExpanded = $state(false);
let usageSites = $state<
  Array<{
    domain: string;
    lastUsedAt: number;
    loginCount: number;
    inSiteMemory: boolean;
  }>
>([]);

$effect(() => {
  const addr = currentEmailDetail?.address;
  const logins = savedLogins;
  if (!addr) {
    usageSites = [];
    return;
  }
  void import('@/features/intelligence/address-usage.js')
    .then(({ getAddressUsageMap }) => getAddressUsageMap(addr, logins))
    .then((map) => {
      usageSites = map.sites;
    })
    .catch(() => {
      usageSites = autofillDomains.map((domain) => ({
        domain,
        lastUsedAt: 0,
        loginCount: 1,
        inSiteMemory: false,
      }));
    });
});

const otpCount = $derived(emails.filter((e: Email) => !!e.otp).length);
/** Prefer live email list length over stale `received` field */
const receivedMailCount = $derived(emails.length || currentEmailDetail?.received || 0);

const autoRenewalCount = $derived(
  (currentEmailDetail as Account & { renewalCount?: number })?.renewalCount ?? 0
);

const supportsAutoRenew = $derived.by(() => {
  if (!currentEmailDetail?.provider) return false;
  try {
    const config = loadProviderConfig(currentEmailDetail.provider);
    return !!(config.capabilities?.supportsRenew ?? config.expiry?.renewable);
  } catch {
    return false;
  }
});

const isArchivedDetail = $derived(
  currentEmailDetail?.accountStatus === 'archived' || currentEmailDetail?.status === 'archived'
);

const providerLabel = $derived.by(() => {
  if (!currentEmailDetail?.provider) return '';
  try {
    const config = loadProviderConfig(currentEmailDetail.provider);
    const name = config.displayName || currentEmailDetail.provider;
    const url = currentEmailDetail.instanceUrl || '';
    if (url) {
      try {
        const host = new URL(url).hostname;
        return host ? `${name} (${host})` : name;
      } catch {
        return `${name} (${url})`;
      }
    }
    return name;
  } catch {
    return currentEmailDetail.provider;
  }
});

const providerFaviconDomain = $derived.by(() => {
  if (currentEmailDetail?.instanceUrl) {
    try {
      return new URL(currentEmailDetail.instanceUrl).hostname;
    } catch {
      /* fall through */
    }
  }
  try {
    const config = loadProviderConfig(currentEmailDetail?.provider || '');
    const site =
      (config as { website?: string; domain?: string }).website ||
      (config as { website?: string; domain?: string }).domain;
    if (site) {
      try {
        return new URL(site.startsWith('http') ? site : `https://${site}`).hostname;
      } catch {
        return site;
      }
    }
  } catch {
    /* ignore */
  }
  return currentEmailDetail?.provider || '';
});

let defaultIdentityUsesThis = $state(false);
$effect(() => {
  const addr = currentEmailDetail?.address;
  if (!addr) {
    defaultIdentityUsesThis = false;
    return;
  }
  void browser.storage.local.get(['identities']).then((r) => {
    const identities = (r.identities || []) as Identity[];
    const def = identities.find((i) => i.isDefault) || identities[0];
    defaultIdentityUsesThis = !!(
      def?.preferredEmail && def.preferredEmail.toLowerCase() === addr.toLowerCase()
    );
  });
});

const multiDomainList = $derived.by(() => {
  if (!currentEmailDetail?.provider) return [] as string[];
  try {
    const config = loadProviderConfig(currentEmailDetail.provider);
    if (!config.multiDomain?.enabled) return [];
    return (config.multiDomain.domains || []).filter(Boolean);
  } catch {
    return [];
  }
});

const supportsDomainChange = $derived(multiDomainList.length > 1);

async function changeAddressDomain(domain: string) {
  if (!currentEmailDetail?.address || !domain) return;
  const user = currentEmailDetail.address.split('@')[0];
  const nextAddr = `${user}@${domain}`;
  if (nextAddr === currentEmailDetail.address) return;
  try {
    const { inboxes = [] } = (await browser.storage.local.get(['inboxes'])) as {
      inboxes?: Account[];
    };
    // Match by id first; fall back to current address (import / id drift)
    const detailId = currentEmailDetail?.id;
    const detailAddr = currentEmailDetail?.address;
    let idx = detailId ? inboxes.findIndex((i) => i.id === detailId) : -1;
    if (idx < 0 && detailAddr) {
      const addrLower = detailAddr.toLowerCase();
      idx = inboxes.findIndex(
        (i) => i.address === detailAddr || i.address?.toLowerCase() === addrLower
      );
    }
    if (idx < 0) {
      showToast($t('emailDetail.domainChangeFailed'), 'error');
      return;
    }
    const prev = inboxes[idx].address;
    const inboxId = inboxes[idx].id;
    const prevSnapshot = { ...inboxes[idx] };
    inboxes[idx] = { ...inboxes[idx], address: nextAddr, emailUser: user };
    await browser.storage.local.set({ inboxes, activeInboxId: inboxes[idx].id });
    // Migrate mail bags if helper exists in UI via storage only
    const bags = (await browser.storage.local.get(['storedEmails', 'archivedEmails'])) as {
      storedEmails?: Record<string, Email[]>;
      archivedEmails?: Record<string, Email[]>;
    };
    const move = (map: Record<string, Email[]>) => {
      if (!map[prev]?.length) return map;
      const merged = [
        ...(map[nextAddr] || []),
        ...map[prev].map((e) => ({ ...e, original_inbox: nextAddr })),
      ];
      const next = { ...map, [nextAddr]: merged };
      delete next[prev];
      return next;
    };
    const prevStored = bags.storedEmails || {};
    const prevArchived = bags.archivedEmails || {};
    await browser.storage.local.set({
      storedEmails: move({ ...prevStored }),
      archivedEmails: move({ ...prevArchived }),
    });
    // Keep per-inbox accent color stable across domain rewrite (id-keyed)
    try {
      const { inboxColors = {} } = (await browser.storage.local.get(['inboxColors'])) as {
        inboxColors?: Record<string, string>;
      };
      if (inboxId && (inboxColors[inboxId] || inboxColors[prev])) {
        const color = inboxColors[inboxId] || inboxColors[prev];
        const nextColors = { ...inboxColors, [inboxId]: color };
        delete nextColors[prev];
        await browser.storage.local.set({ inboxColors: nextColors });
      }
    } catch {
      /* ignore */
    }
    onAddressDomainChanged(nextAddr);
    const msg = $t('emailDetail.domainChanged', { values: { from: prev, to: nextAddr } });
    showToast(
      typeof msg === 'string' ? msg : `Domain updated from ${prev} to ${nextAddr}.`,
      'success',
      async () => {
        // Undo domain change
        try {
          const { inboxes: list = [] } = (await browser.storage.local.get(['inboxes'])) as {
            inboxes?: Account[];
          };
          const i = list.findIndex((x) => x.id === inboxId);
          if (i >= 0) {
            list[i] = { ...list[i], address: prev, emailUser: prevSnapshot.emailUser };
            await browser.storage.local.set({ inboxes: list, activeInboxId: inboxId });
          }
          await browser.storage.local.set({
            storedEmails: prevStored,
            archivedEmails: prevArchived,
          });
          onAddressDomainChanged(prev);
        } catch {
          /* ignore */
        }
      }
    );
  } catch {
    showToast($t('emailDetail.domainChangeFailed'), 'error');
  }
}

// Avatar stack senders (unique, up to 5)
/** Domain-ranked favicon stack (same logic as Addresses page) */
const domainAvatarStack = $derived(getDomainAvatarStack(emails, 4));

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

/** 2–3 most recent emails for the preview list before “View in mailbox”. */
const recentEmails = $derived(
  [...emails].sort((a, b) => (b.received_at || 0) - (a.received_at || 0)).slice(0, 3)
);
</script>

<div class="relative flex flex-col h-full min-h-0">
{#if currentEmailDetail}
  <div class="flex-1 px-0 py-3 space-y-3 overflow-y-auto pb-16">

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

    <!-- Tag row -->
    <div class="flex items-center gap-2">
      <TagPill
        tag={currentEmailDetail.tag}
        tagColor={currentEmailDetail.tagColor}
        onClick={onOpenTagDialog}
        showIcon={true}
      />
    </div>

    <!-- Single stats container -->
    <div class="rounded-xl border border-md-outline-variant/30 bg-md-surface-container-low/60 p-3 space-y-2">
      <!-- Provider (+ instance) with favicon -->
      <div class="flex items-center gap-2 min-w-0">
        <div class="w-5 h-5 rounded flex items-center justify-center overflow-hidden bg-md-surface flex-shrink-0">
          <FaviconImage
            domain={providerFaviconDomain}
            size={20}
            class="w-4 h-4 object-contain"
            fallbackLetter={providerLabel[0]?.toUpperCase() ?? 'P'}
            fallbackColor="bg-md-secondary-container"
          />
        </div>
        <span class="text-xs text-md-on-surface font-medium truncate">{providerLabel}</span>
      </div>

      <div class="text-label-sm text-md-on-surface/60">
        {$t('emailDetail.created')} {createdAgo}
      </div>

      {#if supportsAutoRenew}
        <div class="flex items-center gap-1 text-label-sm text-md-on-surface/60">
          <Icon name="refresh" class="w-3 h-3 text-md-primary/60" />
          <span>{$t('emailDetail.autoRenewalCount', { values: { n: autoRenewalCount } })}</span>
        </div>
      {/if}

      <div class="text-label-sm text-md-on-surface/70">
        {$t('emailDetail.receivedMails', {
          values: {
            n: receivedMailCount,
            unread: unreadCount > 0 ? ` (${unreadCount})` : '',
          },
        })}
      </div>

      {#if domainAvatarStack.senders.length > 0}
        <div class="flex items-center gap-1.5">
          <div class="flex items-center">
            {#each domainAvatarStack.senders as sender, i (sender.domain)}
              <div
                class="relative w-6 h-6 rounded-full border-2 border-md-surface overflow-hidden flex items-center justify-center bg-md-surface-container-low flex-shrink-0"
                style="z-index: {4 - i}; margin-inline-start: {i === 0 ? '0' : '-6px'};"
                title="{sender.domain} ({sender.count})"
              >
                <FaviconImage
                  email={sender.email}
                  domain={sender.domain}
                  size={24}
                  class="absolute inset-0 w-full h-full object-cover"
                  fallbackLetter={sender.letter}
                  fallbackColor={avatarColor(sender.domain)}
                />
              </div>
            {/each}
            {#if domainAvatarStack.remainder > 0}
              <div
                class="relative w-6 h-6 rounded-full border-2 border-md-surface bg-md-surface-variant flex items-center justify-center flex-shrink-0"
                style="z-index: 0; margin-inline-start: -6px;"
              >
                <span class="text-label-sm font-bold text-md-on-surface/60">+{domainAvatarStack.remainder}</span>
              </div>
            {/if}
          </div>
        </div>
      {/if}

      <div class="flex items-center gap-1 text-label-sm text-md-on-surface/60">
        <Icon name="lock" class="w-3 h-3 text-md-primary/60" />
        <span>{$t('emailDetail.otpCount', { values: { n: otpCount } })}</span>
      </div>

      <!-- Address usage map — sites this email was used on -->
      <div class="rounded-lg border border-md-outline-variant/20 bg-md-surface/40 p-2 space-y-1.5">
        <button
          type="button"
          class="w-full flex items-center gap-2 text-start rounded-lg px-1 py-1 hover:bg-md-primary/10 transition-colors border-0 bg-transparent"
          title={$t('emailDetail.usedInAutofillsHint')}
          onclick={(e) => {
            e.stopPropagation();
            usageExpanded = !usageExpanded;
          }}
        >
          <Icon name="lock" class="w-3.5 h-3.5 text-md-primary shrink-0" />
          <span class="text-label-sm font-semibold text-md-primary flex-1">
            {$t('emailDetail.usageMapTitle', {
              values: { n: usageSites.length || autofillCount },
            })}
          </span>
          {#if usageSites.length > 0 || autofillDomains.length > 0}
            <div class="flex -space-x-1.5">
              {#each (usageSites.length ? usageSites.map((s) => s.domain) : autofillDomains).slice(0, 4) as domain}
                <div
                  class="w-5 h-5 rounded-md bg-md-surface flex items-center justify-center overflow-hidden border border-md-outline-variant/30"
                  title={domain}
                >
                  <FaviconImage
                    {domain}
                    size={16}
                    class="w-3.5 h-3.5 object-contain"
                    fallbackLetter={domain[0]?.toUpperCase() ?? '?'}
                    fallbackColor="bg-md-secondary-container"
                  />
                </div>
              {/each}
            </div>
          {/if}
          <Icon name={usageExpanded ? 'chevronUp' : 'chevronDown'} class="w-3.5 h-3.5 text-md-on-surface/40" />
        </button>

        {#if usageExpanded && usageSites.length > 0}
          <ul class="space-y-1 max-h-40 overflow-y-auto">
            {#each usageSites as site (site.domain)}
              <li>
                <button
                  type="button"
                  class="w-full flex items-center gap-2 rounded-lg px-1.5 py-1 text-start hover:bg-md-primary/10 border-0 bg-transparent"
                  title={$t('emailDetail.openSavedLoginsForSite', { values: { domain: site.domain } })}
                  onclick={(e) => {
                    e.stopPropagation();
                    onOpenSavedLogins(currentEmailDetail.address);
                  }}
                >
                  <div
                    class="w-5 h-5 rounded-md bg-md-surface flex items-center justify-center overflow-hidden border border-md-outline-variant/30 shrink-0"
                  >
                    <FaviconImage
                      domain={site.domain}
                      size={16}
                      class="w-3.5 h-3.5 object-contain"
                      fallbackLetter={site.domain[0]?.toUpperCase() ?? '?'}
                      fallbackColor="bg-md-secondary-container"
                    />
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="text-label-sm font-medium text-md-on-surface truncate">{site.domain}</div>
                    <div class="text-xs text-md-on-surface/50">
                      {#if site.loginCount > 0}
                        {$t('emailDetail.usageLogins', { values: { n: site.loginCount } })}
                        ·
                      {/if}
                      {site.lastUsedAt ? timeAgo(site.lastUsedAt) : '—'}
                      {#if site.inSiteMemory}
                        · {$t('emailDetail.usageInMemory')}
                      {/if}
                    </div>
                  </div>
                </button>
              </li>
            {/each}
          </ul>
          <button
            type="button"
            class="w-full text-xs font-semibold text-md-primary py-1 rounded-lg hover:bg-md-primary/10 border-0 bg-transparent"
            onclick={(e) => {
              e.stopPropagation();
              onOpenSavedLogins(currentEmailDetail.address);
            }}
          >
            {$t('emailDetail.viewAllSavedLogins')}
          </button>
        {:else if usageExpanded}
          <p class="text-xs text-md-on-surface/50 px-1">{$t('emailDetail.usageMapEmpty')}</p>
        {/if}
      </div>

      {#if defaultIdentityUsesThis}
        <div class="flex items-center gap-1 text-label-sm text-md-tertiary font-medium">
          <Icon name="user" class="w-3 h-3" />
          <span>{$t('emailDetail.defaultInIdentity')}</span>
        </div>
      {/if}
    </div>

    <!-- Jump to Identities filtered by this mailbox -->
    <div class="flex items-center gap-1.5">
      <button
        type="button"
        class="flex-1 px-2 py-1.5 text-label-sm font-semibold rounded-lg bg-md-tertiary/10 text-md-tertiary hover:bg-md-tertiary/20 transition-colors flex items-center justify-center gap-1"
        title={$t('inbox.emailActions.openIdentities')}
        aria-label={$t('inbox.emailActions.openIdentities')}
        onclick={(e) => {
          e.stopPropagation();
          onOpenIdentities(currentEmailDetail.address);
        }}
      >
        <Icon name="user" class="w-3.5 h-3.5" />
        <span class="truncate">{$t('inbox.emailActions.openIdentities')}</span>
      </button>
    </div>

    {#if supportsDomainChange && currentEmailDetail}
      <div class="space-y-1">
        <div class="text-xs text-md-on-surface/60">{$t('emailDetail.changeDomain')}</div>
        <div class="flex flex-wrap gap-1.5">
          {#each multiDomainList as d (d)}
            {@const active = (currentEmailDetail.address || '').split('@')[1] === d}
            <button
              type="button"
              class="px-2 py-1 rounded-lg text-xs font-semibold border transition-colors {active
                ? 'bg-md-primary text-md-on-primary border-md-primary'
                : 'bg-md-surface-container border-md-outline-variant/40 text-md-on-surface hover:bg-md-surface-variant'}"
              style="direction: ltr;"
              disabled={active}
              onclick={() => void changeAddressDomain(d)}
            >@{d}</button>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Recent emails preview -->
    {#if recentEmails.length > 0}
      <div class="space-y-1.5 pt-1">
        <div class="text-xs font-semibold text-md-on-surface/70">{$t('emailDetail.recentEmails')}</div>
        <div class="rounded-xl border border-md-outline-variant/30 overflow-hidden divide-y divide-md-outline-variant/20">
          {#each recentEmails as mail (mail.id)}
            <button
              type="button"
              class="w-full text-start px-3 py-2 hover:bg-md-surface-variant/40 transition-colors"
              onclick={() => onOpenMessageDetail([mail])}
            >
              <div class="flex items-center justify-between gap-2">
                <span class="text-label-sm font-semibold truncate text-md-on-surface">
                  {mail.from_name || mail.from || $t('emailDetail.unknownSender')}
                </span>
                <span class="text-xs text-md-on-surface/45 shrink-0">
                  {mail.time || timeAgo(mail.received_at)}
                </span>
              </div>
              <div class="text-label-sm text-md-on-surface/60 truncate">
                {mail.subject || $t('emailDetail.noSubject')}
              </div>
            </button>
          {/each}
        </div>
      </div>
    {/if}

    <!-- View Mailbox button -->
    <div class="pt-2">
      <button
        class="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-md-primary/10 hover:bg-md-primary/20 text-md-primary text-sm font-medium transition-colors"
        onclick={onNavigateToMailbox}
        aria-label={$t('emailDetail.viewInMailbox')}
      >
        <Icon name="mail" class="w-4 h-4" />
        {$t('emailDetail.viewInMailbox')}
      </button>
    </div>

  </div>
{/if}

  <!-- Bottom toolbar (same placement language as MessageDetail) -->
  <div class="absolute inset-x-0 bottom-2 z-30 flex items-center justify-center px-2 pointer-events-none">
    <div class="pointer-events-auto flex items-center gap-0.5 max-w-full overflow-x-auto no-scrollbar bg-md-surface/90 backdrop-blur-sm rounded-full p-1 shadow-lg border border-md-outline-variant/25">
      <button
        type="button"
        class="{detailToolbarClass}
          {mailboxReadState.canMarkAllRead
            ? 'text-md-on-surface-variant hover:bg-md-secondary-container hover:text-md-on-secondary-container'
            : 'text-md-on-surface/30 cursor-not-allowed'}"
        title={$t('emailDetail.markAllRead')}
        aria-label={$t('emailDetail.markAllRead')}
        disabled={!mailboxReadState.canMarkAllRead}
        aria-disabled={!mailboxReadState.canMarkAllRead}
        onclick={(e) => {
          e.stopPropagation();
          if (!mailboxReadState.canMarkAllRead) return;
          onMarkAllRead();
        }}
      >
        <Icon name="checkCircle" class="w-4 h-4 shrink-0" />
        {#if showToolbarLabels}<span>{$t('emailDetail.markAllReadShort')}</span>{/if}
      </button>
      <button
        type="button"
        class="{detailToolbarClass}
          {mailboxReadState.canMarkAllUnread
            ? 'text-md-primary hover:bg-md-secondary-container'
            : 'text-md-on-surface/30 cursor-not-allowed'}"
        title={$t('emailDetail.markAllUnread')}
        aria-label={$t('emailDetail.markAllUnread')}
        disabled={!mailboxReadState.canMarkAllUnread}
        aria-disabled={!mailboxReadState.canMarkAllUnread}
        onclick={(e) => {
          e.stopPropagation();
          if (!mailboxReadState.canMarkAllUnread) return;
          onMarkAllUnread();
        }}
      >
        <Icon name="mail" class="w-4 h-4 shrink-0" />
        {#if showToolbarLabels}<span>{$t('emailDetail.markAllUnreadShort')}</span>{/if}
      </button>
      <span class="w-px h-5 bg-md-outline-variant/40 mx-0.5 shrink-0"></span>
      {#if currentEmailDetail}
        <button
          type="button"
          class="{detailToolbarClass} text-md-on-surface-variant hover:bg-md-secondary-container"
          title={isArchivedDetail ? $t('common.unarchive') : $t('emailDetail.archiveMailbox')}
          aria-label={isArchivedDetail ? $t('common.unarchive') : $t('emailDetail.archiveMailbox')}
          onclick={(e) => {
            e.stopPropagation();
            if (!currentEmailDetail) return;
            if (isArchivedDetail) onUnarchiveAccount(currentEmailDetail);
            else onArchiveAccount(currentEmailDetail);
          }}
        >
          <Icon name="archive" class="w-4 h-4 shrink-0" />
          {#if showToolbarLabels}<span>{isArchivedDetail ? $t('common.unarchive') : $t('inbox.emailActions.archive')}</span>{/if}
        </button>
        <button
          type="button"
          class="{detailToolbarClass} text-md-error/80 hover:bg-md-error/15"
          title={$t('emailDetail.deleteMailbox')}
          aria-label={$t('emailDetail.deleteMailbox')}
          onclick={(e) => {
            e.stopPropagation();
            if (currentEmailDetail) onRemoveAccount(currentEmailDetail.address);
          }}
        >
          <Icon name="trash" class="w-4 h-4 shrink-0" />
          {#if showToolbarLabels}<span>{$t('inbox.emailActions.delete')}</span>{/if}
        </button>
      {/if}
      <span class="w-px h-5 bg-md-outline-variant/40 mx-0.5 shrink-0"></span>
      <button
        type="button"
        class="{detailToolbarClass} text-md-on-surface-variant hover:bg-md-secondary-container disabled:opacity-50 {loading ? 'animate-spin' : ''}"
        title={$t('emailDetail.refreshMessages')}
        aria-label={$t('emailDetail.refreshMessages')}
        disabled={loading}
        onclick={(e) => { e.stopPropagation(); onRefreshMessages(); }}
      >
        <Icon name="refresh" class="w-4 h-4 shrink-0" />
        {#if showToolbarLabels}<span>{$t('common.refresh')}</span>{/if}
      </button>
      <button
        type="button"
        class="{detailToolbarClass} text-md-on-surface-variant hover:bg-md-secondary-container"
        title={$t('emailDetail.downloadEmails')}
        aria-label={$t('emailDetail.downloadEmails')}
        onclick={(e) => { e.stopPropagation(); onExportEmail(); }}
      >
        <Icon name="download" class="w-4 h-4 shrink-0" />
        {#if showToolbarLabels}<span>{$t('inbox.emailActions.downloadShort')}</span>{/if}
      </button>
      {#if supportsAutoRenew && currentEmailDetail?.expiresAt}
        <span class="w-px h-5 bg-md-outline-variant/40 mx-0.5 shrink-0"></span>
        <div class="shrink-0 flex items-center px-1">
          <AutoRenewToggle
            autoRenew={currentEmailDetail.autoExtend || false}
            onToggle={() => {
              if (currentEmailDetail) onToggleAutoExtend(currentEmailDetail);
            }}
          />
        </div>
      {/if}
    </div>
  </div>
</div>
