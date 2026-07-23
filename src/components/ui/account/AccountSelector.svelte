<script lang="ts">
import { onDestroy, tick, untrack } from 'svelte';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import Icon from '@/components/icons/Icon.svelte';
import TagDialog from '@/components/overlays/TagDialog.svelte';
import FaviconImage from '@/components/ui/FaviconImage.svelte';
import { updateInboxTag, updateInboxTags } from '@/features/account/tag-actions.js';
import {
  canAutoRenew,
  isArchived as isAccountArchivedStatus,
  isDeleted as isAccountDeletedStatus,
  isExpiredNotArchived,
  isTimeExpired,
  resolveDragLifecycleAction,
} from '@/utils/account-status.js';
import { accountMatchesTagSearch, accountTagsList } from '@/utils/account-tags.js';
import {
  DEFAULT_PROVIDER,
  loadAllProviderConfigs,
  loadProviderConfig,
  type ProviderConfig,
} from '@/utils/email-service.js';
import { fitButtonsLabelFont } from '@/utils/fit-label-font.js';
import { setupFocusTrap } from '@/utils/focusTrap.js';
import { logError } from '@/utils/logger.js';
import {
  collectIntersectingIds,
  isInteractiveTarget,
  MARQUEE_THRESHOLD,
  normalizeMarquee,
} from '@/utils/marquee-selection.js';
import { domainIndexKey, getInboxes } from '@/utils/storage-keys.js';
import { useCurrentTime } from '@/utils/time-store.js';
import type { Account } from '@/utils/types.js';
import AccountCard from './AccountCard.svelte';

let {
  selectedEmail = '',
  accounts = [],
  allAccounts = [],
  displayedEmail = $bindable(''),
  onSelectAccount = () => {},
  onEditAccount = () => {},
  onCreateInbox = () => {},
  onNavigateToManage = () => {},
  onReloadAccounts = async () => {},
  onNavigateToSettings = () => {},
  onCreateInboxWithProvider = () => {},
  onToggleAutoExtend = () => {},
  onArchiveAccount = () => {},
  onUnarchiveAccount = () => {},
  onRemoveAccount = () => {},
  onRestoreAccount = () => {},
  onTagAccount = () => {},
  onMarkAllRead = async (_account: Account) => {},
  onMarkAllUnread = async (_account: Account) => {},
  dropdownOpen = false,
  onDropdownOpenChange = () => {},
  showToast = (_message: string, _type?: string, _undo?: (() => void | Promise<void>) | null) => {},
  selectedProviderInstance = null,
  defaultDomain = '',
  /** Notifications control (moved from search row; create is footer FAB) */
  notificationsEnabled = true,
  onToggleNotifications = () => {},
  /** Swipe left/right on pill for next/prev when gestures enabled */
  gesturesEnabled = true,
} = $props<{
  selectedEmail?: string;
  accounts?: Account[];
  allAccounts?: Account[];
  displayedEmail?: string;
  onSelectAccount?: (address: string) => void;
  onEditAccount?: (account: Account) => void;
  onCreateInbox?: (provider?: string, instanceId?: string) => void;
  onNavigateToManage?: () => void;
  onReloadAccounts?: () => Promise<void>;
  onNavigateToSettings?: () => void;
  onCreateInboxWithProvider?: (providerId: string, instanceId?: string) => void;
  onToggleAutoExtend?: (account: Account) => void;
  onArchiveAccount?: (account: Account) => void;
  onUnarchiveAccount?: (account: Account) => void;
  onRemoveAccount?: (address: string) => void;
  onRestoreAccount?: (address: string) => void;
  onTagAccount?: (account: Account) => void;
  onMarkAllRead?: (account: Account) => void | Promise<void>;
  onMarkAllUnread?: (account: Account) => void | Promise<void>;
  dropdownOpen?: boolean;
  onDropdownOpenChange?: (open: boolean) => void;
  showToast?: (message: string, type?: string, undo?: (() => void | Promise<void>) | null) => void;
  selectedProviderInstance?: string | null;
  defaultDomain?: string;
  notificationsEnabled?: boolean;
  onToggleNotifications?: () => void;
  gesturesEnabled?: boolean;
}>();

let openSection = $state<'live' | 'inactive'>('live');
let prevLiveCount = -1;
let prevInactiveCount = -1;
/** Dynamic font for sticky Create / Manage action labels */
let stickyActionFontPx = $state(12);
let stickyActionsEl = $state<HTMLElement | null>(null);

function fitStickyActionFonts() {
  if (!stickyActionsEl) return;
  const buttons = Array.from(stickyActionsEl.querySelectorAll<HTMLElement>('button'));
  if (!buttons.length) return;
  stickyActionFontPx = fitButtonsLabelFont(buttons, 'span.btn-label, span.whitespace-nowrap', {
    basePx: 12,
    minPx: 8.5,
    weight: 600,
    reservedPx: 40,
  });
}

$effect(() => {
  void $t;
  void dropdownOpen;
  if (!dropdownOpen) return;
  void tick().then(() => {
    fitStickyActionFonts();
    requestAnimationFrame(fitStickyActionFonts);
  });
});
let tabDropTarget = $state<'live' | 'inactive' | null>(null);
let crossTabPrompt = $state<{
  direction: 'toInactive' | 'toLive' | 'toLiveRenew';
  account: Account;
} | null>(null);
/** Marquee multi-select inside account selector */
let selectorSelectedIds = $state<Set<string>>(new Set());
let marqueeActive = $state(false);
let marqueeStart = $state<{ x: number; y: number } | null>(null);
let marqueeRect = $state<{ left: number; top: number; right: number; bottom: number } | null>(null);
let listScrollEl = $state<HTMLElement | null>(null);
/** Confirm dialog for strip action drops (archive/delete/tag/auto-renew) */
let actionDropPrompt = $state<{
  action: 'archive' | 'delete' | 'tag' | 'autoRenew';
  account: Account;
} | null>(null);
let stripDropTarget = $state<'archive' | 'delete' | 'tag' | 'autoRenew' | null>(null);

$effect(() => {
  const liveCount = accountsByCategory.live.length;
  const inactiveCount = accountsByCategory.available.length + accountsByCategory.unavailable.length;
  if (prevLiveCount !== -1) {
    if (liveCount < prevLiveCount && inactiveCount > prevInactiveCount) {
      openSection = 'inactive';
    } else if (inactiveCount < prevInactiveCount && liveCount > prevLiveCount) {
      openSection = 'live';
    }
  }
  prevLiveCount = liveCount;
  prevInactiveCount = inactiveCount;
});
let inactiveTab = $state<'available' | 'unavailable'>('available');
let availableCollapsed = $state(false);
let unavailableCollapsed = $state(false);
let selectedTagFilter = $state<string | null>(null);
let dropdownSearch = $state('');
let tagDialogOpen = $state(false);
let tagTargetAccount = $state<Account | null>(null);
let draggedAccount = $state<Account | null>(null);
let draggedFromSection = $state<'live' | 'inactive' | null>(null);
let dropTargetAccount = $state<Account | null>(null);
let localAccountOrder = $state<Account[] | null>(null);
let domainMenuOpen = $state(false);
let domainMenuPosition = $state({ x: 0, y: 0 });
let currentDomainIndex = $state(0);
let notifSnoozeOpen = $state(false);
let snoozeUntil = $state(0);
let snoozeCustomMin = $state(0);
let snoozeCustomHrs = $state(0);
let snoozeCustomDays = $state(0);
let pillSwipeStartX = 0;
let pillSwiping = false;
let activeAccountIndex = $state(0);
let searchInputRef = $state<HTMLInputElement | null>(null);

// Derived values for email display
let emailParts = $derived.by(() => displayedEmail.split('@'));
let username = $derived.by(() => emailParts[0] || '');
let domain = $derived.by(() => emailParts[1] || '');
let multiDomainList = $derived.by((): string[] => {
  const account = allAccounts.find((a: Account) => a.address === selectedEmail);
  if (!account) return [];
  try {
    const cfg = loadProviderConfig(account.provider);
    if (!cfg.multiDomain?.enabled) return [];
    return (cfg.multiDomain.domains || []).filter(Boolean);
  } catch {
    return [];
  }
});
let isMultiDomain = $derived(multiDomainList.length > 1);

// Storage key for domain index per inbox
function getDomainStorageKey(email: string, providerId: string): `domainIndex_${string}_${string}` {
  return domainIndexKey(providerId, email.split('@')[0]);
}

// Load persisted domain index when selected email changes and update displayedEmail atomically.
// Compare via untrack so writing bindable displayedEmail cannot re-enter this effect.
$effect(() => {
  if (!selectedEmail) {
    untrack(() => {
      if (displayedEmail !== '') displayedEmail = '';
    });
    return;
  }
  const account = allAccounts.find((a: Account) => a.address === selectedEmail);
  if (!account) {
    currentDomainIndex = 0;
    untrack(() => {
      if (displayedEmail !== selectedEmail) displayedEmail = selectedEmail;
    });
    return;
  }
  const providerConfig = loadProviderConfig(account.provider);
  if (!providerConfig.multiDomain?.enabled) {
    currentDomainIndex = 0;
    untrack(() => {
      if (displayedEmail !== selectedEmail) displayedEmail = selectedEmail;
    });
    return;
  }
  const key = getDomainStorageKey(selectedEmail, account.provider);
  let isCurrent = true;
  browser.storage.local.get([key]).then((result: Record<string, unknown>) => {
    if (!isCurrent) return;
    const storedIndex = result[key] as number | undefined;
    let resolvedIndex = 0;
    if (storedIndex !== undefined) {
      resolvedIndex = storedIndex;
    } else if (defaultDomain) {
      const domains = providerConfig.multiDomain?.domains || [];
      const defaultIndex = domains.indexOf(defaultDomain);
      resolvedIndex = defaultIndex >= 0 ? defaultIndex : 0;
    }
    currentDomainIndex = resolvedIndex;
    const username = selectedEmail.split('@')[0];
    const domains = providerConfig.multiDomain?.domains || [];
    const next = `${username}@${domains[resolvedIndex] || domains[0] || ''}`;
    untrack(() => {
      if (displayedEmail !== next) displayedEmail = next;
    });
  });
  return () => {
    isCurrent = false;
  };
});

// Use shared time store
const timeStore = useCurrentTime();
let currentTime = $state(timeStore.currentTime);

// Subscribe to time updates
$effect(() => {
  const unsubscribe = timeStore.subscribe(() => {
    currentTime = timeStore.currentTime;
  });
  return unsubscribe;
});

// Wrap callbacks to clear cache before actions
const wrappedOnArchiveAccount = (account: Account) => {
  localAccountOrder = null;
  onArchiveAccount(account);
};

const wrappedOnUnarchiveAccount = (account: Account) => {
  localAccountOrder = null;
  onUnarchiveAccount(account);
};

const wrappedOnRemoveAccount = (address: string) => {
  localAccountOrder = null;
  onRemoveAccount(address);
};

const wrappedOnRestoreAccount = (address: string) => {
  localAccountOrder = null;
  onRestoreAccount(address);
};

// Calculate remaining time for current account
const remainingMinutes = $derived.by(() => {
  if (!currentAccount?.expiresAt) return 0;
  const remainingMs = currentAccount.expiresAt - currentTime;
  return Math.max(0, Math.ceil(remainingMs / (1000 * 60)));
});

// Calculate how long ago the account expired (in minutes)
const expiredAgoMinutes = $derived.by(() => {
  if (!currentAccount?.expiresAt) return 0;
  const elapsedMs = currentTime - currentAccount.expiresAt;
  return Math.max(0, Math.floor(elapsedMs / (1000 * 60)));
});

// Format expired-ago duration
function formatTimeAgo(minutes: number): string {
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}hr ${mins}m ago` : `${hours}hr ago`;
}

// Calculate progress percentage for expiry (0-100).
// When auto-renew is enabled, always show a full progress ring.
const progressPercentage = $derived.by(() => {
  if (currentAccount?.autoExtend) return 100;
  if (!currentAccount?.expiresAt) return 100; // Show 100% when no expiry
  if (!currentAccount.createdAt) {
    const maxExpiryTime = 60; // Default 60 minutes for full progress
    return Math.min(Math.max((remainingMinutes / maxExpiryTime) * 100, 0), 100);
  }
  const totalDuration = currentAccount.expiresAt - currentAccount.createdAt;
  const remaining = currentAccount.expiresAt - currentTime;
  if (totalDuration <= 0) return 0;
  return Math.min(Math.max((remaining / totalDuration) * 100, 0), 100);
});

// SVG progress border - computed reactively
let containerEl = $state<HTMLElement | null>(null);

function layout() {
  if (!containerEl) return;
  const w = containerEl.clientWidth;
  const h = containerEl.clientHeight;
  // Not laid out yet (0×0) — skip; negative SVG rect attrs crash the browser
  if (w < 4 || h < 4) return;
  const r = h / 2;
  const inset = 1;
  const rectW = Math.max(0, w - inset * 2);
  const rectH = Math.max(0, h - inset * 2);
  const radius = Math.max(0, r - inset);

  const track = containerEl.querySelector('svg rect.track') as SVGRectElement | null;
  const progressRect = containerEl.querySelector('svg rect.progress') as SVGRectElement | null;
  const notch = containerEl.querySelector('.notch') as HTMLElement | null;

  if (track && progressRect) {
    for (const rect of [track, progressRect]) {
      rect.setAttribute('x', String(inset));
      rect.setAttribute('y', String(inset));
      rect.setAttribute('width', String(rectW));
      rect.setAttribute('height', String(rectH));
      rect.setAttribute('rx', String(radius));
      rect.setAttribute('ry', String(radius));
    }
  }

  const isRtl =
    typeof document !== 'undefined' &&
    (document.documentElement.dir === 'rtl' ||
      getComputedStyle(document.documentElement).direction === 'rtl');
  // Place status near the “start” of the pill (left in LTR, right in RTL)
  const targetFromStart = 35;

  if (!progressRect) {
    // If progressRect isn't active/rendered, position the notch at fallback
    if (notch) {
      notch.style.left = isRtl ? 'auto' : `${targetFromStart}px`;
      notch.style.right = isRtl ? `${targetFromStart}px` : 'auto';
      notch.style.top = '0px';
      notch.style.transform = isRtl ? 'translate(15%, -50%)' : 'translate(-15%, -50%)';
    }
    return;
  }

  const totalLengthPx = progressRect.getTotalLength();
  if (!totalLengthPx) return;

  // Position of the notch center along the path (mirror for RTL)
  const targetX = isRtl ? w - targetFromStart : targetFromStart;
  const notchCenterPx = Math.max(0, isRtl ? targetX + r * 0 : Math.max(0, targetX - r));

  const centerPoint = progressRect.getPointAtLength(
    Math.min(totalLengthPx, Math.max(0, isRtl ? totalLengthPx - (w - targetX) : notchCenterPx))
  );
  if (notch) {
    // Use physical left from path point; flip transform anchor for RTL
    notch.style.left = `${centerPoint.x}px`;
    notch.style.right = 'auto';
    notch.style.top = `${centerPoint.y}px`;
    notch.style.transform = isRtl ? 'translate(-85%, -50%)' : 'translate(-15%, -50%)';
  }

  const notchWidthPx = notch ? notch.getBoundingClientRect().width : 0;
  const notchLengthPercent = notchWidthPx > 0 ? (notchWidthPx / totalLengthPx) * 100 : 0;

  const notchCenterPercent = (notchCenterPx / totalLengthPx) * 100;
  // Offset the gap start and end by -15% / +85% to match the transform: translate(-15%, -50%) shift set by the user
  const notchStart = notchCenterPercent - 0.15 * notchLengthPercent;
  const notchEnd = notchCenterPercent + 0.85 * notchLengthPercent;
  const availablePercent = 100 - notchLengthPercent;

  if (track) {
    track.setAttribute('stroke-dasharray', `${availablePercent} ${notchLengthPercent}`);
    track.setAttribute('stroke-dashoffset', String(-notchEnd));
  }

  if (progressRect) {
    const elapsedFraction = progressPercentage / 100;
    const drawLength = elapsedFraction * availablePercent;
    progressRect.setAttribute('stroke-dasharray', `${drawLength} ${100 - drawLength}`);
    // Start drawing at notchEnd (where the text ends) and shrink towards it, matching the prototype direction exactly
    progressRect.setAttribute('stroke-dashoffset', String(-notchEnd));
  }
}

// ResizeObserver to run layout on container size changes
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

// Reactively trigger layout when state changes
$effect(() => {
  void progressPercentage;
  void currentAccount;
  if (containerEl) {
    requestAnimationFrame(layout);
  }
});

// Format time duration with hours if applicable
function formatTimeRemaining(minutes: number): string {
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

function removePortalOverlay() {
  try {
    const el =
      overlayHost ||
      (typeof document !== 'undefined'
        ? (document.querySelector('.account-selector-overlay') as HTMLElement | null)
        : null);
    if (el?.parentElement === document.body) el.remove();
  } catch {
    /* ignore */
  }
  overlayHost = null;
}

function closeDropdown() {
  dropdownSearch = '';
  actionDropPrompt = null;
  crossTabPrompt = null;
  removePortalOverlay();
  onDropdownOpenChange(false);
  // Return focus to trigger element
  if (triggerElement) {
    triggerElement.focus();
    triggerElement = null;
  }
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') closeDropdown();
  // Focus trap: prevent Tab from leaving the dialog
  if (e.key === 'Tab') {
    const focusableElements = document.querySelectorAll(
      '#account-selector-dialog button, #account-selector-dialog input, #account-selector-dialog [tabindex]:not([tabindex="-1"])'
    );
    const firstElement = focusableElements[0] as HTMLElement;
    const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

    if (e.shiftKey) {
      // Shift+Tab: if on first element, move to last
      if (document.activeElement === firstElement) {
        e.preventDefault();
        lastElement?.focus();
      }
    } else {
      // Tab: if on last element, move to first
      if (document.activeElement === lastElement) {
        e.preventDefault();
        firstElement?.focus();
      }
    }
  }
}

// Auto-focus search input when dialog opens
$effect(() => {
  if (dropdownOpen) {
    // Small delay to ensure DOM is updated
    setTimeout(() => {
      searchInputRef?.focus();
    }, 50);
  }
});

// Portal overlay to document.body so header/footer stacking never covers it
let overlayHost = $state<HTMLElement | null>(null);
$effect(() => {
  if (!dropdownOpen) {
    removePortalOverlay();
    return;
  }
  // Wait a tick for DOM
  const id = requestAnimationFrame(() => {
    const el = document.querySelector('.account-selector-overlay') as HTMLElement | null;
    if (!el) return;
    overlayHost = el;
    if (el.parentElement !== document.body) {
      document.body.appendChild(el);
    }
  });
  return () => cancelAnimationFrame(id);
});

// Always strip portaled overlay on unmount (e.g. navigate to Addresses)
onDestroy(() => {
  removePortalOverlay();
});

// Load providers dynamically
let allProviders = $derived.by((): ProviderConfig[] => {
  try {
    return Object.values(loadAllProviderConfigs());
  } catch {
    return [];
  }
});

function toggleSection(section: 'live' | 'inactive') {
  openSection = section;
}

// Filter accounts by search (address or tag)
let filteredAccounts = $derived.by(() => {
  // Only use localAccountOrder during active drag (draggedAccount !== null), otherwise always use fresh allAccounts
  const source =
    draggedAccount !== null && localAccountOrder !== null ? localAccountOrder : allAccounts;
  if (!dropdownSearch) return source;
  const search = dropdownSearch.toLowerCase();
  return source.filter(
    (a: Account) => a.address.toLowerCase().includes(search) || accountMatchesTagSearch(a, search)
  );
});

// Filter accounts by tag
let tagFilteredAccounts = $derived.by(() => {
  if (!selectedTagFilter) return filteredAccounts;
  return filteredAccounts.filter((a: Account) => {
    if (selectedTagFilter === 'archived') return a.status === 'archived';
    if (selectedTagFilter === 'deleted') return a.status === 'deleted';
    if (selectedTagFilter === 'expired') return a.status === 'expired';
    return false;
  });
});

// Copy email address to clipboard
async function copyEmailToClipboard() {
  try {
    await navigator.clipboard.writeText(selectedEmail);
  } catch (err) {
    logError('Failed to copy email', err);
  }
}

let clickTimeout: ReturnType<typeof setTimeout> | null = null;
onDestroy(() => {
  if (clickTimeout) clearTimeout(clickTimeout);
});
let triggerElement: HTMLElement | null = null;
let dialogRef = $state<HTMLElement | null>(null);
let cleanupFocusTrap: (() => void) | null = null;

$effect(() => {
  if (dropdownOpen) {
    document.body.style.overflow = 'hidden';
    setTimeout(() => {
      if (dialogRef) {
        cleanupFocusTrap = setupFocusTrap(dialogRef);
      }
    }, 50);
  }
  return () => {
    document.body.style.overflow = '';
    if (cleanupFocusTrap) {
      cleanupFocusTrap();
      cleanupFocusTrap = null;
    }
  };
});

function handleSingleClick() {
  if (clickTimeout) {
    clearTimeout(clickTimeout);
    clickTimeout = null;
  }
  clickTimeout = setTimeout(() => {
    // Save trigger element for focus return
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

function openAccountMenu(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
  triggerElement = e.currentTarget as HTMLElement;
  domainMenuOpen = false;
  onDropdownOpenChange(true);
}

function openDomainMenu(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
  const target = e.currentTarget as HTMLElement | null;
  const rect = target?.getBoundingClientRect();
  const menuW = 180;
  const isRtl =
    typeof document !== 'undefined' &&
    (document.documentElement.dir === 'rtl' ||
      getComputedStyle(document.documentElement).direction === 'rtl');
  let x: number;
  if (rect) {
    // Anchor under the + button; flip horizontally in RTL
    x = isRtl ? rect.right - menuW : rect.left;
    x = Math.max(8, Math.min(x, window.innerWidth - menuW - 8));
    domainMenuPosition = { x, y: rect.bottom + 6 };
  } else {
    x = isRtl ? e.clientX - 20 : e.clientX - menuW + 20;
    domainMenuPosition = {
      x: Math.max(8, Math.min(x, window.innerWidth - menuW - 8)),
      y: e.clientY + 12,
    };
  }
  domainMenuOpen = true;
}

// Helper to check if account can be recoverable
function isRecoverable(account: Account): boolean {
  const currentTime = Date.now();
  const expiresAt = account.expiresAt || currentTime;
  const isExpired = currentTime >= expiresAt;

  // Not expired = recoverable
  if (!isExpired) return true;
  // Expired but has auto-renew = recoverable
  if (account.autoExtend) return true;
  // Expired, no auto-renew, but provider supports auto-renew = recoverable (so user can enable it)
  try {
    const config = loadProviderConfig(account.provider);
    if (config.expiry?.renewable) return true;
  } catch {
    // If config fails to load, treat as not recoverable
  }
  // Otherwise unrecoverable
  return false;
}

// Group accounts by new categorization (Live, Available, Unavailable)
let accountsByCategory = $derived.by(() => {
  const live: Account[] = [];
  const available: Account[] = [];
  const unavailable: Account[] = [];

  tagFilteredAccounts.forEach((a: Account) => {
    const currentTime = Date.now();
    const expiresAt = a.expiresAt || currentTime;
    const isExpired = currentTime >= expiresAt;

    // Live: status is 'active' and not expired
    if (a.status === 'active' && !isExpired) {
      live.push(a);
    } else {
      // Inactive: everything else (archived, deleted, expired, or no status)
      if (isRecoverable(a)) {
        available.push(a);
      } else {
        unavailable.push(a);
      }
    }
  });

  // Don't sort - preserve storage order for drag-and-drop reordering
  // live.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  // available.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  // unavailable.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  return { live, available, unavailable };
});

// Reactive derived value for current account
let currentAccount = $derived.by(() => {
  if (!selectedEmail) return null;
  return allAccounts.find((a: Account) => a.address === selectedEmail) || null;
});

// Accounts of same status as current account for prev/next navigation
let currentStatusAccounts = $derived.by(() => {
  if (!selectedEmail) return [];
  const current = allAccounts.find((a: Account) => a.address === selectedEmail);
  if (!current) return [];
  return allAccounts.filter((a: Account) => a.status === current.status);
});

let currentIndexInStatus = $derived.by(() => {
  if (!selectedEmail) return -1;
  return currentStatusAccounts.findIndex((a: Account) => a.address === selectedEmail);
});

function goToPrev() {
  if (currentIndexInStatus > 0) {
    onSelectAccount(currentStatusAccounts[currentIndexInStatus - 1].address);
  }
}

function goToNext() {
  if (currentIndexInStatus < currentStatusAccounts.length - 1) {
    onSelectAccount(currentStatusAccounts[currentIndexInStatus + 1].address);
  }
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
  // RTL: flip swipe direction
  const isRtl =
    typeof document !== 'undefined' &&
    (document.documentElement.dir === 'rtl' ||
      getComputedStyle(document.documentElement).direction === 'rtl');
  const goNext = isRtl ? dx > 0 : dx < 0; // swipe L←R next in LTR
  if (goNext) goToNext();
  else goToPrev();
}

async function loadSnooze() {
  const addr = selectedEmail || currentAccount?.address || '';
  if (!addr) {
    snoozeUntil = 0;
    return;
  }
  try {
    const res = (await browser.storage.local.get(['notificationSnoozeByAddress'])) as {
      notificationSnoozeByAddress?: Record<string, number>;
    };
    const map = res.notificationSnoozeByAddress || {};
    const until = map[addr] || map[addr.toLowerCase()] || 0;
    snoozeUntil = until > Date.now() ? until : 0;
  } catch {
    snoozeUntil = 0;
  }
}

async function applyBellSnooze(ms: number) {
  const addr = selectedEmail || currentAccount?.address || '';
  if (!addr) return;
  const until = Date.now() + ms;
  try {
    const res = (await browser.storage.local.get(['notificationSnoozeByAddress'])) as {
      notificationSnoozeByAddress?: Record<string, number>;
    };
    const map = { ...(res.notificationSnoozeByAddress || {}) };
    map[addr] = until;
    await browser.storage.local.set({ notificationSnoozeByAddress: map });
    snoozeUntil = until;
  } catch {
    /* ignore */
  }
  notifSnoozeOpen = false;
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
  const addr = selectedEmail || currentAccount?.address || '';
  if (!addr) return;
  try {
    const res = (await browser.storage.local.get(['notificationSnoozeByAddress'])) as {
      notificationSnoozeByAddress?: Record<string, number>;
    };
    const map = { ...(res.notificationSnoozeByAddress || {}) };
    delete map[addr];
    delete map[addr.toLowerCase()];
    await browser.storage.local.set({ notificationSnoozeByAddress: map });
    snoozeUntil = 0;
  } catch {
    /* ignore */
  }
  notifSnoozeOpen = false;
}

$effect(() => {
  void selectedEmail;
  void loadSnooze();
});

async function updateTag(accountId: string, tag: string, color: string | undefined = undefined) {
  await updateInboxTag(accountId, tag, browser, { onReloadAccounts }, color);
}

function openTagDialog() {
  if (!currentAccount) return;
  tagTargetAccount = currentAccount;
  tagDialogOpen = true;
}

function openTagDialogForAccount(account: Account) {
  tagTargetAccount = account;
  tagDialogOpen = true;
}

function closeTagDialog() {
  tagDialogOpen = false;
  tagTargetAccount = null;
}

function saveTag(tag: string, color: string) {
  if (!tagTargetAccount) return;
  updateTag(tagTargetAccount.id, tag, color);
  closeTagDialog();
}

function saveTags(tags: Array<{ name: string; color: string }>) {
  if (!tagTargetAccount) return;
  void updateInboxTags(tagTargetAccount.id, tags, browser, { onReloadAccounts });
  closeTagDialog();
}

// Drag and drop handlers — keep a sticky ref so drop works even if dragend races
let lastDraggedAccount: Account | null = null;

function handleDragStart(e: DragEvent, account: Account) {
  draggedAccount = account;
  lastDraggedAccount = account;
  draggedFromSection = openSection;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('text/plain', account.id);
    e.dataTransfer.setData('application/x-account-id', account.id);
  }
}

function resolveDraggedAccount(e?: DragEvent): Account | null {
  const fromState = draggedAccount || lastDraggedAccount;
  if (fromState) return fromState;
  const id =
    e?.dataTransfer?.getData('application/x-account-id') ||
    e?.dataTransfer?.getData('text/plain') ||
    '';
  if (!id) return null;
  return allAccounts.find((a: Account) => a.id === id) || null;
}

function handleDragEnd() {
  draggedAccount = null;
  draggedFromSection = null;
  dropTargetAccount = null;
  tabDropTarget = null;
  stripDropTarget = null;
  // Delay clearing sticky ref so drop handlers that race after dragend still see it
  setTimeout(() => {
    lastDraggedAccount = null;
  }, 50);
}

function isAccountArchived(a: Account): boolean {
  return isAccountArchivedStatus(a);
}
function isAccountDeleted(a: Account): boolean {
  return isAccountDeletedStatus(a);
}
function isAccountExpired(a: Account): boolean {
  return isTimeExpired(a) || a.status === 'expired' || isExpiredNotArchived(a);
}
function providerSupportsRenew(a: Account): boolean {
  return canAutoRenew(a);
}

/** Drop account onto Live / Inactive tab labels (archive/delete/restore/renew dialogs). */
function handleTabDrop(tab: 'live' | 'inactive', e?: DragEvent) {
  tabDropTarget = null;
  const account = resolveDraggedAccount(e);
  if (!account) return;
  handleDragEnd();
  const action = resolveDragLifecycleAction(account, tab);
  if (action === 'noop') return;
  if (action === 'error_no_renew') {
    showToast($t('account.cannotActivateExpiredNoRenew'));
    return;
  }
  if (action === 'archive') {
    crossTabPrompt = { direction: 'toInactive', account };
    return;
  }
  if (action === 'renew' || action === 'unarchive_and_renew') {
    crossTabPrompt = { direction: 'toLiveRenew', account };
    return;
  }
  if (action === 'unarchive') {
    crossTabPrompt = { direction: 'toLive', account };
  }
}

function applyTabDropToLiveRenew() {
  const account = crossTabPrompt?.account;
  crossTabPrompt = null;
  if (!account) return;
  // Enable auto-renew so background renewal can bring it back to live
  if (!account.autoExtend) onToggleAutoExtend(account);
}

/**
 * Strip drop: run actions immediately.
 * Delete/archive/tag already open their own confirm/dialog UIs — no extra prompt.
 * Auto-renew toggles in place.
 */
function handleActionStripDrop(action: 'archive' | 'delete' | 'tag' | 'autoRenew', e?: DragEvent) {
  stripDropTarget = null;
  const account = resolveDraggedAccount(e);
  if (!account) return;
  handleDragEnd();
  if (action === 'archive') wrappedOnArchiveAccount(account);
  else if (action === 'delete') wrappedOnRemoveAccount(account.address);
  else if (action === 'tag') openTagDialogForAccount(account);
  else if (action === 'autoRenew') onToggleAutoExtend(account);
}

function applyActionDrop() {
  const p = actionDropPrompt;
  actionDropPrompt = null;
  if (!p) return;
  if (p.action === 'archive') wrappedOnArchiveAccount(p.account);
  else if (p.action === 'delete') wrappedOnRemoveAccount(p.account.address);
  else if (p.action === 'tag') openTagDialogForAccount(p.account);
  else if (p.action === 'autoRenew') onToggleAutoExtend(p.account);
}

function applyTabDropToInactive(action: 'archive' | 'delete') {
  const account = crossTabPrompt?.account;
  crossTabPrompt = null;
  if (!account) return;
  if (action === 'archive') {
    wrappedOnArchiveAccount(account);
  } else {
    wrappedOnRemoveAccount(account.address);
  }
}

function applyTabDropToLive(action: 'unarchive' | 'restore') {
  const account = crossTabPrompt?.account;
  crossTabPrompt = null;
  if (!account) return;
  if (action === 'unarchive') {
    wrappedOnUnarchiveAccount(account);
  } else {
    wrappedOnRestoreAccount(account.address);
  }
}

// ---- Marquee multi-select ----
function onListMarqueeDown(e: PointerEvent) {
  if (e.button !== 0) return;
  if (isInteractiveTarget(e.target)) return;
  const root = e.currentTarget as HTMLElement | null;
  if (!root) return;
  listScrollEl = root;
  marqueeStart = { x: e.clientX, y: e.clientY };
  marqueeActive = false;
  marqueeRect = null;
  const onMove = (ev: PointerEvent) => {
    if (!marqueeStart) return;
    const dx = Math.abs(ev.clientX - marqueeStart.x);
    const dy = Math.abs(ev.clientY - marqueeStart.y);
    if (!marqueeActive && dx < MARQUEE_THRESHOLD && dy < MARQUEE_THRESHOLD) return;
    marqueeActive = true;
    marqueeRect = normalizeMarquee(marqueeStart, { x: ev.clientX, y: ev.clientY });
    if (listScrollEl) {
      const ids = collectIntersectingIds(listScrollEl, '[data-marquee-id]', marqueeRect);
      selectorSelectedIds = new Set(ids);
    }
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    marqueeStart = null;
    marqueeActive = false;
    marqueeRect = null;
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

// Cycle through provider domains and persist selection
async function cycleDomain() {
  if (!currentAccount) return;
  const providerConfig = loadProviderConfig(currentAccount.provider);
  if (!providerConfig.multiDomain?.enabled) return;
  const domains = providerConfig.multiDomain.domains;
  const prevIndex = currentDomainIndex;
  const nextIndex = (currentDomainIndex + 1) % domains.length;
  currentDomainIndex = nextIndex;
  const key = getDomainStorageKey(selectedEmail, currentAccount.provider);
  await browser.storage.local.set({ [key]: nextIndex });
  // Also update displayedEmail immediately
  const username = selectedEmail.split('@')[0];
  const prevAddr = displayedEmail || selectedEmail;
  const nextAddr = `${username}@${domains[nextIndex]}`;
  displayedEmail = nextAddr;
  showToast(
    $t('toasts.domainChanged', { values: { from: prevAddr, to: nextAddr } }),
    'success',
    async () => {
      // Undo: restore previous domain index + display
      currentDomainIndex = prevIndex;
      await browser.storage.local.set({ [key]: prevIndex });
      displayedEmail = prevAddr;
    }
  );
}

function handleDragOver(e: DragEvent, targetAccount: Account) {
  e.preventDefault();
  dropTargetAccount = targetAccount;
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move';
  }
}

async function handleDrop(e: DragEvent, targetAccount: Account, section: 'live' | 'inactive') {
  e.preventDefault();
  dropTargetAccount = null;
  if (!draggedAccount || draggedAccount.id === targetAccount.id) return;

  // Only allow reordering within the same section
  if (draggedFromSection !== section) return;

  const sourceDragged = draggedAccount;
  handleDragEnd();

  try {
    const inboxes = await getInboxes();
    const sourceIndex = inboxes.findIndex((i: Account) => i.id === sourceDragged.id);
    if (sourceIndex === -1) return;

    // Filter out sourceDragged
    const filteredInboxes = inboxes.filter((i: Account) => i.id !== sourceDragged.id);
    const targetIndex = filteredInboxes.findIndex((i: Account) => i.id === targetAccount.id);

    if (targetIndex === -1) {
      logError('Drag-drop: could not find target account ID in storage', {
        sourceId: sourceDragged.id,
        targetId: targetAccount.id,
      });
      return;
    }

    // Insert sourceDragged back at targetIndex
    filteredInboxes.splice(targetIndex, 0, sourceDragged);

    // Optimistically reorder local display immediately
    const currentSource = localAccountOrder ?? allAccounts;
    const filteredLocal = currentSource.filter((a: Account) => a.id !== sourceDragged.id);
    const localTargetIdx = filteredLocal.findIndex((a: Account) => a.id === targetAccount.id);
    if (localTargetIdx !== -1) {
      filteredLocal.splice(localTargetIdx, 0, sourceDragged);
      localAccountOrder = filteredLocal;
    }

    await browser.storage.local.set({ inboxes: filteredInboxes });
    await onReloadAccounts();
    // Clear local override after parent state is updated
    localAccountOrder = null;
  } catch (error) {
    logError('Failed to reorder accounts', error);
    localAccountOrder = null;
  }
}
</script>


  <!-- Custom dropdown trigger -->
  <div class="relative mt-0 flex items-center gap-1" data-tour="account-selector">
    <div
      class="account-selector-outer relative flex-1 min-w-0 bg-md-surface-container-low rounded-full touch-pan-y"
      role="group"
      aria-label={$t('account.selectEmail')}
      bind:this={containerEl}
      onpointerdown={onPillPointerDown}
      onpointerup={onPillPointerUp}
      onpointercancel={() => (pillSwiping = false)}
    >
      {#if currentAccount && (currentAccount.status === 'active' || currentAccount.autoExtend)}
        <svg class="absolute inset-0 w-full h-full pointer-events-none" style="overflow:visible; z-index:0;">
          <rect class="track" fill="none" stroke="var(--md-error)" stroke-opacity="0.3" stroke-width="2" pathLength="100"></rect>
          <rect
            class="progress"
            fill="none"
            stroke={currentAccount.autoExtend ? 'var(--md-tertiary, var(--md-primary))' : 'var(--md-primary)'}
            stroke-linecap="round"
            stroke-width="2.5"
            pathLength="100"
          ></rect>
        </svg>
      {/if}
      <div
        style="position:relative; z-index:1;"
        class="flex items-center gap-0 px-1 py-1.5 rounded-full border {currentAccount?.status === 'active' ? 'border-transparent' : (currentAccount?.status === 'expired' || currentAccount?.status === 'deleted') ? 'border-md-error/30' : 'border-md-outline-variant'} {(currentAccount?.status === 'expired' || currentAccount?.status === 'deleted') ? 'bg-md-error/10' : 'bg-transparent'} flex-1 min-w-0 overflow-hidden"
        onclick={handleSingleClick}
        ondblclick={handleDoubleClick}
        onkeydown={(e) => { if (e.key === 'Enter') handleSingleClick(); }}
        role="button"
        tabindex="0"
        aria-label={$t('common.copy')}
      >
      <!-- Prev button — rtl-flip so arrow points toward previous in both directions -->
      <button
        id="button-prev-address"
        class="shrink-0 w-5 h-5 flex items-center justify-center rounded text-md-primary hover:text-md-primary/80 transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
        onclick={(e) => { e.stopPropagation(); goToPrev(); }}
        disabled={currentIndexInStatus <= 0}
        aria-label={$t('account.prevAddress')}
        title={currentIndexInStatus > 0 ? currentStatusAccounts[currentIndexInStatus - 1].address : undefined}
      >
        <Icon name="chevronLeft" class="w-3.5 h-3.5 rtl-flip" />
      </button>

      <!-- Email always LTR; no text selection (copy via action row) -->
      <div
        class="flex items-center min-w-0 flex-1 gap-0.5 cursor-pointer overflow-hidden select-none"
        style="direction: ltr; unicode-bidi: isolate; user-select: none;"
        onclick={handleSingleClick}
        ondblclick={handleDoubleClick}
        onkeydown={(e) => { if (e.key === 'Enter') handleSingleClick(); }}
        role="button"
        tabindex="0"
        id="button-select-email"
        aria-label={$t('account.selectEmail')}
        title={username && domain
          ? `${String(username).trim()}@${String(domain).trim()}\n${$t('account.tooltipClickOpen')}\n${$t('account.tooltipDoubleTapCopy')}`
          : (selectedEmail || '').replace(/\s+@/g, '@').replace(/@\s+/g, '@')}
      >
        <span class="font-medium text-sm text-md-on-surface truncate min-w-0 select-none pointer-events-none" style="user-select:none;-webkit-user-select:none;">{username}</span>
        {#if isMultiDomain}
          <span
            class="inline-flex items-center gap-1 pe-1 py-0.5 text-xs font-medium rounded-md bg-md-secondary-container text-md-on-secondary-container hover:bg-md-secondary-container/80 transition-colors cursor-pointer overflow-hidden min-w-[calc(5ch+1.5rem)] select-none"
            style="direction: ltr;"
            title={(multiDomainList || []).map((d) => `@${d}`).join('\n') || $t('account.cycleDomain')}
            onclick={(e) => { e.stopPropagation(); cycleDomain(); }}
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); cycleDomain(); } }}
            role="button"
            tabindex="0"
            aria-label={$t('account.cycleDomain')}
          >
            <span class="truncate flex-1 min-w-0 select-none">@{domain}</span>
            <Icon name="globe" class="w-3 h-3 shrink-0" />
          </span>
        {:else}
          <span class="font-medium text-sm text-md-on-surface shrink-0 select-none pointer-events-none">@{domain}</span>
        {/if}
      </div>

      <!-- +N badge - live addresses only (exclude archived/deleted/inactive) -->
      {#if accountsByCategory.live.length > 1}
        <span class="text-xs font-semibold text-md-primary bg-md-primary/15 px-1.5 py-0.5 rounded-full shrink-0">{$t('common.plusN', { values: { n: accountsByCategory.live.length - 1 } })}</span>
      {/if}

      <!-- Next button -->
      <button
        id="button-next-address"
        class="shrink-0 w-5 h-5 flex items-center justify-center rounded text-md-primary hover:text-md-primary/80 transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
        onclick={(e) => { e.stopPropagation(); goToNext(); }}
        disabled={currentIndexInStatus >= currentStatusAccounts.length - 1}
        aria-label={$t('account.nextAddress')}
        title={currentIndexInStatus < currentStatusAccounts.length - 1 ? currentStatusAccounts[currentIndexInStatus + 1].address : undefined}
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
        oncontextmenu={openAccountMenu}
        aria-label={$t('account.openAccountList')}
      >
        <Icon name="chevronDown" class="w-4 h-4" />
      </button>
    </div>
      {#if currentAccount}
        <div
          class="notch absolute z-[2] pointer-events-none whitespace-nowrap bg-transparent px-0 text-xs font-semibold leading-none {currentAccount?.status === 'active' ? 'text-md-success' : (currentAccount?.status === 'expired' || currentAccount?.status === 'deleted') ? 'text-md-error' : 'text-md-on-surface/50'}"
          style="top: 0; transform: translate(-15%, -50%);"
        >
          {#if currentAccount.status === 'active'}
            <span class="inline-block w-1.5 h-1.5 rounded-full bg-md-success me-1 shadow-[0_0_0_3px_rgba(74,222,128,0.15)]"></span>
            {#if currentAccount.expiresAt}
              {@const pcfg = (() => { try { return loadProviderConfig(currentAccount.provider); } catch { return null; } })()}
              {@const renewable = !!(pcfg?.expiry?.renewable || pcfg?.capabilities?.supportsRenew)}
              {$t('account.statusLive')} · {#if renewable && currentAccount.autoExtend}
                {$t('account.autoRenewIn', { values: { time: formatTimeRemaining(remainingMinutes) } })}
              {:else}
                {$t('account.expiresIn', { values: { time: formatTimeRemaining(remainingMinutes) } })}
              {/if}
            {:else}
              {$t('account.statusLive')}
            {/if}
          {:else if currentAccount.status === 'expired'}
            {$t('account.statusExpired')} {formatTimeAgo(expiredAgoMinutes)}
          {:else if currentAccount.status === 'deleted'}
            {$t('account.statusDeleted')}
          {:else}
            {$t('account.statusArchived')}
          {/if}
        </div>
      {/if}
    </div>
    <!-- Notifications: click = toggle; right-click = per-address snooze (NOT provider menu) -->
    <div class="relative shrink-0">
      <button
        id="button-account-notifications"
        class="relative w-8 h-8 flex items-center justify-center rounded-xl border-0 shrink-0 transition-colors {notificationsEnabled ? 'bg-md-warning/20 hover:bg-md-warning/30' : 'bg-md-surface-variant/40 hover:bg-md-surface-variant'} {snoozeUntil > Date.now() ? 'ring-1 ring-md-primary/40' : ''}"
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
        <Icon name={notificationsEnabled ? 'bell' : 'bellOff'} class="w-4 h-4 {notificationsEnabled ? 'text-md-warning' : 'text-md-on-surface/50'}" />
      </button>
      {#if notifSnoozeOpen}
        <button type="button" class="fixed inset-0 z-40 cursor-default bg-transparent" aria-label={$t('common.close')} onclick={() => (notifSnoozeOpen = false)}></button>
        <div class="absolute top-full end-0 mt-1 z-50 min-w-[220px] max-w-[min(280px,90vw)] rounded-xl border border-md-outline-variant bg-md-surface-container shadow-xl overflow-hidden py-1" role="menu">
          <div class="px-3 py-1.5 text-xs font-semibold text-md-on-surface/50 uppercase tracking-wide">{$t('inbox.snoozeNotifications')}</div>
          <p class="px-3 pb-1 text-xs text-md-on-surface/40 truncate max-w-full" style="direction:ltr">{selectedEmail}</p>
          <button type="button" class="w-full text-start px-3 py-2 text-xs hover:bg-md-surface-variant" role="menuitem" onclick={() => void applyBellSnooze(5 * 60 * 1000)}>{$t('inbox.snooze5m')}</button>
          <button type="button" class="w-full text-start px-3 py-2 text-xs hover:bg-md-surface-variant" role="menuitem" onclick={() => void applyBellSnooze(30 * 60 * 1000)}>{$t('inbox.snooze30m')}</button>
          <button type="button" class="w-full text-start px-3 py-2 text-xs hover:bg-md-surface-variant" role="menuitem" onclick={() => void applyBellSnooze(24 * 60 * 60 * 1000)}>{$t('inbox.snooze1d')}</button>
          <div class="border-t border-md-outline-variant/40 my-1"></div>
          <div class="px-3 py-1 text-xs font-semibold text-md-on-surface/45">{$t('inbox.snoozeCustom')}</div>
          <div class="px-3 pb-2 flex flex-wrap items-center gap-1.5">
            <input type="number" min="0" max="999" bind:value={snoozeCustomMin} class="w-12 px-1.5 py-1 text-label-sm rounded-lg bg-md-surface-container-low border border-md-outline-variant/40 tabular-nums" aria-label={$t('inbox.snoozeCustomMin')} />
            <span class="text-xs text-md-on-surface/50">{$t('inbox.snoozeUnitMin')}</span>
            <input type="number" min="0" max="999" bind:value={snoozeCustomHrs} class="w-12 px-1.5 py-1 text-label-sm rounded-lg bg-md-surface-container-low border border-md-outline-variant/40 tabular-nums" aria-label={$t('inbox.snoozeCustomHrs')} />
            <span class="text-xs text-md-on-surface/50">{$t('inbox.snoozeUnitHrs')}</span>
            <input type="number" min="0" max="365" bind:value={snoozeCustomDays} class="w-12 px-1.5 py-1 text-label-sm rounded-lg bg-md-surface-container-low border border-md-outline-variant/40 tabular-nums" aria-label={$t('inbox.snoozeCustomDays')} />
            <span class="text-xs text-md-on-surface/50">{$t('inbox.snoozeUnitDays')}</span>
            <button type="button" class="ms-auto px-2 py-1 rounded-lg text-label-sm font-semibold bg-md-primary text-md-on-primary" role="menuitem" onclick={() => void applyCustomSnooze()}>{$t('common.apply')}</button>
          </div>
          {#if snoozeUntil > Date.now()}
            <div class="border-t border-md-outline-variant/40 my-1"></div>
            <button type="button" class="w-full text-start px-3 py-2 text-xs text-md-primary hover:bg-md-surface-variant" role="menuitem" onclick={() => void clearBellSnooze()}>{$t('inbox.clearSnooze')}</button>
          {/if}
        </div>
      {/if}
    </div>

    {#if dropdownOpen}
      <!-- Low z so portaled Tag/Confirm dialogs (z-10000) always paint above -->
      <div
        class="account-selector-overlay fixed inset-0 z-[40] flex items-stretch justify-stretch"
        data-portal-layer="accountSelector"
        role="dialog"
        aria-modal="true"
      >
        <!-- Scrim blocks all chrome interaction -->
        <button
          id="button-close-dropdown-backdrop"
          type="button"
          class="absolute inset-0 z-0 cursor-default border-0 bg-md-scrim/50 backdrop-blur-sm"
          aria-label={$t('common.close')}
          onclick={closeDropdown}
          onkeydown={handleKeyDown}
        ></button>

        <!-- Content inset: 25px all sides (relative so Tag/Confirm dialogs cover this layer only) -->
        <div
          class="relative z-10 flex flex-col w-full h-full min-h-0"
          style="padding: 25px;"
          data-account-selector-pane
        >
          <button
            id="button-close-dialog"
            type="button"
            class="self-end shrink-0 mb-2 w-9 h-9 rounded-full bg-md-surface hover:bg-md-surface-variant flex items-center justify-center shadow-md transition-colors"
            aria-label={$t('common.close')}
            title={$t('common.close')}
            onclick={closeDropdown}
          >
            <Icon name="x" class="w-4 h-4 text-md-on-surface/70" />
          </button>

          <!-- Dialog card fills remaining space -->
          <div id="account-selector-dialog" bind:this={dialogRef} class="bg-md-surface rounded-xl shadow-2xl p-3 flex flex-col gap-2 w-full flex-1 min-h-0 overflow-hidden border border-md-outline-variant/30">
          <!-- Sticky header: search -->
          <div class="relative shrink-0">
            <input
              type="text"
              id="account-selector-search"
              placeholder={$t('mailManagement.searchAddressesOrTags')}
              class="w-full bg-md-surface-container-low rounded-xl px-3 py-1.5 text-sm outline-none placeholder:text-md-on-surface/40 border border-md-outline-variant/30 focus:border-md-primary transition-colors"
              bind:value={dropdownSearch}
              onkeydown={(e) => {
                const activeList = openSection === 'live' ? accountsByCategory.live : [...accountsByCategory.available, ...accountsByCategory.unavailable];
                if (activeList.length === 0) return;
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  activeAccountIndex = (activeAccountIndex + 1) % activeList.length;
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  activeAccountIndex = (activeAccountIndex - 1 + activeList.length) % activeList.length;
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  const target = activeList[activeAccountIndex];
                  if (target) {
                    onSelectAccount(target.address);
                    onDropdownOpenChange(false);
                  }
                }
              }}
              aria-label={$t('mailManagement.searchAddressesOrTags')}
            />
            {#if dropdownSearch}
              <button
                id="button-clear-search"
                class="absolute end-3 top-1/2 -translate-y-1/2 text-md-on-surface/40 hover:text-md-on-surface/70"
                aria-label="Clear search"
                onclick={() => dropdownSearch = ''}
              >
                <Icon name="x" class="w-4 h-4" />
              </button>
            {/if}
          </div>

          <div class="space-y-1 flex-1 min-h-0 flex flex-col">
            <!-- Live/Inactive tabs (drop targets for drag) — sticky under search -->
            <div class="flex gap-1 p-1 rounded-xl bg-md-surface-variant shrink-0">
              <button
                id="button-tab-live"
                type="button"
                class="flex-none min-w-[100px] flex items-center justify-center gap-2 px-3 py-1 rounded-xl transition-all duration-200 {openSection === 'live' ? 'bg-md-surface shadow-sm' : ''} {tabDropTarget === 'live' ? 'ring-2 ring-md-primary' : ''}"
                onclick={() => toggleSection('live')}
                ondragover={(e) => {
                  e.preventDefault();
                  tabDropTarget = 'live';
                }}
                ondragleave={() => {
                  if (tabDropTarget === 'live') tabDropTarget = null;
                }}
                ondrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  tabDropTarget = null;
                  handleTabDrop('live', e);
                }}
              >
                <div class="flex flex-col items-start leading-tight min-w-0">
                  <span class="text-xs font-bold {openSection === 'live' ? 'text-md-on-surface' : 'text-md-on-surface/40'}">{$t('mailManagement.live')}</span>
                  <span class="text-xs font-medium {openSection === 'live' ? 'text-md-on-surface/50' : 'text-md-on-surface/30'}">{$t('mailManagement.activeSubtitle')}</span>
                </div>
                <span class="text-label-sm font-bold px-1.5 py-0.5 rounded-full {openSection === 'live' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface-variant/40 text-md-on-surface/60'}">{accountsByCategory.live.length}</span>
              </button>
              <button
                id="button-tab-inactive"
                type="button"
                class="flex-1 flex items-center justify-center gap-2 px-3 py-1 rounded-xl transition-all duration-200 {openSection === 'inactive' ? 'bg-md-surface shadow-sm' : ''} {tabDropTarget === 'inactive' ? 'ring-2 ring-md-warning' : ''}"
                onclick={() => toggleSection('inactive')}
                ondragover={(e) => {
                  e.preventDefault();
                  tabDropTarget = 'inactive';
                }}
                ondragleave={() => {
                  if (tabDropTarget === 'inactive') tabDropTarget = null;
                }}
                ondrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  tabDropTarget = null;
                  handleTabDrop('inactive', e);
                }}
              >
                <div class="flex flex-col items-start leading-tight min-w-0">
                  <span class="text-xs font-bold {openSection === 'inactive' ? 'text-md-on-surface' : 'text-md-on-surface/40'}">{$t('mailManagement.inactive')}</span>
                  <span class="text-xs font-medium {openSection === 'inactive' ? 'text-md-on-surface/50' : 'text-md-on-surface/30'}">{$t('mailManagement.inactiveSubtitle')}</span>
                </div>
                <span class="text-label-sm font-bold px-1.5 py-0.5 rounded-full {openSection === 'inactive' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface-variant/40 text-md-on-surface/60'}">{accountsByCategory.available.length + accountsByCategory.unavailable.length}</span>
              </button>
            </div>

            <!-- Live tab content -->
            {#if openSection === 'live'}
              <div
                class="relative space-y-1 mt-1 flex-1 min-h-0 overflow-y-auto"
                role="list"
                onpointerdown={onListMarqueeDown}
              >
                {#each accountsByCategory.live as account (account.id)}
                  <div
                    data-marquee-id={account.id}
                    class="rounded-xl {selectorSelectedIds.has(account.id) ? 'ring-2 ring-md-secondary' : ''}"
                    ondrop={(e) => handleDrop(e, account, 'live')}
                    ondragover={(e) => handleDragOver(e, account)}
                    role="listitem"
                  >
                    <AccountCard
                      {account}
                      {selectedEmail}
                      isInAvailable={false}
                      isInUnavailable={false}
                      draggable={true}
                      onDragStart={handleDragStart}
                      onDragEnd={handleDragEnd}
                      onDrop={(e) => handleDrop(e, account, 'live')}
                      isDragging={draggedAccount?.id === account.id}
                      isDropTarget={dropTargetAccount?.id === account.id}
                      onSelectAccount={(address) => { onSelectAccount(address); closeDropdown(); }}
                      onToggleAutoExtend={onToggleAutoExtend}
                      onArchiveAccount={wrappedOnArchiveAccount}
                      onUnarchiveAccount={wrappedOnUnarchiveAccount}
                      onEditAccount={onEditAccount}
                      onRemoveAccount={wrappedOnRemoveAccount}
                      onRestoreAccount={wrappedOnRestoreAccount}
                      onTagAccount={openTagDialogForAccount}
                      onMarkAllRead={(acc) => void onMarkAllRead(acc)}
                      onMarkAllUnread={(acc) => void onMarkAllUnread(acc)}
                    />
                  </div>
                {/each}
              </div>
            {/if}

            <!-- Inactive tab content -->
            {#if openSection === 'inactive'}
              <!-- Tag filter pills -->
              <div class="flex gap-1 mt-1 px-2 flex-wrap">
                <button
                  id="button-filter-all"
                  class="text-xs px-2 py-0.5 rounded-full {selectedTagFilter === null ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface-variant text-md-on-surface/60'} hover:bg-md-primary hover:text-md-on-primary transition-colors"
                  onclick={() => selectedTagFilter = null}
                >
                  {$t('common.all')}
                </button>
                <button
                  id="button-filter-archived"
                  class="text-xs px-2 py-0.5 rounded-full {selectedTagFilter === 'archived' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface-variant text-md-on-surface/60'} hover:bg-md-primary hover:text-md-on-primary transition-colors"
                  onclick={() => selectedTagFilter = selectedTagFilter === 'archived' ? null : 'archived'}
                >
                  {$t('common.archived')}
                </button>
                <button
                  id="button-filter-deleted"
                  class="text-xs px-2 py-0.5 rounded-full {selectedTagFilter === 'deleted' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface-variant text-md-on-surface/60'} hover:bg-md-primary hover:text-md-on-primary transition-colors"
                  onclick={() => selectedTagFilter = selectedTagFilter === 'deleted' ? null : 'deleted'}
                >
                  {$t('common.deleted')}
                </button>
                <button
                  id="button-filter-expired"
                  class="text-xs px-2 py-0.5 rounded-full {selectedTagFilter === 'expired' ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface-variant text-md-on-surface/60'} hover:bg-md-primary hover:text-md-on-primary transition-colors"
                  onclick={() => selectedTagFilter = selectedTagFilter === 'expired' ? null : 'expired'}
                >
                  {$t('mailManagement.expiredStatus')}
                </button>
              </div>

              <!-- Available collapsible section -->
              <div class="mt-2">
                <button
                  id="button-collapse-available"
                  class="w-full flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-md-surface-variant transition-colors"
                  onclick={() => availableCollapsed = !availableCollapsed}
                >
                  <span class="text-label-sm font-semibold text-md-on-surface">{$t('account.available')} ({accountsByCategory.available.length})</span>
                  <Icon name="chevronDown" class={`w-4 h-4 text-md-on-surface/50 transition-transform ${availableCollapsed ? 'rotate-180' : ''}`} />
                </button>
                {#if !availableCollapsed && accountsByCategory.available.length > 0}
                  <div
                    class="mt-1 space-y-1 max-h-60 overflow-y-auto"
                    role="list"
                    onpointerdown={onListMarqueeDown}
                  >
                    {#each accountsByCategory.available as account (account.id)}
                      <div
                        data-marquee-id={account.id}
                        class="rounded-xl {selectorSelectedIds.has(account.id) ? 'ring-2 ring-md-secondary' : ''}"
                        ondrop={(e) => handleDrop(e, account, 'inactive')}
                        ondragover={(e) => handleDragOver(e, account)}
                        role="listitem"
                      >
                        <AccountCard
                          {account}
                          {selectedEmail}
                          isInAvailable={true}
                          isInUnavailable={false}
                          draggable={true}
                          onDragStart={handleDragStart}
                          onDragEnd={handleDragEnd}
                          onDrop={(e) => handleDrop(e, account, 'inactive')}
                          isDragging={draggedAccount?.id === account.id}
                          isDropTarget={dropTargetAccount?.id === account.id}
                          onSelectAccount={(address) => { onSelectAccount(address); closeDropdown(); }}
                          onToggleAutoExtend={onToggleAutoExtend}
                          onArchiveAccount={wrappedOnArchiveAccount}
                          onUnarchiveAccount={wrappedOnUnarchiveAccount}
                          onEditAccount={onEditAccount}
                          onRemoveAccount={wrappedOnRemoveAccount}
                          onRestoreAccount={wrappedOnRestoreAccount}
                          onTagAccount={openTagDialogForAccount}
                          onMarkAllRead={(acc) => void onMarkAllRead(acc)}
                          onMarkAllUnread={(acc) => void onMarkAllUnread(acc)}
                        />
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>

              <!-- Unavailable collapsible section -->
              <div class="mt-2">
                <button
                  id="button-collapse-unavailable"
                  class="w-full flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-md-surface-variant transition-colors"
                  onclick={() => unavailableCollapsed = !unavailableCollapsed}
                >
                  <span class="text-label-sm font-semibold text-md-on-surface">{$t('account.unavailable')} ({accountsByCategory.unavailable.length})</span>
                  <Icon name="chevronDown" class={`w-4 h-4 text-md-on-surface/50 transition-transform ${unavailableCollapsed ? 'rotate-180' : ''}`} />
                </button>
                {#if !unavailableCollapsed && accountsByCategory.unavailable.length > 0}
                  <div
                    class="mt-1 space-y-1 max-h-60 overflow-y-auto"
                    role="list"
                    onpointerdown={onListMarqueeDown}
                  >
                    {#each accountsByCategory.unavailable as account (account.id)}
                      <div
                        data-marquee-id={account.id}
                        class="rounded-xl {selectorSelectedIds.has(account.id) ? 'ring-2 ring-md-secondary' : ''}"
                        ondrop={(e) => handleDrop(e, account, 'inactive')}
                        ondragover={(e) => handleDragOver(e, account)}
                        role="listitem"
                      >
                        <AccountCard
                          {account}
                          {selectedEmail}
                          isInAvailable={false}
                          isInUnavailable={true}
                          draggable={true}
                          onDragStart={handleDragStart}
                          onDragEnd={handleDragEnd}
                          onDrop={(e) => handleDrop(e, account, 'inactive')}
                          isDragging={draggedAccount?.id === account.id}
                          isDropTarget={dropTargetAccount?.id === account.id}
                          onSelectAccount={(address) => { onSelectAccount(address); closeDropdown(); }}
                          onToggleAutoExtend={onToggleAutoExtend}
                          onArchiveAccount={wrappedOnArchiveAccount}
                          onUnarchiveAccount={wrappedOnUnarchiveAccount}
                          onEditAccount={onEditAccount}
                          onRemoveAccount={wrappedOnRemoveAccount}
                          onRestoreAccount={wrappedOnRestoreAccount}
                          onTagAccount={openTagDialogForAccount}
                          onMarkAllRead={(acc) => void onMarkAllRead(acc)}
                          onMarkAllUnread={(acc) => void onMarkAllUnread(acc)}
                        />
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
            </div>

            <!-- Quick actions: drop targets (divs — buttons often swallow HTML5 drop) -->
            <div class="flex flex-row gap-1">
              <div
                role="button"
                tabindex="0"
                id="button-strip-archive"
                class="flex-1 min-w-0 px-1 py-1.5 rounded-lg text-xs font-bold flex flex-col items-center gap-0.5 transition-colors cursor-pointer {stripDropTarget === 'archive' ? 'ring-2 ring-md-warning bg-md-warning/15' : 'bg-md-surface-variant/80 hover:bg-md-surface-variant'}"
                ondragover={(e) => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; stripDropTarget = 'archive'; }}
                ondragenter={(e) => { e.preventDefault(); stripDropTarget = 'archive'; }}
                ondragleave={() => { if (stripDropTarget === 'archive') stripDropTarget = null; }}
                ondrop={(e) => { e.preventDefault(); e.stopPropagation(); handleActionStripDrop('archive', e); }}
                onclick={(e) => {
                  e.stopPropagation();
                  if (currentAccount) wrappedOnArchiveAccount(currentAccount);
                }}
                onkeydown={(e) => {
                  if (e.key === 'Enter' && currentAccount) wrappedOnArchiveAccount(currentAccount);
                }}
              >
                <Icon name="archive" class="w-3.5 h-3.5 pointer-events-none" />
                <span class="truncate max-w-full pointer-events-none">{$t('common.archive')}</span>
              </div>
              <div
                role="button"
                tabindex="0"
                id="button-strip-delete"
                class="flex-1 min-w-0 px-1 py-1.5 rounded-lg text-xs font-bold flex flex-col items-center gap-0.5 transition-colors cursor-pointer {stripDropTarget === 'delete' ? 'ring-2 ring-md-error bg-md-error/15' : 'bg-md-surface-variant/80 hover:bg-md-surface-variant'}"
                ondragover={(e) => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; stripDropTarget = 'delete'; }}
                ondragenter={(e) => { e.preventDefault(); stripDropTarget = 'delete'; }}
                ondragleave={() => { if (stripDropTarget === 'delete') stripDropTarget = null; }}
                ondrop={(e) => { e.preventDefault(); e.stopPropagation(); handleActionStripDrop('delete', e); }}
                onclick={(e) => {
                  e.stopPropagation();
                  if (currentAccount) wrappedOnRemoveAccount(currentAccount.address);
                }}
                onkeydown={(e) => {
                  if (e.key === 'Enter' && currentAccount) wrappedOnRemoveAccount(currentAccount.address);
                }}
              >
                <Icon name="trash" class="w-3.5 h-3.5 text-md-error pointer-events-none" />
                <span class="truncate max-w-full pointer-events-none">{$t('common.delete')}</span>
              </div>
              <div
                role="button"
                tabindex="0"
                id="button-strip-tag"
                class="flex-1 min-w-0 px-1 py-1.5 rounded-lg text-xs font-bold flex flex-col items-center gap-0.5 transition-colors cursor-pointer {stripDropTarget === 'tag' ? 'ring-2 ring-md-primary bg-md-primary/15' : 'bg-md-surface-variant/80 hover:bg-md-surface-variant'}"
                ondragover={(e) => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; stripDropTarget = 'tag'; }}
                ondragenter={(e) => { e.preventDefault(); stripDropTarget = 'tag'; }}
                ondragleave={() => { if (stripDropTarget === 'tag') stripDropTarget = null; }}
                ondrop={(e) => { e.preventDefault(); e.stopPropagation(); handleActionStripDrop('tag', e); }}
                onclick={(e) => {
                  e.stopPropagation();
                  if (currentAccount) openTagDialogForAccount(currentAccount);
                }}
                onkeydown={(e) => { if (e.key === 'Enter' && currentAccount) openTagDialogForAccount(currentAccount); }}
              >
                <Icon name="tag" class="w-3.5 h-3.5 pointer-events-none" />
                <span class="truncate max-w-full pointer-events-none">{$t('common.addTag')}</span>
              </div>
              <div
                role="button"
                tabindex="0"
                id="button-strip-autorenew"
                class="flex-1 min-w-0 px-1 py-1.5 rounded-lg text-xs font-bold flex flex-col items-center gap-0.5 transition-colors cursor-pointer {stripDropTarget === 'autoRenew' ? 'ring-2 ring-md-tertiary bg-md-tertiary/15' : 'bg-md-surface-variant/80 hover:bg-md-surface-variant'}"
                ondragover={(e) => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; stripDropTarget = 'autoRenew'; }}
                ondragenter={(e) => { e.preventDefault(); stripDropTarget = 'autoRenew'; }}
                ondragleave={() => { if (stripDropTarget === 'autoRenew') stripDropTarget = null; }}
                ondrop={(e) => { e.preventDefault(); e.stopPropagation(); handleActionStripDrop('autoRenew', e); }}
                onclick={(e) => {
                  e.stopPropagation();
                  if (currentAccount) onToggleAutoExtend(currentAccount);
                }}
                onkeydown={(e) => {
                  if (e.key === 'Enter' && currentAccount) onToggleAutoExtend(currentAccount);
                }}
              >
                <Icon name="autoRenew" class="w-3.5 h-3.5 pointer-events-none" />
                <span class="truncate max-w-full pointer-events-none">{$t('account.autoRenew')}</span>
              </div>
            </div>

            <!-- Sticky footer: Create + Manage always visible while list scrolls -->
            <div
              class="account-selector-sticky-actions shrink-0 flex flex-row gap-1.5 pt-2 mt-auto border-t border-md-outline-variant/25 bg-md-surface"
              bind:this={stickyActionsEl}
              style="--as-action-font: {stickyActionFontPx}px;"
            >
              <button
                id="button-create-new-mail"
                type="button"
                class="flex-1 min-w-0 px-2 py-2 text-center bg-md-primary text-md-on-primary font-semibold flex items-center justify-center gap-1 rounded-xl hover:bg-md-primary/90 transition-colors motion-press"
                style="font-size: var(--as-action-font, 0.75rem);"
                onclick={() => { closeDropdown(); onCreateInbox(); }}
              >
                <Icon name="plus" class="w-3.5 h-3.5 shrink-0" />
                <span class="btn-label whitespace-nowrap">{$t('account.createNewMail')}</span>
              </button>
              <button
                id="button-manage-addresses"
                type="button"
                class="flex-1 min-w-0 px-2 py-2 text-center bg-md-surface-variant font-semibold flex items-center justify-center gap-1 text-md-on-surface hover:bg-md-surface-variant/70 rounded-xl transition-colors motion-press"
                style="font-size: var(--as-action-font, 0.75rem);"
                onclick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  // Close + strip portal first so overlay never sticks on Addresses
                  closeDropdown();
                  queueMicrotask(() => {
                    removePortalOverlay();
                    onNavigateToManage();
                  });
                }}
              >
                <Icon name="instances" class="w-3.5 h-3.5 shrink-0" />
                <span class="btn-label whitespace-nowrap">{$t('account.manageAddresses')}</span>
              </button>
            </div>
          </div>
          <!-- /dialog card -->

          <!-- Confirm dialogs INSIDE overlay so they stack above the card (same stacking context) -->
          {#if crossTabPrompt}
            <div class="absolute inset-0 z-[150] flex items-center justify-center p-4" role="dialog" aria-modal="true">
              <button
                type="button"
                class="absolute inset-0 bg-md-scrim/70 border-0 cursor-default"
                aria-label={$t('common.close')}
                onclick={() => (crossTabPrompt = null)}
              ></button>
              <div class="relative z-10 w-full max-w-[300px] rounded-2xl bg-md-surface border border-md-outline-variant/40 shadow-2xl p-4 space-y-3">
                {#if crossTabPrompt.direction === 'toInactive'}
                  <h3 class="text-sm font-bold text-md-on-surface">{$t('account.dragToInactiveTitle')}</h3>
                  <p class="text-xs text-md-on-surface/60" style="direction:ltr;unicode-bidi:isolate;">{crossTabPrompt.account.address}</p>
                  <p class="text-label-sm text-md-on-surface/50">{$t('account.dragToInactiveBody')}</p>
                  <div class="flex flex-col gap-1.5">
                    <button type="button" class="w-full py-2 rounded-xl bg-md-primary text-md-on-primary text-xs font-semibold" onclick={() => applyTabDropToInactive('archive')}>
                      {$t('common.archive')}
                    </button>
                    <button type="button" class="w-full py-2 rounded-xl bg-md-error text-md-on-error text-xs font-semibold" onclick={() => applyTabDropToInactive('delete')}>
                      {$t('common.delete')}
                    </button>
                    <button type="button" class="w-full py-2 rounded-xl bg-md-surface-variant text-xs font-medium" onclick={() => (crossTabPrompt = null)}>
                      {$t('common.cancel')}
                    </button>
                  </div>
                {:else if crossTabPrompt.direction === 'toLiveRenew'}
                  <h3 class="text-sm font-bold text-md-on-surface">{$t('account.dragToLiveRenewTitle')}</h3>
                  <p class="text-xs text-md-on-surface/60" style="direction:ltr;unicode-bidi:isolate;">{crossTabPrompt.account.address}</p>
                  <p class="text-label-sm text-md-on-surface/50">{$t('account.dragToLiveRenewBody')}</p>
                  <div class="flex flex-col gap-1.5">
                    <button type="button" class="w-full py-2 rounded-xl bg-md-primary text-md-on-primary text-xs font-semibold" onclick={() => applyTabDropToLiveRenew()}>
                      {$t('account.enableAutoRenew')}
                    </button>
                    <button type="button" class="w-full py-2 rounded-xl bg-md-surface-variant text-xs font-medium" onclick={() => (crossTabPrompt = null)}>
                      {$t('common.cancel')}
                    </button>
                  </div>
                {:else}
                  <h3 class="text-sm font-bold text-md-on-surface">{$t('account.dragToLiveTitle')}</h3>
                  <p class="text-xs text-md-on-surface/60" style="direction:ltr;unicode-bidi:isolate;">{crossTabPrompt.account.address}</p>
                  <p class="text-label-sm text-md-on-surface/50">{$t('account.dragToLiveBody')}</p>
                  <div class="flex flex-col gap-1.5">
                    <button type="button" class="w-full py-2 rounded-xl bg-md-primary text-md-on-primary text-xs font-semibold" onclick={() => applyTabDropToLive('unarchive')}>
                      {$t('common.unarchive')}
                    </button>
                    <button type="button" class="w-full py-2 rounded-xl bg-md-tertiary text-md-on-tertiary text-xs font-semibold" onclick={() => applyTabDropToLive('restore')}>
                      {$t('common.restore')}
                    </button>
                    <button type="button" class="w-full py-2 rounded-xl bg-md-surface-variant text-xs font-medium" onclick={() => (crossTabPrompt = null)}>
                      {$t('common.cancel')}
                    </button>
                  </div>
                {/if}
              </div>
            </div>
          {/if}

          {#if marqueeActive && marqueeRect}
            <div
              class="fixed pointer-events-none z-[140] border border-md-primary/70 bg-md-primary/15 rounded-sm"
              style="left:{marqueeRect.left}px;top:{marqueeRect.top}px;width:{marqueeRect.right - marqueeRect.left}px;height:{marqueeRect.bottom - marqueeRect.top}px;"
              aria-hidden="true"
            ></div>
          {/if}

          {#if actionDropPrompt}
            <div class="absolute inset-0 z-[150] flex items-center justify-center p-4" role="dialog" aria-modal="true">
              <button
                type="button"
                class="absolute inset-0 bg-md-scrim/70 border-0 cursor-default"
                aria-label={$t('common.close')}
                onclick={() => (actionDropPrompt = null)}
              ></button>
              <div class="relative z-10 w-full max-w-[300px] rounded-2xl bg-md-surface border border-md-outline-variant/40 shadow-2xl p-4 space-y-3">
                <h3 class="text-sm font-bold text-md-on-surface">{$t('account.confirmActionTitle')}</h3>
                <p class="text-xs text-md-on-surface/60" style="direction:ltr;unicode-bidi:isolate;">{actionDropPrompt.account.address}</p>
                <p class="text-label-sm text-md-on-surface/50">
                  {#if actionDropPrompt.action === 'archive'}{$t('common.archive')}
                  {:else if actionDropPrompt.action === 'delete'}{$t('common.delete')}
                  {:else if actionDropPrompt.action === 'tag'}{$t('common.addTag')}
                  {:else}{$t('account.autoRenew')}
                  {/if}
                </p>
                <div class="flex flex-col gap-1.5">
                  <button type="button" class="w-full py-2 rounded-xl bg-md-primary text-md-on-primary text-xs font-semibold" onclick={() => applyActionDrop()}>
                    {$t('common.confirm')}
                  </button>
                  <button type="button" class="w-full py-2 rounded-xl bg-md-surface-variant text-xs font-medium" onclick={() => (actionDropPrompt = null)}>
                    {$t('common.cancel')}
                  </button>
                </div>
              </div>
            </div>
          {/if}
          <!-- Tag dialog inside overlay pane so it stays in main content (not sidebar) -->
          {#if tagDialogOpen && tagTargetAccount}
            <TagDialog
              open={tagDialogOpen}
              currentTag={tagTargetAccount.tag || ''}
              currentTagColor={tagTargetAccount.tagColor || null}
              currentTags={accountTagsList(tagTargetAccount)}
              onClose={closeTagDialog}
              onSave={saveTag}
              onSaveTags={saveTags}
              existingTags={Array.from(
                new Set(allAccounts.flatMap((a: Account) => accountTagsList(a).map((t) => t.name)))
              )}
              tagColors={Object.fromEntries(
                allAccounts.flatMap((a: Account) =>
                  accountTagsList(a).map((t) => [t.name, t.color] as [string, string])
                )
              )}
              portal={false}
            />
          {/if}
        </div>
        <!-- /padding wrapper -->
      </div>
      <!-- /overlay -->
  {/if}
</div>

<style>
  .account-selector-outer {
    position: relative;
    display: flex;
    border-radius: 9999px;
  }
</style>
