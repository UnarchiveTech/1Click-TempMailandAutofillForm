<script lang="ts">
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import { migrateEmailBags } from '@/features/address/address-actions.js';
import { updateAddressColors } from '@/features/settings/address-color.js';
import { type ToastFn } from '@/ui/blocks/layout/use-toast.js';
import CopyButton from '@/ui/components/composites/CopyButton.svelte';
import Icon from '@/ui/components/icons/Icon.svelte';
import AutoRenewToggle from '@/ui/components/primitives/AutoRenewToggle.svelte';
import Avatar from '@/ui/components/primitives/Avatar.svelte';
import Badge from '@/ui/components/primitives/Badge.svelte';
import Btn from '@/ui/components/primitives/Btn.svelte';
import FaviconImage from '@/ui/components/primitives/FaviconImage.svelte';
import IconButton from '@/ui/components/primitives/IconButton.svelte';
import ProviderPill from '@/ui/components/primitives/ProviderPill.svelte';
import TagPill from '@/ui/components/primitives/TagPill.svelte';
import {
  DETAIL_TOOLBAR_STRIP,
  DETAIL_TOOLBAR_TONE_DANGER,
  DETAIL_TOOLBAR_TONE_NEUTRAL,
  detailToolbarBtnClass,
} from '@/ui/detail-toolbar.js';
import {
  isArchived as isAddressArchived,
  isDeleted as isAddressDeleted,
} from '@/utils/address/address-status.js';
import { addressTagsList, tagColorFor, tagUsageInfo } from '@/utils/address/address-tags.js';
import { loadProviderConfig } from '@/utils/email/email-service.js';
import { getDomainAvatarStack } from '@/utils/email/sender-avatars.js';
import { logError } from '@/utils/logger.js';
import { withAddressLock } from '@/utils/mutex.js';
import { getMailboxReadState } from '@/utils/storage/mailbox-read-state.js';
import { isUndoCurrent, markAddressMutation } from '@/utils/storage/undo-generation.js';
import { avatarColor } from '@/utils/theme/avatar-color.js';
import { formatCompactDuration, timeAgo } from '@/utils/time/time-format.js';
import { useCurrentTime } from '@/utils/time/time-store.js';
import type { Address, CredentialsHistoryItem, Email, Identity } from '@/utils/types.js';
import { anchoredFlyout } from '@/utils/ui/anchored-flyout.js';
import { AVATAR_BOX } from '@/utils/ui/avatar-size.js';
import { ELEVATION } from '@/utils/ui/elevation.js';
import { PORTAL_Z_CLASS } from '@/utils/ui/portal-layers.js';
import { observeResizeOnFrame } from '@/utils/ui/resize-observer.js';
import { responsiveButtonLayout } from '@/utils/ui/responsive-button-layout.js';

let {
  currentEmailDetail = null,
  emails = [],
  savedLogins = [],
  loading = false,
  onOpenMessageDetail = () => {},
  onRefreshMessages = () => {},
  onExportEmail = () => {},
  onNavigateToMailbox = () => {},
  onArchiveAddress = () => {},
  onUnarchiveAddress = () => {},
  onRemoveAddress = () => {},
  onToggleAutoExtend = () => {},
  onExtendAddress = () => {},
  onMarkAllRead = () => {},
  onMarkAllUnread = () => {},
  onOpenTagDialog = () => {},
  onOpenQrDialog = (_email: string) => {},
  onOpenSavedLogins = (_email: string, _domain?: string) => {},
  onOpenSite = (_domain: string) => {},
  onOpenIdentities = (_email: string) => {},
  onAddressDomainChanged = (_address: string) => {},
  showToast = (
    _msg: string | { message: string },
    _type?: string,
    _undo?: (() => void | Promise<void>) | null
  ) => {},
  /** When true (split view), toolbar buttons show icon + text label */
  showToolbarLabels = false,
  /**
   * `buildTagAddressUsage(...)` for the address list - the count on the tag chip
   * here and the addresses its hover names, identical to every other chip.
   */
  tagUsage = {} as Record<string, string[]>,
  /**
   * `buildTagColors(...)` for the address list. A tag is one tag regardless of
   * casing, so it is one color - read through `tagColorFor`, not the color stored
   * on this address, or `banking` / `Banking` show two different chips.
   */
  tagColors = {} as Record<string, string>,
}: {
  onBack?: () => void;
  currentEmailDetail?: Address | null;
  emails?: Email[];
  savedLogins?: CredentialsHistoryItem[];
  loading?: boolean;
  onOpenMessageDetail?: (thread: Email[]) => void;
  onRefreshMessages?: () => void;
  onExportEmail?: () => void;
  onNavigateToMailbox?: () => void;
  onArchiveAddress?: (account: Address) => void;
  onUnarchiveAddress?: (account: Address) => void;
  onRemoveAddress?: (address: string) => void;
  onToggleAutoExtend?: (account: Address) => void;
  onExtendAddress?: (account: Address) => void | Promise<void>;
  onMarkAllRead?: () => void;
  onMarkAllUnread?: () => void;
  onOpenTagDialog?: () => void;
  onOpenQrDialog?: (email: string) => void;
  onOpenSavedLogins?: (email: string, domain?: string) => void;
  onOpenSite?: (domain: string) => void;
  onOpenIdentities?: (email: string) => void;
  onAddressDomainChanged?: (address: string) => void;
  showToast?: ToastFn;
  showToolbarLabels?: boolean;
  tagUsage?: Record<string, string[]>;
  tagColors?: Record<string, string>;
} = $props();

const toolbarBtn = $derived(detailToolbarBtnClass(showToolbarLabels));

/** Floating toolbar height → dynamic bottom spacer so wrapped rows never hide content. */
let detailToolbarEl = $state<HTMLElement | null>(null);
let detailToolbarHeightPx = $state(0);

$effect(() => {
  const el = detailToolbarEl;
  if (!el || typeof ResizeObserver === 'undefined') {
    detailToolbarHeightPx = 0;
    return;
  }
  return observeResizeOnFrame(el, (entries) => {
    for (const entry of entries) {
      detailToolbarHeightPx = Math.ceil(entry.target.getBoundingClientRect().height);
    }
  });
});

const timeStore = useCurrentTime();
const currentTime = $derived($timeStore);

const createdAgo = $derived.by(() => {
  const createdAt = currentEmailDetail?.createdAt;
  if (!createdAt) return '';
  return timeAgo(createdAt, currentTime);
});

const unreadCount = $derived(emails.filter((e: Email) => e.unread).length);
const mailboxReadState = $derived(getMailboxReadState(emails));

const autofillLogins = $derived(
  currentEmailDetail
    ? savedLogins.filter(
        (l: CredentialsHistoryItem) =>
          (l.addressId === currentEmailDetail.id && !!currentEmailDetail.id) ||
          (l.email || '').toLowerCase() === (currentEmailDetail.address || '').toLowerCase()
      )
    : []
);
const autofillCount = $derived(autofillLogins.length);
const autofillDomains = $derived(
  [
    ...new Set(
      autofillLogins
        .map((l: CredentialsHistoryItem) =>
          (l.domain || l.website || '').toLowerCase().replace(/^www\./, '')
        )
        .filter((d: string): d is string => !!d)
    ),
  ].slice(0, 8) as string[]
);

let domainDropdownOpen = $state(false);
/** Current inbox's per-inbox accent color (id-keyed) shown in the domain picker. */
let addressAccentColor = $state('');
let usageExpanded = $state(false);
let usageSites = $state<
  Array<{
    domain: string;
    lastUsedAt: number;
    loginCount: number;
    inSiteMemory: boolean;
  }>
>([]);

/** Generation token so a stale address-usage fetch can't overwrite a newer one. */
let usageSitesGeneration = 0;

$effect(() => {
  const addr = currentEmailDetail?.address;
  const addressId = currentEmailDetail?.id;
  const logins = savedLogins;
  if (!addr) {
    usageSites = [];
    return;
  }
  const gen = ++usageSitesGeneration;
  void import('@/features/intelligence/address-usage.js')
    .then(({ getAddressUsageMap }) => getAddressUsageMap(addr, logins, addressId))
    .then((map) => {
      if (gen === usageSitesGeneration) usageSites = map.sites;
    })
    .catch(() => {
      if (gen !== usageSitesGeneration) return;
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

const autoRenewalCount = $derived.by(() => {
  const n = (currentEmailDetail as Address & { renewalCount?: number })?.renewalCount;
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
});

const supportsAutoRenew = $derived.by(() => {
  if (!currentEmailDetail?.provider) return false;
  try {
    const config = loadProviderConfig(currentEmailDetail.provider);
    return (
      (config.capabilities?.supportsRenew === true || config.expiry?.renewable === true) &&
      typeof config.expiry?.renewalMethod === 'string' &&
      config.expiry.renewalMethod.length > 0
    );
  } catch {
    /* ignore */
    return false;
  }
});

const isArchivedDetail = $derived(isAddressArchived(currentEmailDetail));
const detailTags = $derived(addressTagsList(currentEmailDetail));
const renewalLabel = $derived.by(() => {
  if (!currentEmailDetail?.provider) return $t('address.autoRenew');
  try {
    return loadProviderConfig(currentEmailDetail.provider).expiry?.renewalLabel === 'autoExtend'
      ? $t('activity.autoExtend')
      : $t('address.autoRenew');
  } catch {
    // Unknown providers have no renewal control; retain a safe caption.
    return $t('address.autoRenew');
  }
});

/** Banner window: matches the notification default (1h) so the UI warns in sync with alerts. */
const EXPIRING_SOON_MS = 60 * 60 * 1000;
/** A renewal failure older than this is stale and no longer banner-worthy. */
const RENEWAL_FAIL_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Localized countdown label - the shared time-unit formatter owns the s/m/h tokens. */
function formatCountdown(ms: number): string {
  return formatCompactDuration(ms);
}

/**
 * Live expiry status for the banner. Order matters: expired wins, then a recent
 * renewal failure, then the T-1h expiring-soon window. Null → no banner.
 */
const expiryBanner = $derived.by(() => {
  const acc = currentEmailDetail;
  if (!acc?.expiresAt || acc.expiresAt <= 0) return null;
  const now = currentTime;
  const left = acc.expiresAt - now;
  if (left <= 0) {
    return {
      wrapClass: 'bg-md-error/10 border-md-error/25',
      iconClass: 'text-md-error',
      btnClass: 'bg-md-error/15 text-md-error hover:bg-md-error/25',
      icon: 'warning',
      message: $t('address.expiredHint'),
      showRenew: true,
    };
  }
  const failCount = (acc as Address & { renewalFailCount?: number }).renewalFailCount || 0;
  const lastFailure = (acc as Address & { lastFailureAt?: number }).lastFailureAt || 0;
  // A retry countdown may only describe a retry that WILL happen, so the streak
  // is gated on `autoExtend` exactly as AddressesView.renewalRetryCaption and
  // the mailbox's renewal strip gate theirs. Disabling auto-renew clears the
  // streak (toggleAutoExtend), but a stale/raw record can still reach here -
  // and promising a retry on an address that will never retry is the banner
  // lying. Off → fall through to the expiry countdown below, which is still
  // true for the address.
  if (
    acc.autoExtend &&
    failCount >= 1 &&
    lastFailure > 0 &&
    now - lastFailure < RENEWAL_FAIL_WINDOW_MS
  ) {
    const nextRetryAt = (acc as Address & { nextRetryAt?: number }).nextRetryAt || 0;
    const message =
      nextRetryAt > now
        ? $t('addressView.renewalFailedRetryIn', {
            values: { time: formatCountdown(nextRetryAt - now) },
          })
        : $t('addressView.renewalFailed');
    return {
      wrapClass: 'bg-md-warning/10 border-md-warning/25',
      iconClass: 'text-md-warning',
      btnClass: 'bg-md-warning/15 text-md-warning hover:bg-md-warning/25',
      icon: 'warning',
      message,
      showRenew: true,
    };
  }
  if (left <= EXPIRING_SOON_MS) {
    return {
      wrapClass: 'bg-md-warning/10 border-md-warning/25',
      iconClass: 'text-md-warning',
      btnClass: 'bg-md-warning/15 text-md-warning hover:bg-md-warning/25',
      icon: 'schedule',
      message: $t('address.expiresIn', {
        values: { time: formatCountdown(left) },
      }),
      showRenew: false,
    };
  }
  return null;
});

let renewing = $state(false);
async function renewNow() {
  if (!currentEmailDetail || renewing) return;
  renewing = true;
  try {
    await onExtendAddress(currentEmailDetail);
  } catch {
    /* extendAddress surfaces its own toast; swallow here */
  } finally {
    renewing = false;
  }
}

function openInProvider() {
  const url = currentEmailDetail?.instanceUrl;
  if (url) void browser.tabs.create({ url });
}

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
    /* ignore */
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
    const { prev, addressId, prevSnapshot } = await withAddressLock(async () => {
      const { addresses = [] } = (await browser.storage.local.get(['addresses'])) as {
        addresses?: Address[];
      };
      // Match by id first; fall back to current address (import / id drift)
      const detailId = currentEmailDetail?.id;
      const detailAddr = currentEmailDetail?.address;
      let idx = detailId ? addresses.findIndex((i) => i.id === detailId) : -1;
      if (idx < 0 && detailAddr) {
        const addrLower = detailAddr.toLowerCase();
        idx = addresses.findIndex(
          (i) => i.address === detailAddr || i.address?.toLowerCase() === addrLower
        );
      }
      if (idx < 0) throw new Error('Address not found for domain change');
      const prev = addresses[idx].address;
      const addressId = addresses[idx].id;
      const prevSnapshot = { ...addresses[idx] };
      addresses[idx] = { ...addresses[idx], address: nextAddr, emailUser: user };
      // Publish the renamed address, ID index, and migrated bags in the same
      // storage transaction so a bag failure cannot leave an empty mailbox.
      await migrateEmailBags(browser, prev, nextAddr, {
        addresses,
        activeAddressId: addressId,
      });
      return { prev, addressId, prevSnapshot };
    });
    // Keep per-inbox accent color stable across domain rewrite (id-keyed).
    // Serialized: the colour picker writes this same map, so a whole-map write
    // of what this flow read would erase the colour it just gave another inbox.
    try {
      if (addressId) {
        await updateAddressColors((current) => {
          const color = current[addressId] || current[prev];
          if (!color) return current;
          const next = { ...current, [addressId]: color };
          delete next[prev];
          return next;
        });
      }
    } catch {
      /* ignore */
    }
    onAddressDomainChanged(nextAddr);
    const msg = $t('addressView.domainChanged', { values: { from: prev, to: nextAddr } });
    // The record rewrite + bag migration LANDED: every undo offered before it
    // is stale, and the undo this toast carries is created under the new
    // revision (same shared counter the delete/archive/import flows mark).
    const undoRevision = await markAddressMutation();
    showToast(msg, 'success', async () => {
      // A newer surface mutation landed while this toast was up: this undo
      // would write the captured pre-change record over it. Say so.
      if (!(await isUndoCurrent(undoRevision))) {
        showToast($t('toasts.undoSuperseded'), 'warning');
        return;
      }
      // Undo domain change
      try {
        await withAddressLock(async () => {
          const { addresses: list = [] } = (await browser.storage.local.get(['addresses'])) as {
            addresses?: Address[];
          };
          const i = list.findIndex((x) => x.id === addressId);
          if (i < 0) throw new Error('Address not found for domain-change undo');
          list[i] = { ...list[i], address: prev, emailUser: prevSnapshot.emailUser };
          await migrateEmailBags(browser, nextAddr, prev, {
            addresses: list,
            activeAddressId: addressId,
          });
        });
        onAddressDomainChanged(prev);
      } catch (error) {
        // The forward change already committed: surface the failed undo
        // instead of leaving the user on an address that claims to be undone.
        logError('Undo address domain change failed', error);
        showToast($t('addressView.domainChangeFailed'), 'error');
      }
    });
  } catch {
    showToast($t('addressView.domainChangeFailed'), 'error');
  }
}

// Avatar stack senders (unique, up to 5)
/** Domain-ranked favicon stack (same logic as Addresses page) */
const domainAvatarStack = $derived(getDomainAvatarStack(emails, 4));

/** 2-3 most recent emails for the preview list before “View in mailbox”. */
const recentEmails = $derived(
  [...emails].sort((a, b) => (b.received_at || 0) - (a.received_at || 0)).slice(0, 3)
);

const localPart = $derived((currentEmailDetail?.address || '').split('@')[0] || '');
const domainPart = $derived((currentEmailDetail?.address || '').split('@')[1] || '');

/** Read the per-inbox accent color (id-keyed, legacy address fallback) - read-only. */
async function refreshAddressAccentColor() {
  const id = currentEmailDetail?.id;
  const addr = currentEmailDetail?.address;
  if (!id && !addr) {
    addressAccentColor = '';
    return;
  }
  try {
    const r = (await browser.storage.local.get(['addressColors'])) as {
      addressColors?: Record<string, string>;
    };
    const map = r.addressColors || {};
    addressAccentColor = (id && map[id]) || (addr && map[addr]) || '';
  } catch {
    /* ignore */
  }
}

$effect(() => {
  void currentEmailDetail?.id;
  void currentEmailDetail?.address;
  void refreshAddressAccentColor();
});
</script>

<div class="relative flex flex-col h-full min-h-0">
{#if currentEmailDetail}
  <div
    class="scroll-body flex-1 py-3 space-y-3 overflow-y-auto"
    style="padding-bottom: calc(var(--bottom-safe-area, 0px) + {detailToolbarHeightPx}px + 12px);"
  >

    <!-- Email address + domain selector + Copy button: a control row that owns the two
         row-level keys - D opens the domain picker, Escape closes it. -->
    <div
      class="flex items-center gap-3 rounded-xl bg-md-surface-container-low p-3 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-md-primary/30"
      tabindex="0"
      role="toolbar"
      aria-label={$t('addressView.changeDomain')}
      onkeydown={(e) => {
        const target = e.target as HTMLElement | null;
        const typingInField =
          !!target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' ||
            target.isContentEditable);
        if (
          !typingInField &&
          supportsDomainChange &&
          e.key.toLowerCase() === 'd' &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey &&
          !e.shiftKey
        ) {
          e.preventDefault();
          if (!domainDropdownOpen) void refreshAddressAccentColor();
          domainDropdownOpen = !domainDropdownOpen;
        } else if (e.key === 'Escape' && domainDropdownOpen) {
          e.preventDefault();
          e.stopPropagation();
          domainDropdownOpen = false;
        }
      }}
    >
      <!-- Letter avatar - single Avatar source -->
      <Avatar
        size="xl"
        letter={currentEmailDetail.address[0] || '?'}
        email={currentEmailDetail.address}
        shape="square"
        class="shrink-0"
      />
      <div
        class="flex-1 min-w-0 flex flex-col items-start gap-1"
        style="direction:ltr;unicode-bidi:isolate;"
        data-selectable-text="true"
      >
        <span class="min-w-0 truncate font-medium text-sm text-md-on-surface">{localPart}</span>
        <span class="relative inline-flex items-center shrink-0">
          {#if supportsDomainChange}
            <button
              type="button"
              class="inline-flex items-center gap-1 ps-1.5 pe-1 py-0.5 rounded-md bg-md-secondary-container text-md-on-secondary-container hover:bg-md-secondary-container/80 active:bg-md-secondary-container/100 transition-colors text-xs font-medium overflow-hidden max-w-full"
              aria-label={$t('addressView.changeDomain')}
              aria-haspopup="menu"
              aria-expanded={domainDropdownOpen}
              onclick={(e) => {
                e.stopPropagation();
                if (!domainDropdownOpen) void refreshAddressAccentColor();
                domainDropdownOpen = !domainDropdownOpen;
              }}
            >
              <span class="truncate min-w-0">@{domainPart}</span>
              <Icon name="chevronDown" class="w-3.5 h-3.5 shrink-0" />
            </button>
          {:else}
            <span class="shrink-0 font-medium text-sm text-md-on-surface">@{domainPart}</span>
          {/if}
          {#if domainDropdownOpen}
            <button
              type="button"
              class="fixed inset-0 {PORTAL_Z_CLASS.accountMenu} cursor-default bg-transparent border-0"
              aria-label={$t('common.close')}
              onclick={() => (domainDropdownOpen = false)}
            ></button>
            <div
              use:anchoredFlyout={{ onClose: () => { domainDropdownOpen = false; } }}
              class="menu-list absolute top-full start-0 mt-1 bg-md-surface-container-low border border-md-outline-variant/50 rounded-xl {ELEVATION.level2} {PORTAL_Z_CLASS.accountMenu} overflow-y-auto max-h-56 min-w-[170px]"
              role="menu"
              aria-label={$t('addressView.changeDomain')}
            >
              {#each multiDomainList as d (d)}
                {@const active = d === domainPart}
                <button
                  type="button"
                  role="menuitem"
                  class="w-full flex items-center gap-2 px-3 min-h-10 text-sm text-start hover:bg-md-surface-variant active:brightness-95 transition-colors {active
                    ? 'text-md-primary font-semibold'
                    : 'text-md-on-surface'}"
                  style="direction:ltr;"
                  disabled={active}
                  onclick={() => {
                    domainDropdownOpen = false;
                    if (!active) void changeAddressDomain(d);
                  }}
                >
                  {#if addressAccentColor}
                    <span
                      class="w-2.5 h-2.5 rounded-full shrink-0"
                      style="background-color: {addressAccentColor};"
                      aria-hidden="true"
                    ></span>
                  {/if}
                  <span class="flex-1 truncate">@{d}</span>
                  {#if active}<Icon name="check" class="w-3.5 h-3.5 shrink-0" />{/if}
                </button>
              {/each}
            </div>
          {/if}
        </span>
      </div>
      <IconButton
        icon="qrCode2"
        size="sm"
        ariaLabel={$t('inbox.showQrAria')}
        title={$t('inbox.showQrAria')}
        onclick={() => onOpenQrDialog(currentEmailDetail.address)}
      />
      <CopyButton text={currentEmailDetail.address} size="sm" variant="surface" />
    </div>

    <!-- Live expiry / renewal-failure banner -->
    {#if expiryBanner}
      <div
        class="rounded-xl border flex items-center gap-2 px-3 py-2 {expiryBanner.wrapClass}"
        role="status"
      >
        <Icon name={expiryBanner.icon} class="w-4 h-4 shrink-0 {expiryBanner.iconClass}" />
        <span class="flex-1 min-w-0 text-xs font-medium text-md-on-surface">
          {expiryBanner.message}
        </span>
        {#if expiryBanner.showRenew && supportsAutoRenew}
          <button
            type="button"
            class="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-label-sm font-semibold border-0 transition-colors disabled:opacity-60 {expiryBanner.btnClass}"
            disabled={renewing}
            onclick={(e) => {
              e.stopPropagation();
              void renewNow();
            }}
          >
            <Icon name="refresh" class="w-3.5 h-3.5 {renewing ? 'animate-spin' : ''}" />
            {renewing ? $t('addressView.renewing') : $t('addressView.renewNow')}
          </button>
        {/if}
      </div>
    {/if}

    <!-- Provider (instance) pill + auto-renew toggle + tag row -->
    <div class="flex flex-wrap items-center gap-2">
      <ProviderPill
        provider={currentEmailDetail.provider}
        instanceUrl={currentEmailDetail.instanceUrl}
      />
      {#if isArchivedDetail}
        <Badge variant="outline" label={$t('common.archived')} />
      {:else if isAddressDeleted(currentEmailDetail)}
        <Badge variant="error" label={$t('common.deleted')} />
      {/if}
      {#if currentEmailDetail.instanceUrl}
        <button
          type="button"
          class="w-6 h-6 rounded-full flex items-center justify-center text-md-on-surface/60 hover:text-md-primary hover:bg-md-primary/10 active:bg-md-primary/20 transition-colors"
          title={$t('addressView.openInProvider')}
          aria-label={$t('addressView.openInProvider')}
          onclick={(e) => {
            e.stopPropagation();
            openInProvider();
          }}
        >
          <Icon name="globe" class="w-3.5 h-3.5" />
        </button>
      {/if}
      {#if supportsAutoRenew && !isAddressDeleted(currentEmailDetail)}
        <AutoRenewToggle
          autoRenew={currentEmailDetail.autoExtend || false}
          label={renewalLabel}
          showStateText={false}
          onToggle={() => {
            if (currentEmailDetail) onToggleAutoExtend(currentEmailDetail);
          }}
        />
      {/if}
      {#each detailTags as tag (tag.name)}
        <TagPill tag={tag.name} tagColor={tagColorFor(tagColors, tag.name) ?? tag.color}
          usage={tagUsageInfo($t, tagUsage, tag.name)} onClick={onOpenTagDialog} />
      {:else}
        <TagPill onClick={onOpenTagDialog} />
      {/each}
    </div>

    <!-- Lifecycle -->
    <details class="rounded-xl border border-md-outline-variant/30 bg-md-surface-container-low/60 p-3 space-y-2" data-address-stats="lifecycle">
      <summary class="cursor-pointer ui-label text-md-on-surface">{$t('addressView.statsLifecycle')}</summary>

      <div class="text-xs text-md-on-surface-variant pt-2">
        {$t('addressView.created')} {createdAgo}
      </div>

      <div class="text-xs text-md-on-surface-variant">
        {$t('addressView.receivedMails', {
          values: {
            n: receivedMailCount,
            unread: unreadCount > 0 ? ` (${unreadCount})` : '',
          },
        })}
      </div>

      <div class="flex items-center gap-2 text-xs text-md-on-surface-variant">
        <Icon name="lock" class="w-3 h-3 text-md-primary/60" />
        <span>{$t('addressView.otpCount', { values: { n: otpCount } })}</span>
      </div>

      {#if supportsAutoRenew}
        <div class="flex items-center gap-2 text-xs text-md-on-surface-variant">
          <Icon name="refresh" class="w-3 h-3 text-md-primary/60" />
          <span>{$t('addressView.autoRenewalCount', { values: { n: autoRenewalCount } })}</span>
        </div>
      {/if}

      {#if defaultIdentityUsesThis}
        <div class="flex items-center gap-1 text-label-sm text-md-tertiary font-medium">
          <Icon name="person" class="w-3 h-3" />
          <span>{$t('addressView.defaultInIdentity')}</span>
        </div>
      {/if}
    </details>

    <!-- Sender activity -->
    {#if domainAvatarStack.senders.length > 0}
      <details class="rounded-xl border border-md-outline-variant/30 bg-md-surface-container-low/60 p-3 space-y-2" data-address-stats="senders">
        <summary class="cursor-pointer ui-label text-md-on-surface">{$t('addressView.statsSenders')}</summary>
        <div class="flex items-center gap-1.5">
          <div class="flex items-center">
            {#each domainAvatarStack.senders as sender, i (sender.domain)}
              <div
                class="relative {AVATAR_BOX.md} rounded-full border-2 border-md-surface overflow-hidden flex items-center justify-center bg-md-surface-container-low flex-shrink-0"
                style="z-index: {4 - i}; margin-inline-start: {i === 0 ? '0' : '-6px'};"
                title="{sender.domain} ({sender.count})"
              >
                <FaviconImage
                  email={sender.email}
                  domain={sender.domain}
                  size="md"
                  class="object-cover"
                  fallbackLetter={sender.letter}
                  fallbackColor={avatarColor(sender.domain)}
                />
              </div>
            {/each}
            {#if domainAvatarStack.remainder > 0}
              <div
                class="relative {AVATAR_BOX.md} rounded-full border-2 border-md-surface bg-md-surface-variant flex items-center justify-center flex-shrink-0"
                style="z-index: 0; margin-inline-start: -6px;"
              >
                <span class="text-label-sm font-bold text-md-on-surface/60">+{domainAvatarStack.remainder}</span>
              </div>
            {/if}
          </div>
        </div>
      </details>
    {/if}

    <!-- Credentials & usage -->
    <div class="rounded-xl border border-md-outline-variant/30 bg-md-surface-container-low/60 p-3 space-y-1.5">
      <h3 class="ui-label text-md-on-surface">{$t('addressView.statsCredentials')}</h3>

      <button
        type="button"
        class="w-full flex items-center gap-2 text-start rounded-lg px-1 py-1 hover:bg-md-primary/10 active:bg-md-primary/30 transition-colors border-0 bg-transparent"
        title={$t('addressView.usedInAutofillsHint')}
        aria-expanded={usageExpanded}
        onclick={(e) => {
          e.stopPropagation();
          usageExpanded = !usageExpanded;
        }}
      >
        <Icon name="lock" class="w-3.5 h-3.5 text-md-primary shrink-0" />
        <span class="text-xs font-semibold text-md-primary flex-1">
          {$t('addressView.usageMapTitle', {
            values: { n: usageSites.length || autofillCount },
          })}
        </span>
        {#if usageSites.length > 0 || autofillDomains.length > 0}
          <div class="flex -space-x-1.5">
            {#each (usageSites.length ? usageSites.map((s) => s.domain) : autofillDomains).slice(0, 4) as domain}
              <div
                class="{AVATAR_BOX.sm} rounded-md bg-md-surface flex items-center justify-center overflow-hidden border border-md-outline-variant/30"
                title={domain}
              >
                <FaviconImage
                  {domain}
                  size="sm"
                  class="object-contain"
                  fallbackLetter={domain[0]?.toUpperCase() ?? '?'}
                />
              </div>
            {/each}
          </div>
        {/if}
        <Icon name={usageExpanded ? 'chevronUp' : 'chevronDown'} class="w-3.5 h-3.5 text-md-on-surface/40" />
      </button>

      {#if usageExpanded}
        {#if usageSites.length > 0}
          <ul class="max-h-40 overflow-y-auto divide-y divide-md-outline-variant/20">
            {#each usageSites as site (site.domain)}
              <li>
                <button
                  type="button"
                  class="w-full flex items-center gap-2 rounded-lg px-1.5 py-1.5 text-start hover:bg-md-primary/10 active:bg-md-primary/30 disabled:opacity-55 disabled:cursor-default border-0 bg-transparent"
                  title={site.loginCount > 0
                    ? $t('addressView.openSavedLoginsForSite', { values: { domain: site.domain } })
                    : $t('addressView.openSiteDetails', { values: { domain: site.domain } })}
                  onclick={(e) => {
                    e.stopPropagation();
                    if (site.loginCount > 0) onOpenSavedLogins(currentEmailDetail.address, site.domain);
                    else onOpenSite(site.domain);
                  }}
                >
                  <div
                    class="{AVATAR_BOX.sm} rounded-md bg-md-surface flex items-center justify-center overflow-hidden border border-md-outline-variant/30 shrink-0"
                  >
                    <FaviconImage
                      domain={site.domain}
                      size="sm"
                      class="object-contain"
                      fallbackLetter={site.domain[0]?.toUpperCase() ?? '?'}
                    />
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="text-sm font-medium text-md-on-surface truncate">{site.domain}</div>
                    <div class="text-xs text-md-on-surface-variant">
                      {#if site.loginCount > 0}
                        {$t('addressView.usageLogins', { values: { n: site.loginCount } })}
                        ·
                      {/if}
                      {site.lastUsedAt ? timeAgo(site.lastUsedAt) : '-'}
                      {#if site.inSiteMemory}
                        · {$t('addressView.usageInMemory')}
                      {/if}
                    </div>
                  </div>
                </button>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="text-xs text-md-on-surface/50 px-1">{$t('addressView.usageMapEmpty')}</p>
        {/if}
      {/if}

      <!-- Unified logins & identities actions -->
      <div
        class="flex flex-nowrap items-center gap-3 pt-2 mt-0.5 border-t border-md-outline-variant/20"
        use:responsiveButtonLayout
        data-action-tier="S"
      >
        <button
          type="button"
          class="flex-1 h-10 px-2 text-label-sm font-semibold rounded-lg bg-md-tertiary/10 text-md-tertiary hover:bg-md-tertiary/20 active:bg-md-tertiary/40 transition-colors flex items-center justify-center gap-1"
          title={$t('addressView.viewAllSavedLogins')}
          aria-label={$t('addressView.viewAllSavedLogins')}
          onclick={(e) => {
            e.stopPropagation();
            onOpenSavedLogins(currentEmailDetail.address);
          }}
        >
          <Icon name="lock" class="w-3.5 h-3.5" />
          <span class="truncate">{$t('addressView.savedLoginsCount', { values: { n: autofillCount } })}</span>
        </button>
        <button
          type="button"
          class="flex-1 h-10 px-2 text-label-sm font-semibold rounded-lg bg-md-tertiary/10 text-md-tertiary hover:bg-md-tertiary/20 active:bg-md-tertiary/40 transition-colors flex items-center justify-center gap-1"
          title={$t('inbox.emailActions.openIdentities')}
          aria-label={$t('inbox.emailActions.openIdentities')}
          onclick={(e) => {
            e.stopPropagation();
            onOpenIdentities(currentEmailDetail.address);
          }}
        >
          <Icon name="person" class="w-3.5 h-3.5" />
          <span class="truncate">{$t('inbox.emailActions.openIdentities')}</span>
        </button>
      </div>
    </div>



    <!-- Recent emails preview -->
    {#if recentEmails.length > 0}
      <div class="space-y-1.5 pt-1">
        <div class="text-xs font-semibold text-md-on-surface/70">{$t('addressView.recentEmails')}</div>
        <div class="rounded-xl border border-md-outline-variant/30 overflow-hidden divide-y divide-md-outline-variant/20">
          {#each recentEmails as mail (mail.id)}
            <button
              type="button"
              class="w-full text-start px-3 py-2 hover:bg-md-surface-variant/40 active:bg-md-surface-variant/60 transition-colors"
              onclick={() => onOpenMessageDetail([mail])}
            >
              <div class="flex items-center justify-between gap-2">
                <span class="text-label-sm font-semibold truncate text-md-on-surface">
                  {mail.from_name || mail.from || $t('addressView.unknownSender')}
                </span>
                <span class="text-xs text-md-on-surface/45 shrink-0">
                  {mail.time || timeAgo(mail.received_at)}
                </span>
              </div>
              <div class="text-label-sm text-md-on-surface/60 truncate">
                {mail.subject || $t('addressView.noSubject')}
              </div>
            </button>
          {/each}
        </div>
      </div>
    {:else if !loading}
      <div class="space-y-1.5 pt-1">
        <div class="text-xs font-semibold text-md-on-surface/70">{$t('addressView.recentEmails')}</div>
        <div class="rounded-xl border border-dashed border-md-outline-variant/40 bg-md-surface-container-low/40 px-4 py-5 flex flex-col items-center gap-2 text-center">
          <Icon name="inbox" class="w-6 h-6 text-md-on-surface/25" />
          <p class="text-xs text-md-on-surface/50">{$t('address.noMailYet')}</p>
          <button
            type="button"
            class="inline-flex items-center gap-1 text-xs font-semibold text-md-primary hover:text-md-primary/80 transition-colors border-0 bg-transparent"
            onclick={(e) => {
              e.stopPropagation();
              onRefreshMessages();
            }}
          >
            <Icon name="refresh" class="w-3 h-3" />
            {$t('addressView.checkForMail')}
          </button>
        </div>
      </div>
    {/if}

    <!-- View Mailbox button -->
    <div class="pt-2">
      <Btn
        variant="tonal"
        size="md"
        class="w-full"
        onclick={onNavigateToMailbox}
        aria-label={$t('addressView.viewInMailbox')}
      >
        <Icon name="mail" class="w-4 h-4" />
        {$t('addressView.viewInMailbox')}
      </Btn>
    </div>

  </div>
{/if}

  <!-- Bottom toolbar (same placement language as MessageDetail / Activity) -->
  <div
    class="absolute inset-x-0 {PORTAL_Z_CLASS.chrome} flex items-center justify-center px-2 pointer-events-none"
    style="bottom: calc(var(--bottom-safe-area, 0px) + 4px);"
  >
    <div bind:this={detailToolbarEl} use:responsiveButtonLayout data-action-tier="XS" class="{DETAIL_TOOLBAR_STRIP}">
      <button
        type="button"
        class="{toolbarBtn} {mailboxReadState.canMarkAllRead ? DETAIL_TOOLBAR_TONE_NEUTRAL : 'text-md-on-surface/30 cursor-not-allowed'}"
        title={$t('addressView.markAllRead')}
        aria-label={$t('addressView.markAllRead')}
        disabled={!mailboxReadState.canMarkAllRead}
        aria-disabled={!mailboxReadState.canMarkAllRead}
        onclick={(e) => {
          e.stopPropagation();
          if (!mailboxReadState.canMarkAllRead) return;
          onMarkAllRead();
        }}
      >
        <Icon name="mark_email_read" class="w-4 h-4 shrink-0" />
        {#if showToolbarLabels}<span>{$t('addressView.markAllReadShort')}</span>{/if}
      </button>
      <button
        type="button"
        class="{toolbarBtn} {mailboxReadState.canMarkAllUnread ? DETAIL_TOOLBAR_TONE_NEUTRAL : 'text-md-on-surface/30 cursor-not-allowed'}"
        title={$t('addressView.markAllUnread')}
        aria-label={$t('addressView.markAllUnread')}
        disabled={!mailboxReadState.canMarkAllUnread}
        aria-disabled={!mailboxReadState.canMarkAllUnread}
        onclick={(e) => {
          e.stopPropagation();
          if (!mailboxReadState.canMarkAllUnread) return;
          onMarkAllUnread();
        }}
      >
        <Icon name="mark_email_unread" class="w-4 h-4 shrink-0" />
        {#if showToolbarLabels}<span>{$t('addressView.markAllUnreadShort')}</span>{/if}
      </button>
      {#if currentEmailDetail}
        <button
          type="button"
          class="{toolbarBtn} {DETAIL_TOOLBAR_TONE_NEUTRAL}"
          title={isArchivedDetail ? $t('common.unarchive') : $t('addressView.archiveMailbox')}
          aria-label={isArchivedDetail ? $t('common.unarchive') : $t('addressView.archiveMailbox')}
          onclick={(e) => {
            e.stopPropagation();
            if (!currentEmailDetail) return;
            if (isArchivedDetail) onUnarchiveAddress(currentEmailDetail);
            else onArchiveAddress(currentEmailDetail);
          }}
        >
          <Icon name={isArchivedDetail ? 'unarchive' : 'archive'} class="w-4 h-4 shrink-0" />
          {#if showToolbarLabels}<span>{isArchivedDetail ? $t('common.unarchive') : $t('common.archive')}</span>{/if}
        </button>
        <button
          type="button"
          class="{toolbarBtn} {DETAIL_TOOLBAR_TONE_DANGER}"
          title={$t('addressView.deleteMailbox')}
          aria-label={$t('addressView.deleteMailbox')}
          onclick={(e) => {
            e.stopPropagation();
            if (currentEmailDetail) onRemoveAddress(currentEmailDetail.address);
          }}
        >
          <Icon name="delete" class="w-4 h-4 shrink-0" />
          {#if showToolbarLabels}<span>{$t('common.delete')}</span>{/if}
        </button>
      {/if}
      <button
        type="button"
        class="{toolbarBtn} {DETAIL_TOOLBAR_TONE_NEUTRAL} disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-md-on-surface-variant"
        title={$t('addressView.refreshMessages')}
        aria-label={$t('addressView.refreshMessages')}
        disabled={loading}
        onclick={(e) => { e.stopPropagation(); onRefreshMessages(); }}
      >
        <Icon name="refresh" class="w-4 h-4 shrink-0 {loading ? 'animate-spin' : ''}" />
        {#if showToolbarLabels}<span>{$t('common.refresh')}</span>{/if}
      </button>
      <button
        type="button"
        class="{toolbarBtn} {DETAIL_TOOLBAR_TONE_NEUTRAL}"
        title={$t('addressView.downloadEmails')}
        aria-label={$t('addressView.downloadEmails')}
        onclick={(e) => { e.stopPropagation(); onExportEmail(); }}
      >
        <Icon name="download" class="w-4 h-4 shrink-0" />
        {#if showToolbarLabels}<span>{$t('inbox.emailActions.download')}</span>{/if}
      </button>
    </div>
  </div>
</div>
