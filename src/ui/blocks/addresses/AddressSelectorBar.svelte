<script lang="ts">
import { onDestroy, untrack } from 'svelte';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import AddressSelectorOverlay from '@/ui/blocks/addresses/AddressSelectorDrawer.svelte';
import Icon from '@/ui/components/icons/Icon.svelte';
import { Btn } from '@/ui/components/primitives';
import Badge from '@/ui/components/primitives/Badge.svelte';
import { getLifecycleStatus, isLive } from '@/utils/address/address-status.js';
import { copyToClipboardAndSchedulePurge } from '@/utils/clipboard/clipboard.js';
import { loadProviderConfig } from '@/utils/email/email-service.js';
import { pluralKey } from '@/utils/i18n/i18n-plural.js';
import { logError } from '@/utils/logger.js';
import { parseNumberRecord, updateStoredObject } from '@/utils/storage/rmw.js';
import { domainIndexKey } from '@/utils/storage/storage-keys.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import {
  peekStoredJsonSync,
  reconcileStoredJsonPref,
  updateStoredJsonMirror,
} from '@/utils/storage/stored-prefs-sync.js';
import { isUndoCurrent, markAddressMutation } from '@/utils/storage/undo-generation.js';
import { formatDurationRemaining } from '@/utils/time/time-format.js';
import { useCurrentTime } from '@/utils/time/time-store.js';
import type { Address } from '@/utils/types.js';
import { anchoredFlyout } from '@/utils/ui/anchored-flyout.js';
import { ELEVATION } from '@/utils/ui/elevation.js';
import { computeOpticalCenterOffset } from '@/utils/ui/optical-center.js';
import { PORTAL_Z_CLASS } from '@/utils/ui/portal-layers.js';

let {
  selectedEmail = '',
  accounts = [],
  allAddresses = [],
  displayedEmail = $bindable(''),
  onSelectAddress = () => {},
  onEditAddress = () => {},
  onCreateAddress = () => {},
  onNavigateToManage = () => {},
  onReloadAddresses = async () => {},
  onToggleAutoExtend = () => {},
  onArchiveAddress = () => {},
  onUnarchiveAddress = () => {},
  onRemoveAddress = () => {},
  onRestoreAddress = () => {},
  onTagAddress = () => {},
  onManageTags = () => {},
  onMarkAllRead = async (_account: Address) => {},
  onMarkAllUnread = async (_account: Address) => {},
  dropdownOpen = false,
  onDropdownOpenChange = () => {},
  showToast = (_message: string, _type?: string, _undo?: (() => void | Promise<void>) | null) => {},
  defaultDomain = '',
  /** Notifications control */
  notificationsEnabled = true,
  onToggleNotifications = () => {},
  /** Swipe left/right on pill for next/prev when gestures enabled */
  gesturesEnabled = true,
}: {
  selectedEmail?: string;
  accounts?: Address[];
  allAddresses?: Address[];
  displayedEmail?: string;
  onSelectAddress?: (address: string) => void;
  onEditAddress?: (account: Address) => void;
  onCreateAddress?: (provider?: string, instanceId?: string) => void;
  onNavigateToManage?: () => void;
  onReloadAddresses?: () => Promise<void>;
  onToggleAutoExtend?: (account: Address) => void;
  onArchiveAddress?: (account: Address) => void;
  onUnarchiveAddress?: (account: Address) => void;
  onRemoveAddress?: (address: string) => void;
  onRestoreAddress?: (address: string) => void;
  onTagAddress?: (account: Address) => void;
  onManageTags?: () => void;
  onMarkAllRead?: (account: Address) => void | Promise<void>;
  onMarkAllUnread?: (account: Address) => void | Promise<void>;
  dropdownOpen?: boolean;
  onDropdownOpenChange?: (open: boolean) => void;
  showToast?: (message: string, type?: string, undo?: (() => void | Promise<void>) | null) => void;
  defaultDomain?: string;
  notificationsEnabled?: boolean;
  onToggleNotifications?: () => void;
  gesturesEnabled?: boolean;
} = $props();

let currentDomainIndex = $state(0);
let notifSnoozeOpen = $state(false);
let snoozeUntil = $state(0);
let selectedSnoozeOption = $state<'5m' | '30m' | '1d' | 'custom' | null>(null);
let snoozeCustomMin = $state(0);
let snoozeCustomHrs = $state(0);
let snoozeCustomDays = $state(0);
let pillSwipeStartX = 0;
let pillSwiping = false;

// Derived values for email display
let emailParts = $derived.by(() => displayedEmail.split('@'));
let username = $derived.by(() => emailParts[0] || '');
let domain = $derived.by(() => emailParts[1] || '');
let multiDomainList = $derived.by((): string[] => {
  const account = allAddresses.find(
    (a: Address) => (a.address || '').toLowerCase() === selectedEmail.toLowerCase()
  );
  if (!account) return [];
  try {
    const cfg = loadProviderConfig(account.provider);
    if (!cfg.multiDomain?.enabled) return [];
    return (cfg.multiDomain.domains || []).filter(Boolean);
  } catch {
    /* ignore */
    return [];
  }
});
let isMultiDomain = $derived(multiDomainList.length > 1);

// Storage key for domain index per inbox
function getDomainStorageKey(email: string, providerId: string): `domainIndex_${string}_${string}` {
  return domainIndexKey(providerId, email.split('@')[0]);
}

// Load persisted domain index when selected email changes and update displayedEmail atomically.
//
// Anti-flash: the stored domain index is read SYNCHRONOUSLY from the shared
// prefs mirror (stored-prefs-sync) so the pill shows `user@domain.tld` at
// FIRST paint. Without it, the default-index pill rendered first and swapped
// to the stored domain a frame+ later - the same avatar→favicon pop fixed in
// FaviconImage. Multi-domain accounts resolve instantly; single-domain
// accounts skip the mirror entirely (no swap was ever possible for them).
$effect(() => {
  if (!selectedEmail) {
    untrack(() => {
      if (displayedEmail !== '') displayedEmail = '';
    });
    return;
  }
  const account = allAddresses.find(
    (a: Address) => (a.address || '').toLowerCase() === selectedEmail.toLowerCase()
  );
  if (!account) {
    currentDomainIndex = 0;
    untrack(() => {
      if (displayedEmail !== selectedEmail) displayedEmail = selectedEmail;
    });
    return;
  }
  const providerConfig = loadProviderConfig(account.provider);
  const multiDomain = providerConfig.multiDomain;
  if (!multiDomain?.enabled) {
    currentDomainIndex = 0;
    untrack(() => {
      if (displayedEmail !== selectedEmail) displayedEmail = selectedEmail;
    });
    return;
  }
  const domains = multiDomain.domains || [];
  const uname = selectedEmail.split('@')[0];
  const key = getDomainStorageKey(selectedEmail, account.provider);
  const resolveDisplayed = (resolvedIndex: number) => {
    currentDomainIndex = resolvedIndex;
    const next = `${uname}@${domains[resolvedIndex] || domains[0] || ''}`;
    untrack(() => {
      if (displayedEmail !== next) displayedEmail = next;
    });
  };
  const storedIndex = peekStoredJsonSync<number>(key);
  if (storedIndex !== undefined) {
    // Warm mirror: zero awaits - pill text is final at first paint.
    resolveDisplayed(storedIndex);
    return;
  }
  // Mirror cold (fresh context / never-stored key): keep the default-index
  // behavior, then adopt the stored index when the read resolves.
  let isCurrent = true;
  browser.storage.local.get([key]).then((result: Record<string, unknown>) => {
    if (!isCurrent) return;
    const stored = result[key] as number | undefined;
    let resolvedIndex = 0;
    if (stored !== undefined) {
      resolvedIndex = stored;
    } else if (defaultDomain) {
      const defaultIndex = domains.indexOf(defaultDomain);
      resolvedIndex = defaultIndex >= 0 ? defaultIndex : 0;
    }
    resolveDisplayed(resolvedIndex);
  });
  return () => {
    isCurrent = false;
  };
});

// Use shared ticking time store
const timeStore = useCurrentTime();
const currentTime = $derived($timeStore);
const RENEWAL_PROGRESS_STALE_MS = 2 * 60 * 1000;
const renewalInProgress = $derived.by(() => {
  const startedAt = currentAddress?.renewalInProgressAt;
  return (
    typeof startedAt === 'number' &&
    startedAt <= currentTime &&
    currentTime - startedAt < RENEWAL_PROGRESS_STALE_MS
  );
});

// Reactive derived value for current account
let currentAddress = $derived.by(() => {
  if (!selectedEmail) return null;
  return (
    allAddresses.find(
      (a: Address) => (a.address || '').toLowerCase() === selectedEmail.toLowerCase()
    ) || null
  );
});

// Live accounts count for +N badge
let liveAddressesCount = $derived.by(() => {
  return allAddresses.filter((a: Address) => isLive(a, currentTime)).length;
});

// Addresses of same status as current account for prev/next navigation
let currentLifecycleStatus = $derived.by(() => {
  if (!selectedEmail) return null;
  const current = allAddresses.find(
    (a: Address) => (a.address || '').toLowerCase() === selectedEmail.toLowerCase()
  );
  return current ? getLifecycleStatus(current, currentTime) : null;
});

let currentStatusAddresses = $derived.by(() => {
  if (!currentLifecycleStatus) return [];
  return allAddresses.filter(
    (a: Address) => getLifecycleStatus(a, currentTime) === currentLifecycleStatus
  );
});

let currentIndexInStatus = $derived.by(() => {
  if (!selectedEmail) return -1;
  return currentStatusAddresses.findIndex(
    (a: Address) => (a.address || '').toLowerCase() === selectedEmail.toLowerCase()
  );
});

function goToPrev() {
  if (currentIndexInStatus > 0) {
    onSelectAddress(currentStatusAddresses[currentIndexInStatus - 1].address);
  }
}

function goToNext() {
  if (currentIndexInStatus < currentStatusAddresses.length - 1) {
    onSelectAddress(currentStatusAddresses[currentIndexInStatus + 1].address);
  }
}

// Calculate remaining time for current account
const remainingMinutes = $derived.by(() => {
  if (!currentAddress?.expiresAt) return 0;
  const remainingMs = currentAddress.expiresAt - currentTime;
  return Math.max(0, Math.ceil(remainingMs / (1000 * 60)));
});

// Calculate how long ago the account expired (in minutes)
const expiredAgoMinutes = $derived.by(() => {
  if (!currentAddress?.expiresAt) return 0;
  const elapsedMs = currentTime - currentAddress.expiresAt;
  return Math.max(0, Math.floor(elapsedMs / (1000 * 60)));
});

const renewalFailureAgoMinutes = $derived.by(() => {
  const failedAt = currentAddress?.lastFailureAt;
  if (typeof failedAt !== 'number' || failedAt <= 0) return 0;
  return Math.max(0, Math.floor((currentTime - failedAt) / (1000 * 60)));
});

const archivedAgoMinutes = $derived.by(() => {
  const archivedAt = currentAddress?.archivedAt ?? currentAddress?.lastFailureAt;
  if (typeof archivedAt !== 'number' || archivedAt <= 0) return renewalFailureAgoMinutes;
  return Math.max(0, Math.floor((currentTime - archivedAt) / (1000 * 60)));
});

const renewalRetryMinutes = $derived.by(() => {
  const nextRetryAt = currentAddress?.nextRetryAt;
  if (typeof nextRetryAt !== 'number' || nextRetryAt <= currentTime) return remainingMinutes;
  return Math.ceil((nextRetryAt - currentTime) / (1000 * 60));
});

// Format expired-ago duration
function formatTimeAgo(minutes: number): string {
  if (minutes < 60) {
    return $t(
      pluralKey({ oneKey: 'time.minutesAgo', otherKey: 'time.minutesAgoPlural' }, minutes),
      { values: { n: minutes } }
    );
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const duration = mins
    ? $t('time.durationHM', { values: { h: hours, m: mins } })
    : $t('time.durationH', { values: { h: hours } });
  return $t('time.durationAgo', { values: { duration } });
}

// Calculate progress percentage for expiry (0-100).
const progressPercentage = $derived.by(() => {
  // Inactive lifecycle states show a completed ring; only a live, finite
  // expiry uses a time-based fraction.
  if (currentLifecycleStatus !== 'active') return 100;
  if (currentAddress?.autoExtend) {
    try {
      const config = loadProviderConfig(currentAddress.provider);
      if (config.expiry?.renewable || config.capabilities?.supportsRenew) return 100;
    } catch {
      // Unknown providers retain the finite expiry display.
    }
  }
  if (!currentAddress?.expiresAt) return 100;
  if (!currentAddress.createdAt) {
    const maxExpiryTime = 60;
    return Math.min(Math.max((remainingMinutes / maxExpiryTime) * 100, 0), 100);
  }
  // Each successful renewal starts a fresh expiry window. `createdAt` remains
  // the inbox's original creation time, so using it after renewal makes the
  // remaining arc look nearly empty even when most of the renewed window is
  // still available.
  const lastRenewalAt = currentAddress.lastRenewalAt;
  const periodStartedAt =
    typeof lastRenewalAt === 'number' &&
    Number.isFinite(lastRenewalAt) &&
    lastRenewalAt > 0 &&
    lastRenewalAt < currentAddress.expiresAt
      ? lastRenewalAt
      : currentAddress.createdAt;
  const totalDuration = currentAddress.expiresAt - periodStartedAt;
  const remaining = currentAddress.expiresAt - currentTime;
  if (totalDuration <= 0) return 0;
  return Math.min(Math.max((remaining / totalDuration) * 100, 0), 100);
});

/**
 * Pill border path. LTR (reversed=false): starts at the top-left transition
 * and runs clockwise - identical winding to the previous <rect>. RTL
 * (reversed=true): starts at the top-right transition and runs
 * counterclockwise, so the ring - including the progress arc direction - is a
 * true horizontal mirror of the LTR ring.
 */
function buildPillPath(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  reversed: boolean
): string {
  const rx = Math.max(0, Math.min(r, w / 2));
  const ry = Math.max(0, Math.min(r, h / 2));
  const commands = reversed
    ? [
        `M ${x + w - rx} ${y}`,
        `H ${x + rx}`,
        `A ${rx} ${ry} 0 0 0 ${x} ${y + ry}`,
        `V ${y + h - ry}`,
        `A ${rx} ${ry} 0 0 0 ${x + rx} ${y + h}`,
        `H ${x + w - rx}`,
        `A ${rx} ${ry} 0 0 0 ${x + w} ${y + h - ry}`,
        `V ${y + ry}`,
        `A ${rx} ${ry} 0 0 0 ${x + w - rx} ${y}`,
        'Z',
      ]
    : [
        `M ${x + rx} ${y}`,
        `H ${x + w - rx}`,
        `A ${rx} ${ry} 0 0 1 ${x + w} ${y + ry}`,
        `V ${y + h - ry}`,
        `A ${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}`,
        `H ${x + rx}`,
        `A ${rx} ${ry} 0 0 1 ${x} ${y + h - ry}`,
        `V ${y + ry}`,
        `A ${rx} ${ry} 0 0 1 ${x + rx} ${y}`,
        'Z',
      ];
  return commands.join(' ');
}

// SVG progress border - computed reactively
let containerEl = $state<HTMLElement | null>(null);
// Mirror of progressPercentage so deferred callbacks (ResizeObserver/RAF) read
// a $state snapshot instead of the $derived after teardown (`derived_inert`).
let progressPct = $state(0);

function layout() {
  if (!containerEl) return;
  const w = containerEl.clientWidth;
  const h = containerEl.clientHeight;
  if (w < 4 || h < 4) return;
  const r = h / 2;
  const inset = 1;
  const rectW = Math.max(0, w - inset * 2);
  const rectH = Math.max(0, h - inset * 2);
  const radius = Math.max(0, r - inset);
  /** Length of the top straight edge (between the two rounded ends), in px. */
  const topEdgeLengthPx = Math.max(0, rectW - 2 * radius);

  const isRtl =
    typeof document !== 'undefined' &&
    (document.documentElement.dir === 'rtl' ||
      getComputedStyle(document.documentElement).direction === 'rtl');

  const trackPath = containerEl.querySelector('svg path.track') as SVGPathElement | null;
  const progressPath = containerEl.querySelector('svg path.progress') as SVGPathElement | null;
  const notch = containerEl.querySelector('.notch') as HTMLElement | null;

  // Keep long lifecycle messages inside the straight top edge. If the locale's
  // wording is longer than that space, scroll it slowly while preserving the
  // complete text in the DOM for assistive technology.
  if (notch) {
    notch.style.maxWidth = `${topEdgeLengthPx}px`;
    notch.style.overflow = 'hidden';
  }

  const pillPathD = buildPillPath(inset, inset, rectW, rectH, radius, isRtl);
  if (trackPath && progressPath) {
    for (const path of [trackPath, progressPath]) {
      path.setAttribute('d', pillPathD);
    }
  }

  const notchWidthPx = notch ? notch.getBoundingClientRect().width : 0;
  if (notch) {
    const overflowPx = Math.max(0, notch.scrollWidth - notch.clientWidth);
    const shouldScroll = overflowPx > 2;
    notch.dataset.ticker = shouldScroll ? 'true' : 'false';
    notch.style.setProperty('--ticker-distance', `${overflowPx}px`);
    notch.style.setProperty('--ticker-duration', `${Math.max(6, overflowPx / 14)}s`);
    notch.title = notch.querySelector('[data-optical-text]')?.textContent?.trim() ?? '';
  }
  // Notch anchor (matches the reference prototype): the notch's LEFT edge is
  // pinned exactly at the curve -> straight transition point (path length 0),
  // so its center sits half its own width past the transition - no extra
  // pixel offset. The no-SVG fallback positions in container pixels, where
  // the transition is at `inset + radius`.
  const rawNotchCenterPx = isRtl
    ? w - (inset + radius + notchWidthPx / 2)
    : inset + radius + notchWidthPx / 2;
  const minCenter = inset + radius + notchWidthPx / 2;
  const maxCenter = w - (inset + radius + notchWidthPx / 2);
  const notchCenterPx = Math.max(minCenter, Math.min(maxCenter, rawNotchCenterPx));
  // Notch center as a distance along the SVG path (path length 0 = the
  // transition the path starts at: top-left for LTR, top-right for RTL).
  // The LTR path starts at the top-left transition and runs clockwise; the RTL
  // path starts at its exact mirror (the top-right transition) and runs
  // counterclockwise - so the SAME distance puts the notch, the gap, and the
  // arc start at the mirror position in RTL. No direction branching is needed
  // here; the winding lives in the path `d` built above.
  const notchCenterOnPathPx = Math.max(0, Math.min(topEdgeLengthPx, notchWidthPx / 2));

  if (!progressPath) {
    if (notch) {
      const opticalOffset = computeOpticalCenterOffset(notch);
      // The screenshot review shows mathematically centered glyph ink still
      // reads a touch high against the 1px capsule stroke. Add a small
      // sub-pixel downward optical correction for the rendered text.
      const statusLabelOpticalBias = 0.75;
      const verticalOffset = (opticalOffset + statusLabelOpticalBias).toFixed(2);
      notch.style.left = `${notchCenterPx}px`;
      notch.style.right = 'auto';
      // The CSS border's content-box edge and the SVG path use this same inset.
      notch.style.top = `${inset}px`;
      notch.style.transform = `translate(-50%, calc(-50% + ${verticalOffset}px))`;
    }
    return;
  }

  const totalLengthPx = progressPath.getTotalLength();
  if (!totalLengthPx) return;

  const centerPoint = progressPath.getPointAtLength(
    Math.min(totalLengthPx, Math.max(0, notchCenterOnPathPx))
  );
  if (notch) {
    const opticalOffset = computeOpticalCenterOffset(notch);
    // Match the no-SVG fallback: the measured ink center looks slightly high
    // against the capsule stroke without this small visual calibration.
    const statusLabelOpticalBias = 0.75;
    const verticalOffset = (opticalOffset + statusLabelOpticalBias).toFixed(2);
    notch.style.left = `${centerPoint.x}px`;
    notch.style.right = 'auto';
    notch.style.top = `${centerPoint.y}px`;
    notch.style.transform = `translate(-50%, calc(-50% + ${verticalOffset}px))`;
  }

  const notchLengthPercent = notchWidthPx > 0 ? (notchWidthPx / totalLengthPx) * 100 : 0;

  const notchCenterPercent = (notchCenterOnPathPx / totalLengthPx) * 100;
  const notchEnd = notchCenterPercent + 0.5 * notchLengthPercent;
  const availablePercent = Math.max(0, 100 - notchLengthPercent);

  if (trackPath) {
    trackPath.setAttribute('stroke-dasharray', `${availablePercent} ${notchLengthPercent}`);
    trackPath.setAttribute('stroke-dashoffset', String(-notchEnd));
  }

  if (progressPath) {
    const remainingFraction = Math.max(0, Math.min(1, progressPct / 100));
    const drawLength = remainingFraction * availablePercent;
    // Progress arc starts exactly where the notch gap ends (same anchor as the
    // track), and its length is a fraction of the non-notch `availablePercent`
    // - matching the reference prototypes. The dash pattern begins at the
    // notch's far edge and recedes forward as remaining time shrinks.
    progressPath.setAttribute('stroke-dasharray', `${drawLength} ${100 - drawLength}`);
    progressPath.setAttribute('stroke-dashoffset', String(-notchEnd));
  }
}

let resizeObserver: ResizeObserver | null = null;
$effect(() => {
  if (containerEl) {
    resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(layout);
    });
    resizeObserver.observe(containerEl);
  }
  return () => {
    if (resizeObserver) {
      resizeObserver.disconnect();
    }
  };
});

$effect(() => {
  progressPct = progressPercentage;
  void currentAddress;
  void remainingMinutes;
  void expiredAgoMinutes;
  void $t;
  if (containerEl) {
    requestAnimationFrame(() => {
      layout();
      requestAnimationFrame(layout);
    });
  }
});

$effect(() => {
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    document.fonts.ready.then(() => {
      if (containerEl) {
        requestAnimationFrame(layout);
      }
    });
  }
});

// Copy email address to clipboard
async function copyEmailToClipboard() {
  try {
    await copyToClipboardAndSchedulePurge(selectedEmail);
  } catch (err) {
    logError('Failed to copy email', err);
  }
}

let clickTimeout: ReturnType<typeof setTimeout> | null = null;
onDestroy(() => {
  if (clickTimeout) clearTimeout(clickTimeout);
  // A late storage read must not write the snooze bell into an unmounted bar.
  loadSnoozeGeneration++;
});
let triggerElement: HTMLElement | null = null;

function handleSingleClick() {
  if (clickTimeout) {
    clearTimeout(clickTimeout);
    clickTimeout = null;
  }
  clickTimeout = setTimeout(() => {
    triggerElement = document.activeElement as HTMLElement;
    onDropdownOpenChange(!dropdownOpen);
    clickTimeout = null;
  }, 250);
}

function handleDoubleClick() {
  if (clickTimeout) {
    clearTimeout(clickTimeout);
    clickTimeout = null;
  }
  copyEmailToClipboard();
  showToast($t('toasts.emailAddressCopied'));
}

function openAddressMenu(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
  triggerElement = e.currentTarget as HTMLElement;
  onDropdownOpenChange(true);
}

function onPillPointerDown(e: PointerEvent) {
  if (!gesturesEnabled) return;
  if ((e.target as HTMLElement)?.closest?.('button')) return;
  pillSwiping = true;
  pillSwipeStartX = e.clientX;
}

function onPillPointerUp(e: PointerEvent) {
  if (!gesturesEnabled || !pillSwiping) return;
  pillSwiping = false;
  const dx = e.clientX - pillSwipeStartX;
  if (Math.abs(dx) < 48) return;
  const isRtl =
    typeof document !== 'undefined' &&
    (document.documentElement.dir === 'rtl' ||
      getComputedStyle(document.documentElement).direction === 'rtl');
  const goNext = isRtl ? dx > 0 : dx < 0;
  if (goNext) goToNext();
  else goToPrev();
}

let loadSnoozeGeneration = 0;

async function loadSnooze() {
  // Generation token: a slow read (cold-start mirror hydration, storage stall)
  // must not paint a stale address's snooze over the one now selected -
  // flipping addresses fast used to let the FIRST read resolve LAST and win.
  const generation = ++loadSnoozeGeneration;
  const addr = selectedEmail || currentAddress?.address || '';
  if (!addr) {
    snoozeUntil = 0;
    return;
  }
  // Anti-flash: sync-first via the shared prefs mirror - the bell badge is
  // correct at first paint when the mirror is warm.
  const warmMap = peekStoredJsonSync<Record<string, number>>('notificationSnoozeByAddress');
  if (warmMap) {
    const until = warmMap[addr] || warmMap[addr.toLowerCase()] || 0;
    snoozeUntil = until > Date.now() ? until : 0;
    return;
  }
  try {
    const res = (await browser.storage.local.get(['notificationSnoozeByAddress'])) as {
      notificationSnoozeByAddress?: Record<string, number>;
    };
    if (generation !== loadSnoozeGeneration) return;
    const map = res.notificationSnoozeByAddress || {};
    const until = map[addr] || map[addr.toLowerCase()] || 0;
    snoozeUntil = until > Date.now() ? until : 0;
  } catch {
    /* ignore */
    if (generation === loadSnoozeGeneration) snoozeUntil = 0;
  }
}

async function applyBellSnooze(ms: number) {
  const addr = selectedEmail || currentAddress?.address || '';
  if (!addr) return;
  const until = Date.now() + ms;
  let saved = false;
  try {
    // Serialized RMW: this map is written from BOTH snooze surfaces (this bar
    // and the mailbox's snooze menu), so a whole-key write of a map read before
    // the other surface's write landed erased that address's snooze.
    const next = await updateStoredObject(
      'notificationSnoozeByAddress',
      (current) => ({ ...current, [addr]: until }),
      parseNumberRecord
    );
    updateStoredJsonMirror('notificationSnoozeByAddress', next);
    snoozeUntil = until;
    saved = true;
  } catch (error) {
    logError('Failed to save notification snooze', error);
    selectedSnoozeOption = null;
    showToast($t('toasts.operationFailed'), 'error');
  }
  if (saved) notifSnoozeOpen = false;
}

async function applyCustomSnooze() {
  const min = Math.max(0, Number(snoozeCustomMin) || 0);
  const hrs = Math.max(0, Number(snoozeCustomHrs) || 0);
  const days = Math.max(0, Number(snoozeCustomDays) || 0);
  const ms = ((days * 24 + hrs) * 60 + min) * 60 * 1000;
  if (ms <= 0) return;
  await applyBellSnooze(ms);
}

async function clearBellSnooze() {
  const addr = selectedEmail || currentAddress?.address || '';
  if (!addr) return;
  let cleared = false;
  try {
    // Serialized RMW - same pair as applyBellSnooze, and both casings of the
    // address are removed from the map storage last held.
    const next = await updateStoredObject(
      'notificationSnoozeByAddress',
      (current) => {
        const map = { ...current };
        delete map[addr];
        delete map[addr.toLowerCase()];
        return map;
      },
      parseNumberRecord
    );
    updateStoredJsonMirror('notificationSnoozeByAddress', next);
    snoozeUntil = 0;
    cleared = true;
  } catch (error) {
    logError('Failed to clear notification snooze', error);
    showToast($t('toasts.operationFailed'), 'error');
  }
  if (cleared) notifSnoozeOpen = false;
}

$effect(() => {
  void selectedEmail;
  void loadSnooze();
});

/**
 * Persist the domain index mirror-first (the anti-flash contract). On failure
 * the sync mirror is returned to the PRE-WRITE index so the UI and storage
 * cannot diverge - the mirror is never re-read once hydrated, so a
 * disagreement would survive navigation and reload-within-session. Storage
 * itself needs no rollback: a rejected `set` leaves the previous value in
 * place, which is exactly `rollbackIndex`. Returns false when the write
 * failed; callers own any UI rollback and user-facing reporting.
 */
async function persistDomainIndex(
  key: ReturnType<typeof getDomainStorageKey>,
  index: number,
  rollbackIndex: number
): Promise<boolean> {
  updateStoredJsonMirror(key, index);
  try {
    await writeWithRetry({ [key]: index });
    return true;
  } catch (err) {
    logError('Failed to persist domain index', err);
    updateStoredJsonMirror(key, rollbackIndex);
    return false;
  }
}

// Cycle through provider domains and persist selection. The persistence is
// awaited BEFORE the optimistic flip: if the write fails, the pill and the
// index keep their previous values and only a failure toast is shown - the
// previous code flipped first, so a rejected write left the UI on a domain
// storage never kept, with the mirror agreeing with the UI and disagreeing
// with storage.
async function cycleDomain() {
  if (!currentAddress) return;
  const providerConfig = loadProviderConfig(currentAddress.provider);
  if (!providerConfig.multiDomain?.enabled) return;
  const domains = providerConfig.multiDomain.domains;
  const prevIndex = currentDomainIndex;
  const nextIndex = (currentDomainIndex + 1) % domains.length;
  const key = getDomainStorageKey(selectedEmail, currentAddress.provider);
  if (!(await persistDomainIndex(key, nextIndex, prevIndex))) {
    showToast($t('addressView.domainChangeFailed'), 'error');
    return;
  }
  const uname = selectedEmail.split('@')[0];
  const prevAddr = displayedEmail || selectedEmail;
  const nextAddr = `${uname}@${domains[nextIndex]}`;
  displayedEmail = nextAddr;
  // The persisted domain index is a surface mutation: it landed, so every undo
  // offered before it (delete/archive/import/domain-switch elsewhere) is stale
  // - and the undo THIS toast carries is created under the new revision.
  let undoRevision: string;
  try {
    undoRevision = await markAddressMutation();
  } catch (error) {
    logError('Failed to persist domain-change undo generation', error);
    showToast($t('errors.storageWriteFailed'), 'error');
    return;
  }
  showToast(
    $t('toasts.domainChanged', { values: { from: prevAddr, to: nextAddr } }),
    'success',
    async () => {
      // A newer surface mutation landed while this toast was up: this undo's
      // captured prevIndex no longer describes storage. Say so instead of
      // walking the newer state back.
      if (!(await isUndoCurrent(undoRevision))) {
        showToast($t('toasts.undoSuperseded'), 'warning');
        return;
      }
      currentDomainIndex = prevIndex;
      displayedEmail = prevAddr;
      if (!(await persistDomainIndex(key, prevIndex, nextIndex))) {
        // The revert did not stick: storage kept the cycled domain, so the UI
        // follows it back instead of diverging.
        currentDomainIndex = nextIndex;
        displayedEmail = nextAddr;
        showToast($t('addressView.domainChangeFailed'), 'error');
      }
    }
  );
}
</script>

<!-- Custom dropdown trigger pill -->
<div class="relative mt-0 flex items-center gap-1" data-tour="account-selector">
  <div
    class="account-selector-outer relative flex-1 min-w-0 bg-md-surface-container-low rounded-full touch-pan-y"
    role="group"
    aria-label={$t('address.selectEmail')}
    bind:this={containerEl}
    onpointerdown={onPillPointerDown}
    onpointerup={onPillPointerUp}
    onpointercancel={() => (pillSwiping = false)}
  >
    {#if currentAddress && currentLifecycleStatus !== 'deleted'}
      <svg class="absolute inset-0 w-full h-full pointer-events-none" style="overflow:visible; z-index:0;">
        <path
          class="track"
          fill="none"
          stroke={currentLifecycleStatus === 'archived' ? 'var(--md-tertiary)' : 'var(--md-error)'}
          stroke-opacity={progressPercentage === 100 ? 0 : 0.85}
          stroke-width="2.5"
          pathLength="100"
          d=""
        ></path>
        <path
          class="progress"
          fill="none"
          stroke={currentLifecycleStatus === 'active'
            ? 'var(--md-primary)'
            : currentLifecycleStatus === 'archived'
              ? 'var(--md-tertiary)'
              : 'var(--md-error)'}
          stroke-linecap="round"
          stroke-width="2.5"
          pathLength="100"
          d=""
        ></path>
      </svg>
    {/if}
    <div
      style="position:relative; z-index:1;"
      class="flex items-center gap-0 px-1 py-1.5 rounded-full border {currentLifecycleStatus === 'active' ? 'border-transparent' : (currentLifecycleStatus === 'expired' || currentLifecycleStatus === 'deleted') ? 'border-md-error/30' : 'border-md-outline-variant'} {(currentLifecycleStatus === 'expired' || currentLifecycleStatus === 'deleted') ? 'bg-md-error/10' : 'bg-transparent'} flex-1 min-w-0 overflow-hidden"
      onclick={handleSingleClick}
      ondblclick={handleDoubleClick}
      onkeydown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleSingleClick();
        }
      }}
      role="button"
      tabindex="0"
      aria-label={$t('common.copy')}
    >
      <!-- Prev button -->
      <button
        id="button-prev-address"
        class="shrink-0 w-5 h-5 flex items-center justify-center rounded text-md-primary hover:text-md-primary/80 transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
        onclick={(e) => { e.stopPropagation(); goToPrev(); }}
        disabled={currentIndexInStatus <= 0}
        aria-label={$t('address.prevAddress')}
        title={currentIndexInStatus > 0 ? currentStatusAddresses[currentIndexInStatus - 1].address : undefined}
      >
        <Icon name="chevronLeft" class="w-3.5 h-3.5 rtl-flip" />
      </button>

      <!-- Email display -->
      <!-- Email display: NOT a second activation surface. The outer pill owns
        click/double-click/keyboard; handlers here used to fire handleSingleClick
        a second time per click (inner, then bubbled to the outer) and nested
        role=button inside role=button. Keeps its id + tooltip only. -->
      <div
        class="flex items-center min-w-0 flex-1 gap-0.5 cursor-pointer overflow-hidden select-none"
        style="direction: ltr; unicode-bidi: isolate; user-select: none;"
        id="button-select-email"
        title={username && domain
          ? `${String(username).trim()}@${String(domain).trim()}\n${$t('address.tooltipClickOpen')}\n${$t('address.tooltipDoubleTapCopy')}`
          : (selectedEmail || '').replace(/\s+@/g, '@').replace(/@\s+/g, '@')}
      >
        <span class="font-medium text-sm text-md-on-surface truncate min-w-0 select-none pointer-events-none" style="user-select:none;-webkit-user-select:none;">{username}</span>
        {#if isMultiDomain}
          <span
            class="inline-flex items-center gap-1 pe-1 py-0.5 text-xs font-medium rounded-md bg-md-secondary-container text-md-on-secondary-container hover:bg-md-secondary-container/80 active:bg-md-secondary-container/100 transition-colors cursor-pointer overflow-hidden min-w-[calc(5ch+1.5rem)] select-none"
            style="direction: ltr;"
            title={(multiDomainList || []).map((d) => `@${d}`).join('\n') || $t('address.cycleDomain')}
            onclick={(e) => { e.stopPropagation(); cycleDomain(); }}
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); cycleDomain(); } }}
            role="button"
            tabindex="0"
            aria-label={$t('address.cycleDomain')}
          >
            <span class="truncate flex-1 min-w-0 select-none">@{domain}</span>
            <Icon name="globe" class="w-3 h-3 shrink-0" />
          </span>
        {:else}
          <span class="font-medium text-sm text-md-on-surface shrink-0 select-none pointer-events-none">@{domain}</span>
        {/if}
      </div>

      <!-- +N badge -->
      {#if liveAddressesCount > 1}
        <Badge variant="primary" size="sm" class="shrink-0 font-semibold" label={$t('common.plusN', { values: { n: liveAddressesCount - 1 } })} />
      {/if}

      <!-- Next button -->
      <button
        id="button-next-address"
        class="shrink-0 w-5 h-5 flex items-center justify-center rounded text-md-primary hover:text-md-primary/80 transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
        onclick={(e) => { e.stopPropagation(); goToNext(); }}
        disabled={currentIndexInStatus >= currentStatusAddresses.length - 1}
        aria-label={$t('address.nextAddress')}
        title={currentIndexInStatus < currentStatusAddresses.length - 1 ? currentStatusAddresses[currentIndexInStatus + 1].address : undefined}
      >
        <Icon name="chevronRight" class="w-3.5 h-3.5 rtl-flip" />
      </button>

      <!-- Separator -->
      <span class="w-px h-4 bg-md-secondary-container/20 shrink-0"></span>

      <!-- Dropdown chevron -->
      <button
        id="button-open-dropdown"
        class="shrink-0 p-0.5 text-md-primary hover:text-md-primary/80 transition-colors"
        onclick={(e) => { e.stopPropagation(); onDropdownOpenChange(!dropdownOpen); }}
        oncontextmenu={openAddressMenu}
        aria-label={$t('address.openAddressList')}
      >
        <Icon name="chevronDown" class="w-4 h-4" />
      </button>
    </div>

    {#if currentAddress && currentLifecycleStatus !== 'deleted'}
      <div
        class="notch absolute z-[2] pointer-events-none whitespace-nowrap px-0.5 text-xs font-medium tracking-wide leading-none inline-flex items-center justify-center text-center select-none {currentLifecycleStatus === 'active' ? 'text-md-success' : currentLifecycleStatus === 'expired' ? 'text-md-error' : 'text-md-on-surface/50'}"
        style="top: 1px; transform: translate(-50%, -50%);"
      >
        {#if currentLifecycleStatus === 'active'}
          <span class="inline-block w-1.5 h-1.5 rounded-full bg-md-success me-1 ring-2 ring-md-success/15"></span>
        {/if}
        <span data-optical-text>
          {#if renewalInProgress}
            {@const pcfg = (() => { try { return loadProviderConfig(currentAddress.provider); } catch { return null; } })()}
            {#if pcfg?.expiry?.renewalLabel === 'autoExtend'}
              {$t('address.statusExtending')}
            {:else}
              {$t('address.statusRenewing')}
            {/if}
          {:else if currentLifecycleStatus === 'active'}
            {#if currentAddress.expiresAt}
              {@const pcfg = (() => { try { return loadProviderConfig(currentAddress.provider); } catch { return null; } })()}
              {@const renewable = !!(pcfg?.expiry?.renewable || pcfg?.capabilities?.supportsRenew)}
              {@const renewalLabel = pcfg?.expiry?.renewalLabel ?? 'autoRenew'}
              {$t('address.statusLive')} · {#if renewable && currentAddress.autoExtend && renewalLabel === 'autoExtend'}
                {$t('address.autoExtendIn', { values: { time: formatDurationRemaining(remainingMinutes) } })}
              {:else if renewable && currentAddress.autoExtend}
                {$t('address.autoRenewIn', { values: { time: formatDurationRemaining(remainingMinutes) } })}
              {:else}
                {$t('address.expiresIn', { values: { time: formatDurationRemaining(remainingMinutes) } })}
              {/if}
            {:else}
              {$t('address.statusLive')} · <span aria-hidden="true">∞</span> {$t('address.statusNoExpiry')}
            {/if}
          {:else if currentLifecycleStatus === 'expired'}
            {$t('address.expiredStatus')} {formatTimeAgo(expiredAgoMinutes)}
          {:else if currentAddress.accountStatus === 'archived' && !currentAddress.expiresAt}
            {$t('address.statusArchivedNoExpiry')}
          {:else if currentAddress.archiveReason === 'auto-renew-failed' && currentAddress.lastFailureAt && currentAddress.autoExtend && currentAddress.nextRetryAt}
            {$t('address.statusAutoArchivedRenewFailedRetry', { values: { failedTime: formatTimeAgo(archivedAgoMinutes), retryTime: formatDurationRemaining(renewalRetryMinutes) } })}
          {:else if currentAddress.archiveReason === 'auto-extend-failed' && currentAddress.lastFailureAt && currentAddress.autoExtend && currentAddress.nextRetryAt}
            {$t('address.statusAutoArchivedExtendFailedRetry', { values: { failedTime: formatTimeAgo(archivedAgoMinutes), retryTime: formatDurationRemaining(renewalRetryMinutes) } })}
          {:else if currentAddress.archiveReason === 'manual' && currentAddress.autoExtend && currentAddress.lastFailureAt && currentAddress.nextRetryAt}
            {@const pcfg = (() => { try { return loadProviderConfig(currentAddress.provider); } catch { return null; } })()}
            {@const renewalLabel = pcfg?.expiry?.renewalLabel ?? 'autoRenew'}
            {@const values = { failedTime: formatTimeAgo(archivedAgoMinutes), retryTime: formatDurationRemaining(renewalRetryMinutes) }}
            {#if renewalLabel === 'autoExtend'}
              {$t('address.statusManualExtendFailedRetry', { values })}
            {:else}
              {$t('address.statusManualRenewFailedRetry', { values })}
            {/if}
          {:else if currentAddress.accountStatus === 'archived' && currentAddress.autoExtend}
            {@const pcfg = (() => { try { return loadProviderConfig(currentAddress.provider); } catch { return null; } })()}
            {@const renewalLabel = pcfg?.expiry?.renewalLabel ?? 'autoRenew'}
            {@const time = formatDurationRemaining(renewalRetryMinutes)}
            {#if renewalLabel === 'autoExtend'}
              {$t('address.statusArchivedAutoExtendIn', { values: { time } })}
            {:else}
              {$t('address.statusArchivedAutoRenewIn', { values: { time } })}
            {/if}
          {:else if currentAddress.archiveReason === 'expired'}
            {@const pcfg = (() => { try { return loadProviderConfig(currentAddress.provider); } catch { return null; } })()}
            {@const renewable = !!(pcfg?.expiry?.renewable || pcfg?.capabilities?.supportsRenew) && !!pcfg?.expiry?.renewalMethod}
            {@const renewalLabel = pcfg?.expiry?.renewalLabel ?? 'autoRenew'}
            {#if renewable && renewalLabel === 'autoExtend'}
              {$t('address.statusAutoArchivedExpiredEnableExtend', { values: { time: formatTimeAgo(expiredAgoMinutes) } })}
            {:else if renewable}
              {$t('address.statusAutoArchivedExpiredEnableRenew', { values: { time: formatTimeAgo(expiredAgoMinutes) } })}
            {:else}
              {$t('address.statusAutoArchivedExpired', { values: { time: formatTimeAgo(expiredAgoMinutes) } })}
            {/if}
          {:else if currentAddress.archiveReason === 'auto-renew-failed' && currentAddress.lastFailureAt}
            {$t('address.statusAutoArchivedRenewFailed', { values: { time: formatTimeAgo(archivedAgoMinutes) } })}
          {:else if currentAddress.archiveReason === 'auto-extend-failed' && currentAddress.lastFailureAt}
            {$t('address.statusAutoArchivedExtendFailed', { values: { time: formatTimeAgo(archivedAgoMinutes) } })}
          {:else if currentAddress.archiveReason === 'manual' && currentAddress.expiresAt && currentAddress.expiresAt <= currentTime}
            {@const pcfg = (() => { try { return loadProviderConfig(currentAddress.provider); } catch { return null; } })()}
            {@const renewable = !!(pcfg?.expiry?.renewable || pcfg?.capabilities?.supportsRenew) && !!pcfg?.expiry?.renewalMethod}
            {@const renewalLabel = pcfg?.expiry?.renewalLabel ?? 'autoRenew'}
            {#if renewable && renewalLabel === 'autoExtend'}
              {$t('address.statusArchivedExpiredEnableExtend', { values: { time: formatTimeAgo(expiredAgoMinutes) } })}
            {:else if renewable}
              {$t('address.statusArchivedExpiredEnableRenew', { values: { time: formatTimeAgo(expiredAgoMinutes) } })}
            {:else}
              {$t('address.statusArchived')} · {$t('address.expiredStatus')} {formatTimeAgo(expiredAgoMinutes)}
            {/if}
          {:else if currentAddress.expiresAt && currentAddress.expiresAt > currentTime}
            {$t('address.statusArchivedExpiresIn', { values: { time: formatDurationRemaining(remainingMinutes) } })}
          {:else if !currentAddress.expiresAt}
            {$t('address.statusArchivedNoExpiry')}
          {:else}
            {$t('address.statusArchived')}
          {/if}
          <span data-optical-baseline aria-hidden="true" class="inline-block w-0 h-0 align-baseline"></span>
        </span>
      </div>
    {/if}
  </div>

  <!-- Notifications bell -->
  <div class="relative shrink-0">
    <button
      id="button-account-notifications"
      class="relative w-8 h-8 flex items-center justify-center rounded-full border-0 shrink-0 transition-colors {notificationsEnabled ? 'bg-md-warning/20 hover:bg-md-warning/30 active:bg-md-warning/40' : 'bg-md-surface-variant/40 hover:bg-md-surface-variant active:bg-md-surface-variant/80'} {snoozeUntil > Date.now() ? 'ring-1 ring-md-primary/40' : ''}"
      aria-label={notificationsEnabled ? $t('inbox.disableNotifications') : $t('inbox.enableNotifications')}
      title={notificationsEnabled ? $t('inbox.disableNotifications') : $t('inbox.enableNotifications')}
      oncontextmenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        notifSnoozeOpen = !notifSnoozeOpen;
        void loadSnooze();
      }}
      onclick={(e) => {
        e.stopPropagation();
        onToggleNotifications();
      }}
    >
      <Icon name={notificationsEnabled ? 'notifications' : 'notificationsOff'} class="w-4 h-4 {notificationsEnabled ? 'text-md-warning' : 'text-md-on-surface/50'}" />
    </button>
    {#if notifSnoozeOpen}
      <button type="button" class="fixed inset-0 {PORTAL_Z_CLASS.accountSelector} cursor-default bg-transparent" aria-label={$t('common.close')} onclick={() => (notifSnoozeOpen = false)}></button>
      <div use:anchoredFlyout={{ placement: 'bottom-end', onClose: () => { notifSnoozeOpen = false; } }} class="absolute top-full end-0 mt-1 {PORTAL_Z_CLASS.menu} min-w-[292px] max-w-[min(340px,90vw)] rounded-xl border border-md-outline-variant bg-md-surface-container {ELEVATION.level2} overflow-hidden p-2" role="menu">
        <div class="px-1 py-1 text-sm font-semibold text-md-on-surface">{$t('inbox.snoozeNotifications')}</div>
        <p class="px-1 pb-2 text-xs text-md-on-surface/40 truncate max-w-full" style="direction:ltr">{selectedEmail}</p>

        <div class="grid grid-cols-4 rounded-xl border border-md-outline-variant/50 overflow-hidden" role="group" aria-label={$t('inbox.snoozeNotifications')}>
          <button
            type="button"
            class="min-w-0 px-1.5 py-2 text-xs font-semibold whitespace-nowrap transition-colors {selectedSnoozeOption === '5m' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface text-md-on-surface hover:bg-md-surface-variant active:brightness-95'}"
            role="menuitemradio"
            aria-checked={selectedSnoozeOption === '5m'}
            onclick={() => { selectedSnoozeOption = '5m'; void applyBellSnooze(5 * 60 * 1000); }}
          >{$t('inbox.snooze5m')}</button>
          <button
            type="button"
            class="min-w-0 px-1.5 py-2 text-xs font-semibold whitespace-nowrap border-s border-md-outline-variant/50 transition-colors {selectedSnoozeOption === '30m' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface text-md-on-surface hover:bg-md-surface-variant active:brightness-95'}"
            role="menuitemradio"
            aria-checked={selectedSnoozeOption === '30m'}
            onclick={() => { selectedSnoozeOption = '30m'; void applyBellSnooze(30 * 60 * 1000); }}
          >{$t('inbox.snooze30m')}</button>
          <button
            type="button"
            class="min-w-0 px-1.5 py-2 text-xs font-semibold whitespace-nowrap border-s border-md-outline-variant/50 transition-colors {selectedSnoozeOption === '1d' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface text-md-on-surface hover:bg-md-surface-variant active:brightness-95'}"
            role="menuitemradio"
            aria-checked={selectedSnoozeOption === '1d'}
            onclick={() => { selectedSnoozeOption = '1d'; void applyBellSnooze(24 * 60 * 60 * 1000); }}
          >{$t('inbox.snooze1d')}</button>
          <button
            type="button"
            class="min-w-0 px-1.5 py-2 text-xs font-semibold whitespace-nowrap border-s border-md-outline-variant/50 transition-colors {selectedSnoozeOption === 'custom' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface text-md-on-surface hover:bg-md-surface-variant active:brightness-95'}"
            role="menuitemradio"
            aria-checked={selectedSnoozeOption === 'custom'}
            aria-expanded={selectedSnoozeOption === 'custom'}
            onclick={() => (selectedSnoozeOption = 'custom')}
          >{$t('inbox.snoozeCustom')}</button>
        </div>

        {#if selectedSnoozeOption === 'custom'}
          <div class="mt-2 rounded-xl border border-md-outline-variant/40 bg-md-surface-container-low p-2.5" role="group" aria-label={$t('inbox.snoozeCustom')}>
            <div class="grid grid-cols-3 gap-2">
              <label class="min-w-0 text-sm text-md-on-surface-variant">
                <span class="block mb-1 truncate">{$t('inbox.snoozeUnitMin')}</span>
                <input type="number" min="0" max="999" bind:value={snoozeCustomMin} class="w-full px-2 py-1.5 text-sm rounded-lg bg-md-surface border border-md-outline-variant/50 tabular-nums outline-none focus:border-md-primary focus:ring-1 focus:ring-md-primary/40" aria-label={$t('inbox.snoozeCustomMin')} />
              </label>
              <label class="min-w-0 text-sm text-md-on-surface-variant">
                <span class="block mb-1 truncate">{$t('inbox.snoozeUnitHrs')}</span>
                <input type="number" min="0" max="999" bind:value={snoozeCustomHrs} class="w-full px-2 py-1.5 text-sm rounded-lg bg-md-surface border border-md-outline-variant/50 tabular-nums outline-none focus:border-md-primary focus:ring-1 focus:ring-md-primary/40" aria-label={$t('inbox.snoozeCustomHrs')} />
              </label>
              <label class="min-w-0 text-sm text-md-on-surface-variant">
                <span class="block mb-1 truncate">{$t('inbox.snoozeUnitDays')}</span>
                <input type="number" min="0" max="365" bind:value={snoozeCustomDays} class="w-full px-2 py-1.5 text-sm rounded-lg bg-md-surface border border-md-outline-variant/50 tabular-nums outline-none focus:border-md-primary focus:ring-1 focus:ring-md-primary/40" aria-label={$t('inbox.snoozeCustomDays')} />
              </label>
            </div>
            <Btn variant="primary" size="sm" class="w-full mt-2" role="menuitem" onclick={() => void applyCustomSnooze()}>{$t('common.apply')}</Btn>
          </div>
        {/if}

        {#if snoozeUntil > Date.now()}
          <div class="border-t border-md-outline-variant/40 mt-2 pt-1"></div>
          <button type="button" class="w-full text-start px-2 min-h-10 rounded-lg text-sm font-medium text-md-primary hover:bg-md-surface-variant active:brightness-95 transition-colors" role="menuitem" onclick={() => { selectedSnoozeOption = null; void clearBellSnooze(); }}>{$t('inbox.clearSnooze')}</button>
        {/if}
      </div>
    {/if}
  </div>
</div>

<!-- Extracted Overlay Dialog Component -->
<AddressSelectorOverlay
  open={dropdownOpen}
  onClose={() => onDropdownOpenChange(false)}
  {selectedEmail}
  {accounts}
  {allAddresses}
  {onSelectAddress}
  {onEditAddress}
  {onCreateAddress}
  {onNavigateToManage}
  {onReloadAddresses}
  {onToggleAutoExtend}
  {onArchiveAddress}
  {onUnarchiveAddress}
  {onRemoveAddress}
  {onRestoreAddress}
  {onTagAddress}
  {onManageTags}
  {onMarkAllRead}
  {onMarkAllUnread}
  {showToast}
/>

<style>
  .account-selector-outer {
    position: relative;
    display: flex;
    border-radius: 9999px;
  }

  :global(.notch[data-ticker='true'] [data-optical-text]) {
    display: inline-block;
    width: max-content;
    animation: address-status-ticker var(--ticker-duration, 8s) ease-in-out infinite alternate;
  }

  @keyframes address-status-ticker {
    0%,
    18% {
      transform: translateX(0);
    }
    82%,
    100% {
      transform: translateX(calc(-1 * var(--ticker-distance, 0px)));
    }
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.notch[data-ticker='true'] [data-optical-text]) {
      animation: none;
    }
  }
</style>
