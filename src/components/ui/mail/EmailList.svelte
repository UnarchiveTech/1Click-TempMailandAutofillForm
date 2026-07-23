<script lang="ts">
import { onDestroy, onMount } from 'svelte';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import Icon from '@/components/icons/Icon.svelte';
import EmptyState from '@/components/ui/EmptyState.svelte';
import FaviconImage from '@/components/ui/FaviconImage.svelte';
import Skeleton from '@/components/ui/Skeleton.svelte';
import { avatarColor, MD3_AVATAR_MUTED } from '@/utils/avatar-color.js';
import { isEmailStarred, starKeyForEmail, toggleStarInSet } from '@/utils/email-star-key.js';
import type { EmailThread } from '@/utils/email-threads.js';
import { logDebug, logError } from '@/utils/logger.js';
import {
  collectIntersectingIds,
  isInteractiveTarget,
  MARQUEE_THRESHOLD,
  normalizeMarquee,
} from '@/utils/marquee-selection.js';
import { isMarqueeSelectionEnabled } from '@/utils/marquee-settings.js';
import { htmlToPlainText } from '@/utils/sanitize-html.js';
import { highlightMatches, parseSearchShortcuts } from '@/utils/search-shortcuts.js';
import { timeAgo } from '@/utils/time.js';
import type { Email } from '@/utils/types.js';

let {
  displayedEmails = [],
  filteredEmails = [],
  displayedEmailCount = 0,
  loading = false,
  searchQuery = '',
  otpOnly = false,
  /** Active mailbox address - scopes star state so ids never bleed across inboxes */
  mailboxAddress = '',
  onOpenMessageDetail = () => {},
  onClearFilters = () => {},
  onRefreshInbox = () => {},
  onCopyOtpFromMessage = () => {},
  loadMoreEmails = () => {},
  highlightedEmailId = '',
  threadGrouping = false,
  emailThreads = [],
  expandedThreadIds = new Set<string>(),
  onToggleThread = (_id: string) => {},
  emailPreviewEnabled = true,
  showFavicons = true,
  hideLabels = false,
  hideOtpLabels = false,
  emailListTab = 'inbox',
  onArchiveEmails = (_emails: Email[]) => {},
  onDeleteEmails = (_emails: Email[]) => {},
  onRestoreEmails = (_emails: Email[]) => {},
  /** When true, parent renders the selection strip (InboxView bottom strips). */
  externalSelectionBar = false,
  onSelectionChange = (_state: {
    mode: boolean;
    count: number;
    canArchive: boolean;
    canDelete: boolean;
    canRestore: boolean;
  }) => {},
  onFilterByLabel = (_label: string) => {},
  /** Scroll direction for parent FABs (hide on down, show on up) */
  onScrollDirection = (_dir: 'up' | 'down') => {},
  selectionApi = $bindable({
    cancel: () => {},
    archive: () => {},
    delete: () => {},
    restore: () => {},
    star: () => {},
    label: () => {},
    selectAll: () => {},
    deselectAll: () => {},
  }),
  /** Disable long-press / hold multi-select gestures */
  gesturesEnabled = true,
} = $props<{
  displayedEmails?: Email[];
  filteredEmails?: Email[];
  displayedEmailCount?: number;
  loading?: boolean;
  searchQuery?: string;
  otpOnly?: boolean;
  mailboxAddress?: string;
  onOpenMessageDetail?: (thread: Email[]) => void;
  onClearFilters?: () => void;
  onRefreshInbox?: () => Promise<void>;
  onCopyOtpFromMessage?: (otp: string) => void;
  loadMoreEmails?: () => void;
  highlightedEmailId?: string;
  threadGrouping?: boolean;
  emailThreads?: EmailThread[];
  expandedThreadIds?: Set<string>;
  onToggleThread?: (id: string) => void;
  emailPreviewEnabled?: boolean;
  showFavicons?: boolean;
  hideLabels?: boolean;
  /** Hide OTP badges on list rows (independent of custom labels) */
  hideOtpLabels?: boolean;
  emailListTab?: 'inbox' | 'all' | 'archived' | 'deleted';
  onArchiveEmails?: (emails: Email[]) => void | Promise<void>;
  onDeleteEmails?: (emails: Email[]) => void | Promise<void>;
  onRestoreEmails?: (emails: Email[]) => void | Promise<void>;
  externalSelectionBar?: boolean;
  onSelectionChange?: (state: {
    mode: boolean;
    count: number;
    canArchive: boolean;
    canDelete: boolean;
    canRestore: boolean;
  }) => void;
  onFilterByLabel?: (label: string) => void;
  onScrollDirection?: (dir: 'up' | 'down') => void;
  selectionApi?: {
    cancel: () => void;
    archive: () => void;
    delete: () => void;
    restore: () => void;
    star: () => void;
    label: () => void;
    selectAll: () => void;
    deselectAll: () => void;
  };
  gesturesEnabled?: boolean;
}>();

// Pull-to-refresh state
let pullToRefresh = $state(false);
let pullDistance = $state(0);
let startY = $state(0);
let isPulling = $state(false);
let pullRefreshing = $state(false);
let refreshRotation = $derived(Math.min(pullDistance * 4.5, 360));
let lastScrollTop = 0;
let scrollRaf = 0;

// Long-press context menu state
let longPressTimer: ReturnType<typeof setTimeout> | null = null;
let longPressEmail = $state<Email | null>(null);
let contextMenuOpen = $state(false);
let contextMenuPosition = $state({ x: 0, y: 0 });

// Swipe gesture state for mobile
let swipeStartX = $state(0);
let swipeDistance = $state(0);
let swipeDirection = $state<'left' | 'right' | null>(null);
let swipingEmail = $state<Email | null>(null);
let swipeActionTriggered = $state(false);
/** Rows animating out after swipe archive/delete */
let exitingEmailIds = $state<Set<string>>(new Set());
/** Brief star pop animation target */
let starPopId = $state<string | null>(null);
let prefersReducedMotion = $state(false);

// Multi-select state
let selectionMode = $state(false);
let selectedEmailIds = $state<Set<string>>(new Set());
/** After long-press/marquee select, ignore the click that would toggle/deselect */
let suppressClickUntil = 0;
let marqueeDidSelect = false;

// Marquee rubber-band selection
let listRootEl = $state<HTMLElement | null>(null);
let marqueeActive = $state(false);
let marqueeStart = $state<{ x: number; y: number } | null>(null);
let marqueeRect = $state<{ left: number; top: number; right: number; bottom: number } | null>(null);
let marqueePrefEnabled = $state(true);

onMount(() => {
  void isMarqueeSelectionEnabled().then((v) => {
    marqueePrefEnabled = v;
  });
  const onStorage = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== 'local' || !changes.marqueeSelectionEnabled) return;
    marqueePrefEnabled = changes.marqueeSelectionEnabled.newValue !== false;
  };
  try {
    browser.storage.onChanged.addListener(onStorage);
    return () => browser.storage.onChanged.removeListener(onStorage);
  } catch {
    return;
  }
});

function onMarqueePointerDown(e: PointerEvent) {
  if (!gesturesEnabled || !marqueePrefEnabled || e.button !== 0) return;
  // No items in current tab → disable marquee
  if ((displayedEmails?.length || 0) === 0) return;
  if (isInteractiveTarget(e.target)) return;
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
    if (listRootEl) {
      const ids = collectIntersectingIds(listRootEl, '[data-marquee-id]', marqueeRect);
      selectionMode = ids.length > 0;
      selectedEmailIds = new Set(ids);
      emitSelectionChange();
    }
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    if (marqueeActive) {
      marqueeDidSelect = true;
      suppressClickUntil = Date.now() + 500;
    }
    marqueeStart = null;
    marqueeActive = false;
    marqueeRect = null;
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

// Clear multi-select only when mailbox *address* changes (not on selection updates).
// Plain let — NOT $state: read+write of $state in one $effect → effect_update_depth_exceeded.
let lastMailboxForSelection: string | null = null;
$effect(() => {
  const addr = mailboxAddress || '';
  if (lastMailboxForSelection === null) {
    lastMailboxForSelection = addr;
    return;
  }
  if (lastMailboxForSelection !== addr) {
    lastMailboxForSelection = addr;
    selectionMode = false;
    selectedEmailIds = new Set();
    contextMenuOpen = false;
    longPressEmail = null;
    emitSelectionChange();
  }
});

// Starred emails (keys are address_id - see email-star-key.ts)
let starredEmailIds = $state<Set<string>>(new Set());
/** Which row's label overflow menu is open */
let rowLabelMenuId = $state<string | null>(null);

function isStarredMail(email: Email): boolean {
  return isEmailStarred(starredEmailIds, email.id, email.original_inbox || mailboxAddress);
}

// Windowed rendering for large inboxes (expand via sentinel / Load more)
let renderLimit = $state(50);
let renderedEmails = $derived(displayedEmails.slice(0, renderLimit));
let listSentinelEl = $state<HTMLElement | null>(null);

function expandRenderWindow() {
  if (renderLimit >= displayedEmails.length) return;
  renderLimit = Math.min(displayedEmails.length, renderLimit + 50);
}

$effect(() => {
  const el = listSentinelEl;
  if (!el || typeof IntersectionObserver === 'undefined') return;
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) expandRenderWindow();
    },
    { root: null, rootMargin: '200px', threshold: 0 }
  );
  io.observe(el);
  return () => io.disconnect();
});

// Reset window when the underlying list shrinks / filter changes
$effect(() => {
  void displayedEmails.length;
  if (renderLimit > displayedEmails.length + 50) {
    renderLimit = Math.max(50, displayedEmails.length);
  }
});

// Email-level custom tags
let emailTagsMap = $state<Record<string, string[]>>({});
let tagDialogEmailId = $state<string | null>(null);
let tagDialogInput = $state('');
let tagDialogOpen = $state(false);

async function loadEmailTags() {
  const result = (await browser.storage.local.get(['emailTags'])) as {
    emailTags?: Record<string, string[]>;
  };
  const raw = result.emailTags || {};
  // Sanitize: ensure every value is a string[]
  const sanitized: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(raw)) {
    sanitized[k] = Array.isArray(v) ? v : [];
  }
  emailTagsMap = sanitized;
}

async function saveEmailTagsToStorage() {
  await browser.storage.local.set({ emailTags: emailTagsMap });
}

/** When set, tag dialog applies to many selected emails instead of one. */
let tagDialogMultiIds = $state<string[] | null>(null);

function openTagDialog(emailId: string) {
  tagDialogEmailId = emailId;
  tagDialogMultiIds = null;
  const tags = emailTagsMap[emailId];
  tagDialogInput = (Array.isArray(tags) ? tags : []).join(', ');
  tagDialogOpen = true;
}

function openTagDialogForSelected() {
  // Snapshot IDs so clearing selection later does not lose targets
  const ids = Array.from(selectedEmailIds);
  if (ids.length === 0) return;
  tagDialogEmailId = ids[0] ?? null;
  tagDialogMultiIds = [...ids];
  // Prefill empty for “add label”; user types new label(s)
  tagDialogInput = '';
  tagDialogOpen = true;
}

function closeTagDialog() {
  tagDialogOpen = false;
  tagDialogEmailId = null;
  tagDialogMultiIds = null;
  tagDialogInput = '';
}

async function saveEmailTags() {
  const tags = tagDialogInput
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const ids = tagDialogMultiIds?.length
    ? [...tagDialogMultiIds]
    : tagDialogEmailId
      ? [tagDialogEmailId]
      : [];
  if (ids.length === 0) return;
  // Nothing to apply
  if (tags.length === 0 && tagDialogMultiIds?.length) {
    closeTagDialog();
    return;
  }

  const next: Record<string, string[]> = { ...emailTagsMap };
  for (const id of ids) {
    if (tags.length === 0) {
      delete next[id];
    } else if (tagDialogMultiIds?.length) {
      // Multi-select from strip: merge / add labels onto existing
      const existing = Array.isArray(next[id]) ? next[id] : [];
      next[id] = [...new Set([...existing, ...tags])];
    } else {
      // Single-email editor: replace with typed list
      next[id] = tags;
    }
  }
  emailTagsMap = next;
  await saveEmailTagsToStorage();
  // Refresh parent label chips
  try {
    await browser.storage.local.set({ emailTags: next });
  } catch {
    /* ignore */
  }
  closeTagDialog();
  if (selectionMode) closeContextMenuOnly();
}

function filterByLabel(tag: string) {
  onFilterByLabel(tag);
}

// All unique tags across all emails for autocomplete
let allEmailTags = $derived.by(() => {
  const set = new Set<string>();
  for (const tags of Object.values(emailTagsMap)) {
    if (!Array.isArray(tags)) continue;
    for (const t of tags) set.add(t);
  }
  return Array.from(set).sort();
});

// Hover preview state
let hoveredEmail = $state<Email | null>(null);
let previewPosition = $state({ x: 0, y: 0, above: false });
let hoverTimer: ReturnType<typeof setTimeout> | null = null;
let windowWidth = $state(0);
let windowHeight = $state(0);

async function loadStarredEmails() {
  const result = (await browser.storage.local.get(['starredEmails'])) as {
    starredEmails?: string[];
  };
  starredEmailIds = new Set(result.starredEmails || []);
}

let starToggleBusy = $state(false);

async function toggleStar(email: Email | string) {
  const mail = typeof email === 'string' ? ({ id: email } as Email) : email;
  if (!mail?.id || starToggleBusy) return;
  starToggleBusy = true;
  try {
    const result = (await browser.storage.local.get(['starredEmails'])) as {
      starredEmails?: string[];
    };
    const addr = mail.original_inbox || mailboxAddress;
    const updated = toggleStarInSet(result.starredEmails || [], mail.id, addr);
    starredEmailIds = updated;
    if (!prefersReducedMotion) {
      starPopId = mail.id;
      setTimeout(() => {
        if (starPopId === mail.id) starPopId = null;
      }, 180);
    }
    await browser.storage.local.set({ starredEmails: Array.from(updated) });
  } catch (e) {
    logError('toggleStar failed', e);
    await loadStarredEmails();
  } finally {
    starToggleBusy = false;
  }
}

function handleListScroll(e: Event) {
  const el = e.currentTarget as HTMLElement | null;
  if (!el) return;
  const top = el.scrollTop;
  const delta = top - lastScrollTop;
  if (Math.abs(delta) > 8) {
    onScrollDirection(delta > 0 && top > 24 ? 'down' : 'up');
    lastScrollTop = top;
  }
}

let motionMqCleanup: (() => void) | null = null;

onMount(() => {
  loadEmailTags();
  loadStarredEmails();
  if (typeof window !== 'undefined' && window.matchMedia) {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    prefersReducedMotion = mq.matches;
    const onMq = () => {
      prefersReducedMotion = mq.matches;
    };
    mq.addEventListener?.('change', onMq);
    motionMqCleanup = () => mq.removeEventListener?.('change', onMq);
  }

  const handleStorageChange = (
    changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
    areaName: string
  ) => {
    if (areaName !== 'local') return;
    if (changes.emailTags) loadEmailTags();
    if (changes.starredEmails) loadStarredEmails();
  };

  browser.storage.onChanged.addListener(handleStorageChange);
  return () => {
    browser.storage.onChanged.removeListener(handleStorageChange);
    motionMqCleanup?.();
  };
});

onDestroy(() => {
  if (hoverTimer) clearTimeout(hoverTimer);
  if (longPressTimer) clearTimeout(longPressTimer);
  if (scrollRaf) cancelAnimationFrame(scrollRaf);
});

function handleSwipeStart(email: Email, e: TouchEvent | MouseEvent) {
  const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
  swipeStartX = clientX;
  swipingEmail = email;
  swipeDistance = 0;
  swipeDirection = null;
  swipeActionTriggered = false;
}

function handleSwipeMove(e: TouchEvent | MouseEvent) {
  if (!swipingEmail) return;
  const currentX = 'touches' in e ? e.touches[0].clientX : e.clientX;
  const diff = currentX - swipeStartX;

  // Only track horizontal swipes beyond threshold
  if (Math.abs(diff) > 10) {
    swipeDistance = Math.max(Math.min(diff, 120), -120);
    swipeDirection = diff > 0 ? 'right' : 'left';
  }
}

function handleSwipeEnd() {
  if (!swipingEmail) return;

  // Trigger action if swiped far enough
  if (Math.abs(swipeDistance) > 80) {
    const direction = swipeDistance < 0 ? 'left' : 'right';
    const target = swipingEmail;
    performSwipeAction(direction, target);
  } else {
    // Reset if not swiped far enough
    swipeDistance = 0;
    swipeDirection = null;
    swipingEmail = null;
  }
}

function selectAllVisible() {
  selectionMode = true;
  const ids = new Set<string>((displayedEmails || []).map((m: Email) => m.id));
  selectedEmailIds = ids;
  emitSelectionChange();
}

function deselectAll() {
  selectedEmailIds = new Set();
  selectionMode = false;
  emitSelectionChange();
}

function handleLongPressStart(email: Email, e: TouchEvent | MouseEvent) {
  if (!gesturesEnabled) return;
  if (longPressTimer) clearTimeout(longPressTimer);
  longPressTimer = setTimeout(() => {
    longPressEmail = email;
    selectionMode = true;
    // If already in selection mode, add to existing selection; otherwise start fresh
    if (selectedEmailIds.size > 0) {
      const next = new Set(selectedEmailIds);
      next.add(email.id);
      selectedEmailIds = next;
    } else {
      selectedEmailIds = new Set([email.id]);
    }
    // Block the mouseup/click that follows a hold so selection is not toggled off
    suppressClickUntil = Date.now() + 500;
    // Parent hosts selection strip — don't open floating context menu (it steals focus)
    if (!externalSelectionBar) {
      contextMenuOpen = true;
      const touch = 'touches' in e ? e.touches[0] : e;
      contextMenuPosition = { x: touch.clientX, y: touch.clientY };
    } else {
      contextMenuOpen = false;
    }
    emitSelectionChange();
  }, 500);
}

function handleLongPressEnd() {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

/** Close floating menu only — keeps multi-select / strip selection intact */
function closeContextMenuOnly() {
  contextMenuOpen = false;
  longPressEmail = null;
}

/** Cancel multi-select entirely (deselect strip / Escape) */
function closeContextMenu() {
  contextMenuOpen = false;
  longPressEmail = null;
  selectionMode = false;
  selectedEmailIds = new Set();
  emitSelectionChange();
}

function emitSelectionChange() {
  const count = selectedEmailIds.size;
  onSelectionChange({
    mode: selectionMode && count > 0,
    count,
    canArchive: emailListTab === 'inbox' || emailListTab === 'all',
    canDelete: emailListTab !== 'deleted',
    canRestore: emailListTab === 'archived' || emailListTab === 'deleted',
  });
}

function toggleEmailSelection(id: string) {
  const next = new Set(selectedEmailIds);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  selectedEmailIds = next;
  if (next.size === 0) {
    selectionMode = false;
    contextMenuOpen = false;
  }
  emitSelectionChange();
}

function resolveSelectedEmails(): Email[] {
  return displayedEmails.filter((e: Email) => selectedEmailIds.has(e.id));
}

function performArchive() {
  const targets = resolveSelectedEmails();
  if (targets.length === 0) return;
  void onArchiveEmails(targets);
  closeContextMenu();
}

function performDelete() {
  const targets = resolveSelectedEmails();
  if (targets.length === 0) return;
  void onDeleteEmails(targets);
  closeContextMenu();
}

function performRestore() {
  const targets = resolveSelectedEmails();
  if (targets.length === 0) return;
  void onRestoreEmails(targets);
  closeContextMenu();
}

async function performStarSelected() {
  const targets = displayedEmails.filter((e: Email) => selectedEmailIds.has(e.id));
  if (targets.length === 0) return;
  const anyUnstarred = targets.some((e: Email) => !isStarredMail(e));
  const updated = new Set(starredEmailIds);
  for (const e of targets) {
    const addr = e.original_inbox || mailboxAddress;
    const key = starKeyForEmail(e, addr);
    updated.delete(e.id); // drop legacy bare id
    if (anyUnstarred) updated.add(key);
    else updated.delete(key);
  }
  starredEmailIds = updated;
  await browser.storage.local.set({ starredEmails: Array.from(updated) });
}

function performLabelSelected() {
  openTagDialogForSelected();
}

// Wire parent action handles once. Methods call component functions that read
// current $state at invoke time — do NOT reassign inside $effect (mutating the
// bindable $state object with new function refs every run causes
// effect_update_depth_exceeded).
function wireSelectionApi() {
  selectionApi.cancel = () => closeContextMenu();
  selectionApi.selectAll = () => selectAllVisible();
  selectionApi.deselectAll = () => deselectAll();
  selectionApi.archive = () => performArchive();
  selectionApi.delete = () => performDelete();
  selectionApi.restore = () => performRestore();
  selectionApi.star = () => {
    void performStarSelected();
  };
  selectionApi.label = () => {
    performLabelSelected();
  };
}
onMount(() => {
  wireSelectionApi();
});

function isDocumentRtl(): boolean {
  if (typeof document === 'undefined') return false;
  return (
    document.documentElement.dir === 'rtl' ||
    getComputedStyle(document.documentElement).direction === 'rtl'
  );
}

/**
 * Map physical swipe direction to action. In RTL, mirror so
 * "swipe toward start" archives and "toward end" deletes (matches LTR muscle memory).
 * Rows collapse briefly so the action feels intentional before the list updates.
 */
function performSwipeAction(direction: 'left' | 'right', email: Email) {
  const run = () => {
    if (emailListTab === 'archived' || emailListTab === 'deleted') {
      void onRestoreEmails([email]);
      return;
    }
    const rtl = isDocumentRtl();
    // LTR: left=delete, right=archive. RTL: physical left=archive, physical right=delete.
    const isDelete = (!rtl && direction === 'left') || (rtl && direction === 'right');
    if (isDelete) {
      void onDeleteEmails([email]);
    } else {
      void onArchiveEmails([email]);
    }
  };

  swipeActionTriggered = true;
  const delay = prefersReducedMotion ? 0 : 240;
  if (!prefersReducedMotion) {
    const next = new Set(exitingEmailIds);
    next.add(email.id);
    exitingEmailIds = next;
  }
  setTimeout(() => {
    run();
    swipeDistance = 0;
    swipeDirection = null;
    swipingEmail = null;
    swipeActionTriggered = false;
    if (exitingEmailIds.has(email.id)) {
      const cleared = new Set(exitingEmailIds);
      cleared.delete(email.id);
      exitingEmailIds = cleared;
    }
  }, delay);
}

// Track per-email favicon loaded state for container styling
let faviconLoaded = $state<Record<string, boolean>>({});

// Extract highlight terms from search query
let highlightTerms = $derived.by(() => {
  const parsed = parseSearchShortcuts(searchQuery);
  return parsed.highlightTerms.filter((t) => !t.includes(':'));
});

// Extract display name from email address
function getDisplayName(email: string, name: string | undefined = undefined): string {
  // Prioritize name over email
  if (name?.trim()) {
    // If name looks like an email address, extract the local part
    if (name.includes('@')) {
      const localPart = name.split('@')[0];
      return localPart.replace(/[._]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
    }
    return name.trim();
  }
  if (!email) return 'Unknown';
  // If email looks like a full email address, extract local part
  if (email.includes('@')) {
    const localPart = email.split('@')[0];
    // Convert john.doe or john_doe to "John Doe"
    return localPart.replace(/[._]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  }
  return email;
}

function handleMouseEnter(email: Email, e: MouseEvent) {
  if (hoverTimer) clearTimeout(hoverTimer);
  // Capture rect synchronously - currentTarget becomes null after the event returns
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  hoverTimer = setTimeout(() => {
    const previewHeight = 240;
    const viewportHeight = windowHeight || window.innerHeight;
    // Prefer showing below, fall back to above if not enough space
    const above = rect.bottom + previewHeight > viewportHeight;
    const y = above ? rect.top - previewHeight - 4 : rect.bottom + 4;
    // Stay within horizontal bounds of the popup
    const x = Math.max(8, Math.min(rect.left, (windowWidth || window.innerWidth) - 288 - 8));
    previewPosition = { x, y, above };
    hoveredEmail = email;
  }, 250);
}

function handleMouseLeave() {
  if (hoverTimer) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }
  hoveredEmail = null;
}
</script>

<svelte:window bind:innerWidth={windowWidth} bind:innerHeight={windowHeight} />

<div class="relative flex flex-col flex-1 min-h-0">
  <!-- Pull-to-refresh overlay (rubber-band + ready check) -->
  {#if pullDistance > 0 || pullRefreshing}
    {@const ready = pullDistance > 60 || pullRefreshing}
    <div
      class="pull-refresh-band absolute top-0 inset-x-0 flex items-center justify-center py-2 z-10 pointer-events-none"
      style="opacity: {pullRefreshing ? 1 : Math.min(pullDistance / 60, 1)}; transform: translateY({pullRefreshing ? 28 : Math.min(pullDistance * 0.55, 48)}px);"
    >
      <span
        class="pull-refresh-icon {ready && !pullRefreshing ? 'is-ready' : ''} {pullRefreshing ? 'animate-spin' : ''}"
        style={pullRefreshing ? '' : `transform: rotate(${refreshRotation}deg);`}
      >
        {#if ready && !pullRefreshing}
          <Icon name="checkCircle" class="w-5 h-5 text-md-success" />
        {:else}
          <Icon name="refresh" class="w-5 h-5 text-md-primary" />
        {/if}
      </span>
      <span class="text-xs font-semibold ms-2 {ready ? 'text-md-success' : 'text-md-primary'}">
        {pullRefreshing
          ? ($t('common.loading') || 'Refreshing…')
          : ready
            ? ($t('emailList.releaseToRefresh') || 'Release to refresh')
            : ($t('emailList.pullToRefresh') || 'Pull to refresh')}
      </span>
    </div>
  {/if}

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={listRootEl}
  class="flex-1 min-h-0 px-0 border-t border-md-outline-variant/30 relative flex flex-col
    {displayedEmails.length === 0 && !loading
      ? 'overflow-hidden'
      : 'overflow-y-auto pb-2'}"
  onpointerdown={onMarqueePointerDown}
  role="region"
  aria-label="Email list"
  ontouchstart={(e) => {
    startY = e.touches[0].clientY;
    isPulling = true;
    pullDistance = 0;
  }}
  ontouchmove={(e) => {
    if (!isPulling || pullRefreshing) return;
    const container = e.currentTarget as HTMLElement | null;
    if (!container || container.scrollTop > 0) return;
    const currentY = e.touches[0].clientY;
    // Rubber-band: dampen distance so pull feels elastic
    const raw = Math.max(0, currentY - startY);
    const dist = Math.min(raw * 0.55, 88);
    if (dist > 0) {
      pullDistance = dist;
      pullToRefresh = pullDistance > 60;
      e.preventDefault();
    }
  }}
  ontouchend={async (e) => {
    const container = e.currentTarget as HTMLElement | null;
    const atTop = !container || container.scrollTop === 0;
    if (pullToRefresh && atTop) {
      pullRefreshing = true;
      try {
        await onRefreshInbox();
      } finally {
        pullRefreshing = false;
      }
    }
    pullToRefresh = false;
    pullDistance = 0;
    isPulling = false;
    startY = 0;
  }}
  onmousedown={(e) => {
    // Touch-first: only arm pull when at top and not a text-select drag intent
    startY = e.clientY;
    isPulling = true;
    pullDistance = 0;
  }}
  onmousemove={(e) => {
    if (!isPulling || e.buttons !== 1 || pullRefreshing) return;
    const container = e.currentTarget as HTMLElement | null;
    if (!container || container.scrollTop > 0) return;
    const raw = Math.max(0, e.clientY - startY);
    const dist = Math.min(raw * 0.55, 88);
    if (dist > 12) {
      pullDistance = dist;
      pullToRefresh = pullDistance > 60;
      e.preventDefault();
    }
  }}
  onmouseup={async (e) => {
    const container = e.currentTarget as HTMLElement | null;
    const atTop = !container || container.scrollTop === 0;
    if (pullToRefresh && atTop) {
      pullRefreshing = true;
      try {
        await onRefreshInbox();
      } finally {
        pullRefreshing = false;
      }
    }
    pullToRefresh = false;
    pullDistance = 0;
    isPulling = false;
    startY = 0;
  }}
  onmouseleave={() => {
    if (pullRefreshing) return;
    pullToRefresh = false;
    pullDistance = 0;
    isPulling = false;
    startY = 0;
  }}
  onscroll={(e) => {
    const container = e.currentTarget as HTMLElement | null;
    if (!container) return;
    const scrollBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (scrollBottom < 100 && displayedEmailCount < filteredEmails.length) {
      loadMoreEmails();
    }
    if (scrollRaf) cancelAnimationFrame(scrollRaf);
    scrollRaf = requestAnimationFrame(() => handleListScroll(e));
  }}
>
  {#if loading && displayedEmails.length === 0}
    <div class="py-2 space-y-2">
      {#each [1, 2, 3] as _}
        <div class="py-2 border-b border-md-outline-variant/30 px-1">
          <div class="flex justify-between mb-1">
            <Skeleton width="6rem" height="0.75rem" />
            <Skeleton width="3rem" height="0.75rem" />
          </div>
          <Skeleton width="75%" height="1rem" />
        </div>
      {/each}
    </div>
  {:else if displayedEmails.length === 0}
    <EmptyState
      iconName={emailListTab === 'archived'
        ? 'archive'
        : emailListTab === 'deleted'
          ? 'trash'
          : 'mail'}
      title={emailListTab === 'archived'
        ? $t('emailList.noArchived')
        : emailListTab === 'deleted'
          ? $t('emailList.noDeleted')
          : emailListTab === 'inbox'
            ? $t('emailList.inboxEmpty')
            : $t('emailList.noEmailsFound')}
      description={emailListTab === 'archived'
        ? $t('emailList.swipeArchiveHint')
        : emailListTab === 'deleted'
          ? $t('emailList.swipeDeleteHint')
          : searchQuery || otpOnly
            ? $t('emailList.adjustFiltersHint')
            : emailListTab === 'inbox'
              ? $t('emailList.emptyInboxHint')
              : $t('emailList.emptyInboxAllHint')}
      actionLabel={
        (emailListTab === 'inbox' || emailListTab === 'all') && (searchQuery || otpOnly)
          ? $t('emailList.clearFilters')
          : ''
      }
      onAction={
        (emailListTab === 'inbox' || emailListTab === 'all') && (searchQuery || otpOnly)
          ? onClearFilters
          : undefined
      }
    />
  {:else}
    {#each renderedEmails as mail, index (mail.id)}
      <!-- Thread header: show before the latestEmail of a multi-email thread -->
      {#if threadGrouping}
        {@const thread = emailThreads.find((t: EmailThread) => t.latestEmail.id === mail.id)}
        {#if thread && thread.emails.length > 1}
          <div class="flex items-center justify-between px-2 py-1 bg-md-secondary-container/40 border-b border-md-outline-variant/30">
            <span class="text-xs font-semibold text-md-primary/80 uppercase tracking-wider truncate max-w-[65%]">
              {thread.normalizedSubject || '(no subject)'}
            </span>
            <button
              class="flex items-center gap-1 text-xs text-md-on-surface/60 hover:text-md-primary transition-colors flex-shrink-0"
              onclick={(e) => { e.stopPropagation(); onToggleThread(thread.id); }}
              aria-label="Toggle thread"
            >
              <span class="bg-md-primary/15 text-md-primary font-semibold px-1.5 py-0.5 rounded-full">{thread.emails.length}</span>
              {#if expandedThreadIds.has(thread.id)}
                <Icon name="chevronUp" class="w-3 h-3" />
              {:else}
                <Icon name="chevronDown" class="w-3 h-3" />
              {/if}
            </button>
          </div>
        {/if}
      {/if}
      <div
        class="relative overflow-hidden border-b border-md-outline-variant/50 density-row {exitingEmailIds.has(mail.id) ? 'email-row-exit' : ''} {threadGrouping && emailThreads.find((t: EmailThread) => t.latestEmail.id !== mail.id && t.emails.some((e: Email) => e.id === mail.id)) ? 'ps-3 bg-md-surface-variant/20' : ''}"
        id="email-item-{mail.id}"
        style={exitingEmailIds.has(mail.id) ? 'max-height: 120px;' : undefined}
      >
        <!-- Swipe action background (icons/text match tab + direction) -->
        {#if swipingEmail === mail && swipeDirection}
          {@const isRestoreTab = emailListTab === 'archived' || emailListTab === 'deleted'}
          {@const rtl = isDocumentRtl()}
          {@const isDeleteSwipe =
            !isRestoreTab &&
            ((!rtl && swipeDirection === 'left') || (rtl && swipeDirection === 'right'))}
          {@const isArchiveSwipe = !isRestoreTab && !isDeleteSwipe}
          <div
            class="absolute inset-0 flex items-center gap-2 px-4 transition-colors duration-200
              {isDeleteSwipe ? 'justify-end bg-md-error' : ''}
              {isArchiveSwipe ? 'justify-start bg-md-tertiary' : ''}
              {isRestoreTab ? (swipeDirection === 'left' ? 'justify-end' : 'justify-start') + ' bg-md-primary' : ''}"
            style="opacity: {Math.abs(swipeDistance) / 120};"
          >
            {#if isRestoreTab}
              <Icon name="refresh" class="w-6 h-6 text-white" />
              <span class="text-white font-medium text-sm">{$t('inbox.emailActions.restore')}</span>
            {:else if isDeleteSwipe}
              <Icon name="trash" class="w-6 h-6 text-white" />
              <span class="text-white font-medium text-sm">{$t('inbox.emailActions.delete')}</span>
            {:else}
              <Icon name="archive" class="w-6 h-6 text-white" />
              <span class="text-white font-medium text-sm">{$t('inbox.emailActions.archive')}</span>
            {/if}
          </div>
        {/if}

        <!-- Email item row: outer div so star is not nested inside a button -->
        <div
          id="email-button-{mail.id}"
          data-marquee-id={mail.id}
          role="button"
          class="w-full text-start border-0 focus:outline-none hover:bg-md-surface-variant/40 duration-150 {mail.id === highlightedEmailId ? 'bg-md-primary/5' : ''} {mail.unread ? 'bg-md-primary/5' : 'bg-transparent'} py-0.5 px-0 flex items-center gap-1 {selectedEmailIds.has(mail.id) ? 'ring-2 ring-md-secondary rounded-lg' : ''}"
          style="transform: translateX({swipingEmail === mail ? swipeDistance : 0}px); transition: {swipeActionTriggered ? 'transform 0.3s' : 'none'}; user-select: none;"
          onmouseenter={(e) => handleMouseEnter(mail, e)}
          onclick={(e) => {
            // Ignore clicks that originated on the star control
            if ((e.target as HTMLElement)?.closest?.('[data-star-btn]')) return;
            // Skip open if this was a marquee drag or long-press select release
            if (marqueeActive || marqueeDidSelect) {
              marqueeDidSelect = false;
              return;
            }
            if (Date.now() < suppressClickUntil) return;
            e.stopPropagation();
            if (Math.abs(swipeDistance) > 5) {
              e.preventDefault();
              return;
            }
            if (selectionMode) {
              toggleEmailSelection(mail.id);
            } else {
              const thread = threadGrouping
                ? emailThreads.find((t: EmailThread) => t.emails.some((e: Email) => e.id === mail.id))
                : null;
              onOpenMessageDetail(thread ? thread.emails : [mail]);
            }
          }}
          ontouchstart={(e) => {
            handleLongPressStart(mail, e);
            handleSwipeStart(mail, e);
          }}
          ontouchend={() => {
            handleLongPressEnd();
            handleSwipeEnd();
          }}
          ontouchmove={(e) => {
            handleLongPressEnd();
            handleSwipeMove(e);
          }}
          onmousedown={(e) => {
            if ((e.target as HTMLElement)?.closest?.('[data-star-btn]')) return;
            handleLongPressStart(mail, e);
            handleSwipeStart(mail, e);
          }}
          onmouseup={() => {
            handleLongPressEnd();
            handleSwipeEnd();
          }}
          onmousemove={(e) => {
            if (e.buttons === 1) handleSwipeMove(e);
          }}
          onmouseleave={() => {
            handleMouseLeave();
            handleLongPressEnd();
            handleSwipeEnd();
          }}
          draggable={selectionMode || selectedEmailIds.has(mail.id)}
          ondragstart={(e) => {
            if (!selectionMode && !selectedEmailIds.has(mail.id)) {
              e.preventDefault();
              return;
            }
            if (e.dataTransfer) {
              // Shared gesture machine: always 'move' (matches strip dropEffect)
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', mail.id);
              // Compact drag chip: first subject only; multi-select shows "+N"
              try {
                const selectedIds = selectedEmailIds.has(mail.id)
                  ? Array.from(selectedEmailIds)
                  : [mail.id];
                const firstSubject = mail.subject || $t('emailList.noSubject');
                const extra = Math.max(0, selectedIds.length - 1);
                const label =
                  extra > 0 ? `${firstSubject} +${extra}` : firstSubject;
                const preview = document.createElement('div');
                preview.className = 'drag-mail-preview';
                preview.style.cssText =
                  'position:fixed;top:-9999px;left:-9999px;max-width:220px;padding:6px 10px;border-radius:10px;background:var(--md-surface-container-high,#2b2930);color:var(--md-on-surface,#e6e1e5);font:12px/1.3 system-ui,sans-serif;font-weight:600;box-shadow:0 6px 16px rgba(0,0,0,.25);pointer-events:none;z-index:99999;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
                preview.textContent = label;
                document.body.appendChild(preview);
                e.dataTransfer.setDragImage(preview, 16, 12);
                setTimeout(() => preview.remove(), 0);
              } catch {
                /* ignore drag image failures */
              }
            }
          }}
          oncontextmenu={(e) => {
            e.preventDefault();
            // Right-click = select item and show selection strip
            selectionMode = true;
            const next = new Set(selectedEmailIds);
            next.add(mail.id);
            selectedEmailIds = next;
            emitSelectionChange();
          }}
          onkeydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              if (selectionMode) toggleEmailSelection(mail.id);
              else {
                const thread = threadGrouping
                  ? emailThreads.find((t: EmailThread) => t.emails.some((em: Email) => em.id === mail.id))
                  : null;
                onOpenMessageDetail(thread ? thread.emails : [mail]);
              }
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              (e.currentTarget.nextElementSibling as HTMLElement)?.focus();
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              (e.currentTarget.previousElementSibling as HTMLElement)?.focus();
            }
          }}
          aria-label={`Email from ${mail.from}: ${mail.subject}`}
          tabindex="0"
        >
        <div class="flex items-center gap-2 px-0 py-0.5 flex-1 min-w-0">

          <!-- Avatar: letter always visible; favicon overlays only after load -->
          {#if mail.from}
            {@const isLoaded = !!faviconLoaded[mail.id]}
            {@const isSelected = selectedEmailIds.has(mail.id)}
            {@const letter = (mail.from_name || mail.from || '?').trim().charAt(0).toUpperCase() || '?'}
            {@const letterBg = mail.unread ? avatarColor(mail.from) : MD3_AVATAR_MUTED}
            <div class="flex-shrink-0 w-[35px] h-[35px] rounded-lg {isSelected ? 'ring-2 ring-md-primary' : ''} {letterBg} overflow-hidden flex items-center justify-center relative">
              <!-- Initial letter always under favicon -->
              <span
                class="absolute inset-0 z-[1] flex items-center justify-center text-sm font-bold text-white select-none pointer-events-none"
                aria-hidden="true"
              >{letter}</span>
              {#if showFavicons || isSelected}
                <FaviconImage
                  email={mail.from}
                  size={32}
                  enabled={showFavicons || isSelected}
                  class="absolute inset-0 z-[2] w-full h-full {isLoaded ? 'opacity-100' : 'opacity-0'}"
                  fallbackLetter={letter}
                  fallbackColor={letterBg}
                  onLoad={() => faviconLoaded[mail.id] = true}
                  onError={() => faviconLoaded[mail.id] = false}
                />
              {/if}
              {#if isSelected}
                <span class="absolute bottom-0 end-0 z-[3] w-3.5 h-3.5 rounded-full bg-md-primary text-md-on-primary flex items-center justify-center">
                  <Icon name="check" class="w-2.5 h-2.5" />
                </span>
              {/if}
            </div>
          {/if}
          <!-- Text -->
          <div class="flex flex-col flex-1 min-w-0">
            <div class="flex items-center justify-between gap-2">
              <span class="text-sm font-bold {mail.unread ? 'text-md-on-surface' : 'text-md-on-surface/70'} truncate leading-tight">{@html highlightMatches(getDisplayName(mail.from, mail.from_name), highlightTerms)}</span>
              <span class="text-xs font-medium {mail.unread ? 'text-md-on-surface/60' : 'text-md-on-surface/40'} flex-shrink-0">{mail.time}</span>
            </div>
            <div class="flex items-start gap-1">
              <!-- col1: subject + body/OTP -->
              <div class="flex flex-col flex-1 min-w-0">
                <p class="text-xs {mail.unread ? 'font-semibold text-md-on-surface' : 'text-md-on-surface/50'} truncate leading-tight">{@html highlightMatches(mail.subject || '(no subject)', highlightTerms)}</p>
                <!-- Single line: truncated body + OTP / label pills at the end -->
                {#if true}
                  {@const bodyPreview = (mail.body_plain || (mail.body_html || mail.body || '').replace(/<[^>]*>/g, '') || '').replace(/\s+/g, ' ').trim()}
                  {@const showOtpPill = !hideOtpLabels && mail.isOtp && !!mail.otp}
                  {@const showMagicPill = !!(mail.hasMagicLink || (mail.magicLinks && mail.magicLinks.length > 0))}
                  {@const showLocalPill = !!mail.local_only}
                  {@const tagList = !hideLabels ? (emailTagsMap[mail.id] || []) : []}
                  {@const maxRowTags = 1}
                  {@const visibleTags = tagList.slice(0, maxRowTags)}
                  {@const overflowTags = tagList.slice(maxRowTags)}
                  {@const hasPills = showOtpPill || showMagicPill || showLocalPill || tagList.length > 0}
                  {#if bodyPreview || hasPills}
                    <div class="flex items-center gap-1 mt-0.5 min-w-0 w-full">
                      {#if bodyPreview}
                        <p class="text-xs text-md-on-surface/60 truncate leading-tight min-w-0 flex-1">{bodyPreview}</p>
                      {/if}
                      {#if hasPills}
                        <div class="flex items-center gap-0.5 shrink-0 max-w-[48%] min-w-0">
                          {#if showLocalPill}
                            {@const deletedWhen = (() => {
                              const ts =
                                (mail as Email & { local_only_since?: number }).local_only_since ||
                                mail.local_deleted_at ||
                                mail.stored_at ||
                                (mail.received_at ? mail.received_at * 1000 : 0);
                              return ts ? timeAgo(ts) : '';
                            })()}
                            <span
                              id="local-badge-{mail.id}"
                              class="px-1.5 py-0 text-xs rounded-full bg-md-tertiary-container text-md-on-tertiary-container shrink-0 cursor-help"
                              title={deletedWhen
                                ? $t('inbox.deletedFromServerAgo', { values: { when: deletedWhen } })
                                : $t('inbox.localOnlyTooltip')}
                            >{$t('inbox.localOnlyBadge')}</span>
                          {/if}
                          {#if showOtpPill}
                            <span
                              id="otp-badge-{mail.id}"
                              role="button"
                              tabindex="0"
                              class="px-1.5 py-0 text-xs rounded-full bg-md-primary/20 text-md-primary cursor-pointer hover:bg-md-primary/30 transition-colors shrink-0 max-w-[5.5rem] truncate"
                              onmousedown={(e) => { e.stopPropagation(); e.preventDefault(); onCopyOtpFromMessage(mail.otp); }}
                              onmouseup={(e) => { e.stopPropagation(); }}
                              onclick={(e) => { e.stopPropagation(); e.preventDefault(); onCopyOtpFromMessage(mail.otp); }}
                              onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); onCopyOtpFromMessage(mail.otp); } }}
                              aria-label={$t('inbox.copyOtpAria')}
                              title={`OTP: ${mail.otp}`}
                            >OTP: {mail.otp}</span>
                          {/if}
                          {#if showMagicPill}
                            <span
                              id="magic-link-badge-{mail.id}"
                              class="px-1.5 py-0 text-xs rounded-full bg-md-tertiary/20 text-md-tertiary shrink-0 max-w-[4rem] truncate"
                              title={mail.magicLinks?.[0]?.host || mail.magicLinks?.[0]?.url || $t('inbox.magicLinkDetected')}
                            >{$t('inbox.magicLinkPill')}</span>
                          {/if}
                          {#each visibleTags as tag (tag)}
                            <span
                              class="px-1.5 py-0 text-xs rounded-full bg-md-primary/20 text-md-primary cursor-pointer hover:bg-md-primary/30 transition-colors shrink-0 max-w-[4rem] truncate"
                              onmousedown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                              onclick={(e) => { e.stopPropagation(); filterByLabel(tag); }}
                              title={$t('inbox.filterByLabel', { values: { label: tag } })}
                              role="button"
                              tabindex="0"
                              onkeydown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); filterByLabel(tag); } }}
                              aria-label={$t('inbox.filterByLabel', { values: { label: tag } })}
                            >{tag}</span>
                          {/each}
                          {#if overflowTags.length > 0}
                            <div class="relative shrink-0">
                              <button
                                type="button"
                                class="px-1.5 py-0 text-xs rounded-full bg-md-surface-variant text-md-on-surface/70 font-semibold hover:bg-md-primary/15 hover:text-md-primary transition-colors"
                                aria-label={$t('inbox.moreLabels', { values: { n: overflowTags.length } })}
                                title={overflowTags.join(', ')}
                                onmousedown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                                onclick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  rowLabelMenuId = rowLabelMenuId === mail.id ? null : mail.id;
                                }}
                              >+{overflowTags.length}</button>
                              {#if rowLabelMenuId === mail.id}
                                <button
                                  type="button"
                                  class="fixed inset-0 z-[400] bg-transparent cursor-default"
                                  aria-label={$t('common.close')}
                                  onmousedown={(e) => e.stopPropagation()}
                                  onclick={(e) => { e.stopPropagation(); rowLabelMenuId = null; }}
                                ></button>
                                <div
                                  class="absolute end-0 top-full mt-1 z-[410] min-w-[100px] max-w-[160px] max-h-36 overflow-y-auto rounded-lg border border-md-outline-variant bg-md-surface shadow-xl p-1"
                                  role="menu"
                                >
                                  {#each overflowTags as tag (tag)}
                                    <button
                                      type="button"
                                      role="menuitem"
                                      class="w-full text-start px-2 py-1 text-xs rounded-md truncate text-md-on-surface hover:bg-md-primary/10 hover:text-md-primary"
                                      onmousedown={(e) => e.stopPropagation()}
                                      onclick={(e) => {
                                        e.stopPropagation();
                                        filterByLabel(tag);
                                        rowLabelMenuId = null;
                                      }}
                                    >{tag}</button>
                                  {/each}
                                </div>
                              {/if}
                            </div>
                          {/if}
                        </div>
                      {/if}
                    </div>
                  {/if}
                {/if}
              </div>
            </div>
          </div>
        </div>

          <!-- Star sibling of content (not nested in invalid button) -->
          <button
            type="button"
            data-star-btn
            id="star-button-{mail.id}"
            class="flex-shrink-0 self-center p-1 me-0.5 rounded transition-colors hover:bg-md-surface-variant/40 cursor-pointer border-0 bg-transparent {isStarredMail(mail) ? 'text-md-tertiary' : 'text-md-on-surface/25'} {starPopId === mail.id ? 'star-pop' : ''}"
            onclick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              void toggleStar(mail);
            }}
            onpointerdown={(e) => {
              e.stopPropagation();
              e.preventDefault();
            }}
            onmousedown={(e) => {
              e.stopPropagation();
              e.preventDefault();
            }}
            onmouseup={(e) => e.stopPropagation()}
            aria-pressed={isStarredMail(mail)}
            aria-label={$t('inbox.emailActions.star')}
            title={$t('inbox.emailActions.star')}
          >
            <Icon
              name="star"
              class="w-5 h-5 transition-colors duration-150 pointer-events-none"
              filled={isStarredMail(mail)}
            />
          </button>
        </div>
      </div>
    {/each}
    {#if renderLimit < displayedEmails.length}
      <div bind:this={listSentinelEl} class="h-8" aria-hidden="true"></div>
      <div class="py-3 text-center">
        <button
          type="button"
          class="px-4 py-1.5 bg-md-surface-variant text-md-on-surface-variant text-xs font-medium rounded-full hover:bg-md-primary hover:text-md-on-primary transition-colors shadow-sm"
          onclick={() => expandRenderWindow()}
        >
          {$t('emailList.loadMore') || 'Load more'} ({displayedEmails.length - renderLimit})
        </button>
      </div>
    {:else if displayedEmailCount < filteredEmails.length}
      <div class="py-3 text-center">
        <button
          type="button"
          class="px-4 py-1.5 bg-md-surface-variant text-md-on-surface-variant text-xs font-medium rounded-full hover:bg-md-primary hover:text-md-on-primary transition-colors shadow-sm"
          onclick={() => loadMoreEmails()}
        >
          {$t('emailList.loadMore') || 'Load more'} ({filteredEmails.length - displayedEmailCount})
        </button>
      </div>
    {/if}
  {/if}
</div>

{#if marqueeActive && marqueeRect}
  <div
    class="fixed pointer-events-none z-[500] border border-md-primary/70 bg-md-primary/15 rounded-sm"
    style="left:{marqueeRect.left}px;top:{marqueeRect.top}px;width:{marqueeRect.right - marqueeRect.left}px;height:{marqueeRect.bottom - marqueeRect.top}px;"
    aria-hidden="true"
  ></div>
{/if}
</div>

<!-- Fallback selection bar when parent does not host the strip (e.g. non-inbox embeds) -->
{#if selectionMode && !externalSelectionBar}
  <div
    class="fixed bottom-20 start-4 end-4 bg-md-surface rounded-full shadow-2xl border border-md-outline-variant overflow-hidden flex items-center gap-1 px-2 py-2 z-50"
    role="toolbar"
    aria-label="Selection actions"
    tabindex="0"
    onkeydown={(e) => { if (e.key === 'Escape') closeContextMenu(); }}
  >
    <button
      type="button"
      class="flex items-center justify-center px-2 h-8 rounded-full hover:bg-md-surface-variant transition-colors flex-shrink-0 text-label-sm font-bold"
      aria-label={$t('inbox.emailActions.deselectAll')}
      onclick={(e) => { e.stopPropagation(); closeContextMenu(); }}
    >
      {$t('inbox.emailActions.deselectAll')} ({selectedEmailIds.size})
    </button>
    <div class="flex-1"></div>
    <button
      class="flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-md-tertiary hover:bg-md-tertiary/10 rounded-full transition-colors"
      aria-label={$t('inbox.emailActions.starSelected')}
      onclick={(e) => { e.stopPropagation(); void performStarSelected(); }}
    >
      <Icon name="star" class="w-4 h-4" />
      <span class="action-strip-btn">{$t('inbox.emailActions.star')} ({selectedEmailIds.size})</span>
    </button>
    <button
      class="flex items-center justify-center gap-1.5 px-2 py-2 text-md-primary hover:bg-md-primary/10 rounded-full transition-colors min-w-0"
      aria-label={$t('inbox.emailActions.labelSelected')}
      onclick={(e) => { e.stopPropagation(); performLabelSelected(); }}
    >
      <Icon name="tag" class="w-4 h-4 shrink-0" />
      <span class="action-strip-btn">{$t('inbox.emailActions.label')}</span>
    </button>
    {#if emailListTab === 'archived' || emailListTab === 'deleted'}
      <button
        class="flex items-center justify-center gap-1.5 px-2 py-2 text-md-primary hover:bg-md-primary/10 rounded-full transition-colors min-w-0"
        aria-label={$t('inbox.emailActions.restoreSelected')}
        onclick={(e) => { e.stopPropagation(); performRestore(); }}
      >
        <Icon name="refresh" class="w-4 h-4 shrink-0" />
        <span class="action-strip-btn">{$t('inbox.emailActions.restore')} ({selectedEmailIds.size})</span>
      </button>
    {/if}
    {#if emailListTab !== 'deleted'}
      <button
        class="flex items-center justify-center gap-1.5 px-2 py-2 text-md-error hover:bg-md-error/10 rounded-full transition-colors min-w-0"
        aria-label={$t('inbox.emailActions.deleteSelected')}
        onclick={(e) => { e.stopPropagation(); performDelete(); }}
      >
        <Icon name="trash" class="w-4 h-4 shrink-0" />
        <span class="action-strip-btn">{$t('inbox.emailActions.delete')} ({selectedEmailIds.size})</span>
      </button>
    {/if}
    {#if emailListTab === 'inbox' || emailListTab === 'all'}
      <button
        class="flex items-center justify-center gap-1.5 px-2 py-2 text-md-primary hover:bg-md-primary/10 rounded-full transition-colors min-w-0"
        aria-label={$t('inbox.emailActions.archiveSelected')}
        onclick={(e) => { e.stopPropagation(); performArchive(); }}
      >
        <Icon name="archive" class="w-4 h-4 shrink-0" />
        <span class="action-strip-btn">{$t('inbox.emailActions.archive')} ({selectedEmailIds.size})</span>
      </button>
    {/if}
  </div>
{/if}

<!-- Label dialog: absolute so it stays inside mainview (not over sidebar) -->
{#if tagDialogOpen}
  <div class="absolute inset-0 z-[9999] flex items-center justify-center p-4" role="dialog" aria-modal="true">
    <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" role="button" tabindex="-1" onclick={(e) => { e.stopPropagation(); closeTagDialog(); }} onkeydown={(e) => e.key === 'Escape' && closeTagDialog()}></div>
    <div class="relative bg-md-surface rounded-2xl shadow-2xl p-4 w-72 z-10 border border-md-outline-variant/30">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-bold text-md-on-surface">
          {tagDialogMultiIds?.length
            ? $t('inbox.emailActions.labelSelected')
            : $t('inbox.emailActions.tag')}
          {#if tagDialogMultiIds?.length}
            <span class="text-md-on-surface/50 font-medium">({tagDialogMultiIds.length})</span>
          {/if}
        </h3>
        <button class="w-7 h-7 flex items-center justify-center rounded-full hover:bg-md-surface-variant transition-colors" onclick={(e) => { e.stopPropagation(); closeTagDialog(); }} aria-label={$t('common.close')}>
          <Icon name="x" class="w-4 h-4 text-md-on-surface/60" />
        </button>
      </div>
      <p class="text-xs text-md-on-surface/60 mb-2">{$t('inbox.labelDialogHint')}</p>
      <input
        type="text"
        class="w-full px-3 py-2 text-sm rounded-lg border border-md-outline-variant bg-md-surface-container-low focus:outline-none focus:border-md-primary focus:ring-1 focus:ring-md-primary"
        placeholder={$t('inbox.labelDialogPlaceholder')}
        bind:value={tagDialogInput}
        onkeydown={(e) => { if (e.key === 'Enter') void saveEmailTags(); else if (e.key === 'Escape') closeTagDialog(); }}
      />
      {#if allEmailTags.length > 0}
        <div class="flex flex-wrap gap-1.5 mt-2">
          {#each allEmailTags as existingTag (existingTag)}
            <button
              type="button"
              class="px-2 py-0.5 text-xs rounded-full bg-md-primary/20 text-md-primary hover:bg-md-primary/30 transition-colors"
              onclick={(e) => {
                e.stopPropagation();
                const parts = tagDialogInput.split(',').map((s) => s.trim()).filter(Boolean);
                if (!parts.includes(existingTag)) {
                  tagDialogInput = parts.length ? `${parts.join(', ')}, ${existingTag}` : existingTag;
                }
              }}
            >{existingTag}</button>
          {/each}
        </div>
      {/if}
      <div class="flex gap-2 mt-3">
        <button type="button" class="flex-1 py-1.5 text-sm rounded-xl bg-md-secondary-container text-md-on-secondary-container hover:bg-md-secondary-container/80 transition-colors" onclick={(e) => { e.stopPropagation(); closeTagDialog(); }}>{$t('common.cancel')}</button>
        <button type="button" class="flex-1 py-1.5 text-sm rounded-xl bg-md-primary text-md-on-primary hover:bg-md-primary/90 transition-colors" onclick={(e) => { e.stopPropagation(); void saveEmailTags(); }}>{$t('common.save')}</button>
      </div>
    </div>
  </div>
{/if}

<!-- Email Preview Popup — subject + body only (no sender) -->
{#if hoveredEmail && emailPreviewEnabled}
  <div
    class="fixed bg-md-surface-container border border-md-outline-variant rounded-xl shadow-2xl z-[999] w-72 max-h-60 overflow-y-auto pointer-events-none"
    style="left: {previewPosition.x}px; top: {previewPosition.y}px;"
    role="tooltip"
    aria-label={$t('emailList.previewAria')}
  >
    <div class="p-3 space-y-2">
      <div class="border-b border-md-outline-variant/30 pb-2">
        <div class="flex items-start justify-between gap-2">
          <div class="text-xs font-semibold text-md-on-surface line-clamp-2 min-w-0">
            {hoveredEmail.subject || $t('emailList.noSubject')}
          </div>
          <span class="text-xs text-md-on-surface/50 flex-shrink-0">{hoveredEmail.time}</span>
        </div>
      </div>

      {#if hoveredEmail.isOtp}
        <span class="inline-flex px-2 py-0.5 text-xs rounded-full bg-md-primary/20 text-md-primary font-medium">
          OTP: {hoveredEmail.otp}
        </span>
      {/if}

      <div class="text-label-sm text-md-on-surface-variant leading-relaxed text-justify line-clamp-6">
        {#if hoveredEmail.body_plain}
          {hoveredEmail.body_plain.trim().slice(0, 400)}
        {:else if hoveredEmail.body_html}
          {hoveredEmail.body_html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400)}
        {:else}
          <span class="italic opacity-50">{$t('emailList.noPreview')}</span>
        {/if}
      </div>
    </div>
  </div>
{/if}
