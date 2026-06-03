<script lang="ts">
import { onDestroy, onMount } from 'svelte';
import { browser } from 'wxt/browser';
import Icon from '@/components/icons/Icon.svelte';
import EmptyState from '@/components/ui/EmptyState.svelte';
import FaviconImage from '@/components/ui/FaviconImage.svelte';
import Skeleton from '@/components/ui/Skeleton.svelte';
import type { EmailThread } from '@/utils/email-threads.js';
import { logDebug, logError } from '@/utils/logger.js';
import { highlightMatches, parseSearchShortcuts } from '@/utils/search-shortcuts.js';
import type { Email } from '@/utils/types.js';

let {
  displayedEmails = [],
  filteredEmails = [],
  displayedEmailCount = 0,
  loading = false,
  searchQuery = '',
  otpOnly = false,
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
  emailListTab = 'inbox',
  onArchiveEmails = (_emails: Email[]) => {},
  onDeleteEmails = (_emails: Email[]) => {},
  onRestoreEmails = (_emails: Email[]) => {},
} = $props<{
  displayedEmails?: Email[];
  filteredEmails?: Email[];
  displayedEmailCount?: number;
  loading?: boolean;
  searchQuery?: string;
  otpOnly?: boolean;
  onOpenMessageDetail?: (email: Email) => void;
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
  emailListTab?: 'inbox' | 'all' | 'archived' | 'deleted';
  onArchiveEmails?: (emails: Email[]) => void | Promise<void>;
  onDeleteEmails?: (emails: Email[]) => void | Promise<void>;
  onRestoreEmails?: (emails: Email[]) => void | Promise<void>;
}>();

// Pull-to-refresh state
let pullToRefresh = $state(false);
let pullDistance = $state(0);
let startY = $state(0);
let isPulling = $state(false);
let refreshRotation = $derived(pullDistance * 4.5); // Rotate icon based on pull distance

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

// Multi-select state
let selectionMode = $state(false);
let selectedEmailIds = $state<Set<string>>(new Set());

// Starred emails
let starredEmailIds = $state<Set<string>>(new Set());

// Sort starred emails to the top
let sortedDisplayedEmails = $derived.by(() => {
  if (starredEmailIds.size === 0) return displayedEmails;
  const starred: Email[] = [];
  const rest: Email[] = [];
  for (const email of displayedEmails) {
    (starredEmailIds.has(email.id) ? starred : rest).push(email);
  }
  return [...starred, ...rest];
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

function openTagDialog(emailId: string) {
  tagDialogEmailId = emailId;
  const tags = emailTagsMap[emailId];
  tagDialogInput = (Array.isArray(tags) ? tags : []).join(', ');
  tagDialogOpen = true;
}

function closeTagDialog() {
  tagDialogOpen = false;
  tagDialogEmailId = null;
  tagDialogInput = '';
}

async function saveEmailTags() {
  if (!tagDialogEmailId) return;
  const tags = tagDialogInput
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  if (tags.length === 0) {
    const next = { ...emailTagsMap };
    delete next[tagDialogEmailId];
    emailTagsMap = next;
  } else {
    emailTagsMap = { ...emailTagsMap, [tagDialogEmailId]: tags };
  }
  await saveEmailTagsToStorage();
  closeTagDialog();
}

async function removeEmailTag(emailId: string, tag: string) {
  const current = emailTagsMap[emailId] || [];
  const next = current.filter((t) => t !== tag);
  if (next.length === 0) {
    const map = { ...emailTagsMap };
    delete map[emailId];
    emailTagsMap = map;
  } else {
    emailTagsMap = { ...emailTagsMap, [emailId]: next };
  }
  await saveEmailTagsToStorage();
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

async function toggleStar(emailId: string) {
  const updated = new Set(starredEmailIds);
  if (updated.has(emailId)) {
    updated.delete(emailId);
  } else {
    updated.add(emailId);
  }
  starredEmailIds = updated;
  await browser.storage.local.set({ starredEmails: Array.from(updated) });
}

onMount(() => {
  loadEmailTags();
  loadStarredEmails();

  const handleStorageChange = (
    changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
    areaName: string
  ) => {
    if (areaName !== 'local') return;
    if (changes.emailTags) loadEmailTags();
    if (changes.starredEmails) loadStarredEmails();
  };

  browser.storage.onChanged.addListener(handleStorageChange);
  onDestroy(() => {
    browser.storage.onChanged.removeListener(handleStorageChange);
    if (hoverTimer) clearTimeout(hoverTimer);
    if (longPressTimer) clearTimeout(longPressTimer);
  });
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

function handleLongPressStart(email: Email, e: TouchEvent | MouseEvent) {
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
    contextMenuOpen = true;
    const touch = 'touches' in e ? e.touches[0] : e;
    contextMenuPosition = { x: touch.clientX, y: touch.clientY };
  }, 500);
}

function handleLongPressEnd() {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

function closeContextMenu() {
  contextMenuOpen = false;
  longPressEmail = null;
  selectionMode = false;
  selectedEmailIds = new Set();
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

function performSwipeAction(direction: 'left' | 'right', email: Email) {
  if (emailListTab === 'archived' || emailListTab === 'deleted') {
    void onRestoreEmails([email]);
  } else if (direction === 'left') {
    void onDeleteEmails([email]);
  } else {
    void onArchiveEmails([email]);
  }
  swipeActionTriggered = true;
  setTimeout(() => {
    swipeDistance = 0;
    swipeDirection = null;
    swipingEmail = null;
    swipeActionTriggered = false;
  }, 300);
}

// Track per-email favicon loaded state for container styling
let faviconLoaded = $state<Record<string, boolean>>({});

// Extract highlight terms from search query
let highlightTerms = $derived.by(() => {
  const parsed = parseSearchShortcuts(searchQuery);
  return parsed.highlightTerms.filter((t) => !t.includes(':'));
});

// Extract display name from email address
function getDisplayName(email: string, name?: string): string {
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

const AVATAR_COLORS = [
  'bg-teal-600',
  'bg-emerald-700',
  'bg-pink-600',
  'bg-indigo-600',
  'bg-violet-600',
  'bg-orange-600',
  'bg-cyan-700',
  'bg-rose-600',
];

function avatarColor(email: string): string {
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = (hash * 31 + email.charCodeAt(i)) & 0xffff;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function handleMouseEnter(email: Email, e: MouseEvent) {
  if (hoverTimer) clearTimeout(hoverTimer);
  // Capture rect synchronously — currentTarget becomes null after the event returns
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

function stripHtml(html: string): string {
  return new DOMParser().parseFromString(html, 'text/html').body.textContent || '';
}
</script>

<svelte:window bind:innerWidth={windowWidth} bind:innerHeight={windowHeight} />

<div class="relative flex flex-col flex-1 min-h-0">
  <!-- Pull-to-refresh overlay (outside scrollable area) -->
  {#if pullDistance > 0}
    <div
      class="absolute top-0 left-0 right-0 flex items-center justify-center py-2 z-10 pointer-events-none"
      style="opacity: {Math.min(pullDistance / 60, 1)}; transform: translateY({Math.min(pullDistance - 10, 50)}px); transition: opacity 0.1s;"
    >
      <span style="transform: rotate({refreshRotation}deg); display: inline-block;">
        <Icon name="refresh" class="w-5 h-5 text-md-primary" />
      </span>
      <span class="text-xs text-md-primary ml-2 font-semibold">
        {pullDistance > 60 ? 'Release to refresh' : 'Pull to refresh'}
      </span>
    </div>
  {/if}

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="flex-1 px-1 border-t border-md-secondary-container overflow-y-auto pb-[120px] relative"
  role="region"
  aria-label="Email list"
  ontouchstart={(e) => {
    startY = e.touches[0].clientY;
    isPulling = true;
    pullDistance = 0;
  }}
  ontouchmove={(e) => {
    if (!isPulling) return;
    const container = e.currentTarget as HTMLElement;
    if (container.scrollTop > 0) return;
    const currentY = e.touches[0].clientY;
    const dist = currentY - startY;
    if (dist > 0) {
      pullDistance = Math.min(dist, 80);
      pullToRefresh = pullDistance > 60;
      e.preventDefault();
    }
  }}
  ontouchend={async (e) => {
    const container = e.currentTarget as HTMLElement;
    if (pullToRefresh && container.scrollTop === 0) {
      await onRefreshInbox();
    }
    pullToRefresh = false;
    pullDistance = 0;
    isPulling = false;
    startY = 0;
  }}
  onmousedown={(e) => {
    startY = e.clientY;
    isPulling = true;
    pullDistance = 0;
  }}
  onmousemove={(e) => {
    if (!isPulling || e.buttons !== 1) return;
    const container = e.currentTarget as HTMLElement;
    if (container.scrollTop > 0) return;
    const currentY = e.clientY;
    const dist = currentY - startY;
    if (dist > 0) {
      pullDistance = Math.min(dist, 80);
      pullToRefresh = pullDistance > 60;
      e.preventDefault();
    }
  }}
  onmouseup={async (e) => {
    const container = e.currentTarget as HTMLElement;
    if (pullToRefresh && container.scrollTop === 0) {
      await onRefreshInbox();
    }
    pullToRefresh = false;
    pullDistance = 0;
    isPulling = false;
    startY = 0;
  }}
  onmouseleave={() => {
    pullToRefresh = false;
    pullDistance = 0;
    isPulling = false;
    startY = 0;
  }}
  onscroll={(e) => {
    const container = e.currentTarget as HTMLElement;
    const scrollBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (scrollBottom < 100 && displayedEmailCount < filteredEmails.length) {
      loadMoreEmails();
    }
  }}
>
  {#if loading}
    <div class="py-2 space-y-2">
      {#each [1, 2, 3] as _}
        <div class="py-2 border-b border-md-secondary-container px-1">
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
      icon={emailListTab === 'archived'
        ? "<svg xmlns='http://www.w3.org/2000/svg' class='w-8 h-8 text-md-on-surface/40' fill='none' viewBox='0 0 24 24' stroke='currentColor' stroke-width='2'><path stroke-linecap='round' stroke-linejoin='round' d='M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z'/></svg>"
        : emailListTab === 'deleted'
          ? "<svg xmlns='http://www.w3.org/2000/svg' class='w-8 h-8 text-md-on-surface/40' fill='none' viewBox='0 0 24 24' stroke='currentColor' stroke-width='2'><path stroke-linecap='round' stroke-linejoin='round' d='M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0'/></svg>"
          : "<svg xmlns='http://www.w3.org/2000/svg' class='w-8 h-8 text-md-on-surface/40' fill='none' viewBox='0 0 24 24' stroke='currentColor' stroke-width='2'><path stroke-linecap='round' stroke-linejoin='round' d='M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75'/></svg>"}
      title={emailListTab === 'archived' ? "No archived emails" : emailListTab === 'deleted' ? "No deleted emails" : emailListTab === 'inbox' ? "Inbox is empty" : "No emails found"}
      description={emailListTab === 'archived'
        ? "Swipe right on an email to archive it."
        : emailListTab === 'deleted'
          ? "Swipe left on an email to delete it. Deleted emails can be restored here."
          : searchQuery || otpOnly ? "Try adjusting your filters or search terms" : emailListTab === 'inbox' ? "Your inbox is empty. Archived or deleted emails won't show here." : "Your inbox is empty. Emails will appear here when they arrive."}
      actionLabel={(emailListTab === 'inbox' || emailListTab === 'all') && !searchQuery && !otpOnly ? "Refresh Inbox" : (emailListTab === 'inbox' || emailListTab === 'all') ? "Clear Filters" : ""}
      onAction={(emailListTab === 'inbox' || emailListTab === 'all') && !searchQuery && !otpOnly
        ? () => onRefreshInbox()
        : (emailListTab === 'inbox' || emailListTab === 'all') ? onClearFilters : () => {}}
    />
  {:else}
    {#each sortedDisplayedEmails as mail, index}
      <!-- Thread header: show before the latestEmail of a multi-email thread -->
      {#if threadGrouping}
        {@const thread = emailThreads.find((t: EmailThread) => t.latestEmail.id === mail.id)}
        {#if thread && thread.emails.length > 1}
          <div class="flex items-center justify-between px-2 py-1 bg-md-secondary-container/40 border-b border-md-outline-variant/30">
            <span class="text-[10px] font-semibold text-md-primary/80 uppercase tracking-wider truncate max-w-[65%]">
              {thread.normalizedSubject || '(no subject)'}
            </span>
            <button
              class="flex items-center gap-1 text-[10px] text-md-on-surface/60 hover:text-md-primary transition-colors flex-shrink-0"
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
      <div class="relative overflow-hidden border-b border-md-outline-variant/50 {threadGrouping && emailThreads.find((t: EmailThread) => t.latestEmail.id !== mail.id && t.emails.some((e: Email) => e.id === mail.id)) ? 'pl-3 bg-md-surface-variant/20' : ''}" id="email-item-{mail.id}">
        <!-- Swipe action background (delete/archive/restore) -->
        {#if swipingEmail === mail && swipeDirection}
          <div
            class="absolute inset-0 flex items-center justify-end gap-2 px-4 transition-colors duration-200"
            class:bg-red-500={swipeDirection === 'left' && emailListTab === 'all'}
            class:bg-blue-500={swipeDirection === 'right' && emailListTab === 'all'}
            class:bg-md-primary={emailListTab !== 'all'}
            style="opacity: {Math.abs(swipeDistance) / 120};"
          >
            {#if emailListTab === 'all'}
              {#if swipeDirection === 'left'}
                <Icon name="trash" class="w-6 h-6 text-white" />
                <span class="text-white font-medium">Delete</span>
              {:else}
                <Icon name="archive" class="w-6 h-6 text-white" />
                <span class="text-white font-medium">Archive</span>
              {/if}
            {:else}
              <Icon name="refresh" class="w-6 h-6 text-white" />
              <span class="text-white font-medium">Restore</span>
            {/if}
          </div>
        {/if}

        <!-- Email item -->
        <button
          id="email-button-{mail.id}"
          class="w-full text-left border-0 focus:outline-none hover:bg-md-surface-variant/40 duration-150 {mail.id === highlightedEmailId ? 'bg-md-primary/5' : ''} {mail.unread ? 'bg-md-primary/5' : 'bg-transparent'} py-1 px-1"
          style="transform: translateX({swipingEmail === mail ? swipeDistance : 0}px); transition: {swipeActionTriggered ? 'transform 0.3s' : 'none'}; user-select: none;"
          onmouseenter={(e) => handleMouseEnter(mail, e)}
          onclick={(e) => { e.stopPropagation(); if (Math.abs(swipeDistance) > 5) { e.preventDefault(); return; } if (selectionMode) { toggleEmailSelection(mail.id); } else { onOpenMessageDetail(mail); } }}
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
          oncontextmenu={(e) => { e.preventDefault(); }}
          onkeydown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); (e.currentTarget.nextElementSibling as HTMLElement)?.focus(); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); (e.currentTarget.previousElementSibling as HTMLElement)?.focus(); }
          }}
          aria-label={`Email from ${mail.from}: ${mail.subject}`}
          tabindex="0"
        >
        <div class="flex items-center gap-2 px-0 py-0.5 ">

          <!-- Avatar: letter shown until favicon loads, then replaced -->
          {#if mail.from}
            {@const isLoaded = !!faviconLoaded[mail.id]}
            <div class="flex-shrink-0 w-[35px] h-[35px] rounded-lg {selectedEmailIds.has(mail.id) ? 'bg-md-primary' : (isLoaded ? 'bg-md-surface-container-low' : (mail.unread ? avatarColor(mail.from) : 'bg-gray-400'))} overflow-hidden flex items-center justify-center relative">
              {#if selectedEmailIds.has(mail.id)}
                <!-- Tick icon when selected -->
                <Icon name="check" class="w-6 h-6 text-white" stroke-width="3" />
              {:else}
                <FaviconImage
                  email={mail.from}
                  size={32}
                  class="absolute inset-0 w-full h-full object-cover {isLoaded ? 'opacity-100' : 'opacity-0'}"
                  fallbackLetter={(mail.from_name || mail.from || '?')[0].toUpperCase()}
                  fallbackColor={mail.unread ? avatarColor(mail.from) : 'bg-gray-400'}
                  onLoad={() => faviconLoaded[mail.id] = true}
                  onError={() => faviconLoaded[mail.id] = false}
                />
              {/if}
            </div>
          {/if}          <!-- Text -->
          <div class="flex flex-col flex-1 min-w-0">
            <div class="flex items-center justify-between gap-2">
              <span class="text-sm font-bold {mail.unread ? 'text-md-on-surface' : 'text-md-on-surface/70'} truncate leading-tight">{@html highlightMatches(getDisplayName(mail.from, mail.from_name), highlightTerms)}</span>
              <span class="text-[10px] font-medium {mail.unread ? 'text-md-on-surface/60' : 'text-md-on-surface/40'} flex-shrink-0">{mail.time}</span>
            </div>
            <div class="flex items-start gap-1">
              <!-- col1: subject + body/OTP -->
              <div class="flex flex-col flex-1 min-w-0">
                <p class="text-xs {mail.unread ? 'font-semibold text-md-on-surface' : 'text-md-on-surface/50'} truncate leading-tight">{@html highlightMatches(mail.subject || '(no subject)', highlightTerms)}</p>
                <div class="flex items-center gap-1 mt-1 flex-wrap">
                  {#if mail.local_only}
                    <span id="local-badge-{mail.id}" class="px-2 py-0.5 text-xs rounded-full bg-amber-500/20 text-amber-600 flex-shrink-0">Local</span>
                  {/if}
                  {#if mail.isOtp}
                    <span
                      id="otp-badge-{mail.id}"
                      role="button"
                      tabindex="0"
                      class="px-2 py-0.5 text-xs rounded-full bg-md-primary/20 text-md-primary cursor-pointer hover:bg-md-primary/30 transition-colors flex-shrink-0"
                      onmousedown={(e) => { e.stopPropagation(); e.preventDefault(); onCopyOtpFromMessage(mail.otp); }}
                      onmouseup={(e) => { e.stopPropagation(); }}
                      onclick={(e) => { e.stopPropagation(); e.preventDefault(); onCopyOtpFromMessage(mail.otp); }}
                      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); onCopyOtpFromMessage(mail.otp); } }}
                      aria-label={`Copy OTP code ${mail.otp}`}
                    >OTP: {mail.otp}</span>
                  {/if}
                  {#if emailTagsMap[mail.id]?.length}
                    {#each emailTagsMap[mail.id] as tag}
                      <span
                        class="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-semibold rounded-full bg-md-primary/15 text-md-primary cursor-pointer hover:bg-md-primary/25 transition-colors flex-shrink-0"
                        onmousedown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                        onclick={(e) => { e.stopPropagation(); removeEmailTag(mail.id, tag); }}
                        title="Remove tag '{tag}'"
                        role="button"
                        tabindex="0"
                        onkeydown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); removeEmailTag(mail.id, tag); } }}
                        aria-label="Remove tag {tag}"
                      >{tag} ×</span>
                    {/each}
                  {/if}
                </div>
                {#if !mail.isOtp && (mail.body_plain || mail.body)}
                  <p class="text-xs text-md-on-surface/60 truncate leading-tight">{(mail.body_plain || (mail.body_html || '').replace(/<[^>]*>/g, '')) || ''}</p>
                {/if}
              </div>
              <!-- col2: star (div to avoid nested button, intercepts via mousedown) -->
              <div
                id="star-button-{mail.id}"
                role="button"
                tabindex="0"
                class="flex-shrink-0 self-center p-0.5 rounded transition-colors hover:bg-md-surface-variant/40 cursor-pointer {starredEmailIds.has(mail.id) ? 'text-amber-400' : 'text-md-on-surface/25'}"
                onmousedown={(e) => { e.stopPropagation(); e.preventDefault(); toggleStar(mail.id); }}
                onclick={(e) => { e.stopPropagation(); e.preventDefault(); }}
                onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); toggleStar(mail.id); } }}
                aria-label={starredEmailIds.has(mail.id) ? 'Unstar email' : 'Star email'}
              >
                <Icon name="star" class="w-5 h-5" viewBox="0 0 24 24" fill={starredEmailIds.has(mail.id) ? 'currentColor' : 'none'} />
              </div>
            </div>
          </div>

        </div>
      </button>
      </div>
    {/each}
    {#if displayedEmailCount < filteredEmails.length}
      <div class="text-center py-2 text-xs text-md-on-surface/50">
        <span class="loading loading-spinner loading-xs"></span>
        Loading more emails...
      </div>
    {/if}
  {/if}
</div>
</div>

<!-- Selection action pill - fixed bottom -->
{#if selectionMode}
  <div
    class="fixed bottom-20 left-4 right-4 bg-md-surface rounded-full shadow-2xl border border-md-outline-variant overflow-hidden flex items-center gap-1 px-2 py-2 z-50"
    role="toolbar"
    aria-label="Selection actions"
    tabindex="0"
    onkeydown={(e) => { if (e.key === 'Escape') closeContextMenu(); }}
  >
    <!-- Close / count -->
    <button
      class="flex items-center justify-center w-8 h-8 rounded-full hover:bg-md-surface-variant transition-colors flex-shrink-0"
      aria-label="Cancel selection"
      onclick={(e) => { e.stopPropagation(); closeContextMenu(); }}
    >
      <Icon name="x" class="w-4 h-4 text-md-on-surface/60" />
    </button>
    <span class="text-xs font-semibold text-md-on-surface/70 px-1 flex-shrink-0">{selectedEmailIds.size} selected</span>
    <div class="flex-1"></div>
    {#if emailListTab === 'archived' || emailListTab === 'deleted'}
      <button
        class="flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium text-md-primary hover:bg-md-primary/10 rounded-full transition-colors"
        aria-label="Restore selected"
        onclick={(e) => { e.stopPropagation(); performRestore(); }}
      >
        <Icon name="refresh" class="w-4 h-4" />
        <span>Restore</span>
      </button>
      <div class="w-px h-6 bg-md-outline-variant/50"></div>
    {/if}
    {#if emailListTab !== 'deleted'}
      <button
        class="flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium text-md-error hover:bg-md-error/10 rounded-full transition-colors"
        aria-label="Delete selected"
        onclick={(e) => { e.stopPropagation(); performDelete(); }}
      >
        <Icon name="trash" class="w-4 h-4" />
        <span>Delete</span>
      </button>
      <div class="w-px h-6 bg-md-outline-variant/50"></div>
    {/if}
    {#if emailListTab === 'inbox' || emailListTab === 'all'}
      <button
        class="flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium text-md-primary hover:bg-md-primary/10 rounded-full transition-colors"
        aria-label="Archive selected"
        onclick={(e) => { e.stopPropagation(); performArchive(); }}
      >
        <Icon name="archive" class="w-4 h-4" />
        <span>Archive</span>
      </button>
      <div class="w-px h-6 bg-md-outline-variant/50"></div>
    {/if}
    <button
      class="flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium text-md-on-surface/70 hover:bg-md-surface-variant/30 rounded-full transition-colors"
      aria-label="Tag selected"
      onclick={(e) => {
        e.stopPropagation();
        const id = selectedEmailIds.size === 1 ? Array.from(selectedEmailIds)[0] : (longPressEmail?.id ?? null);
        closeContextMenu();
        if (id) openTagDialog(id);
      }}
    >
      <Icon name="tag" class="w-4 h-4" />
      <span>Tag</span>
    </button>
  </div>
{/if}

<!-- Email Tag Dialog -->
{#if tagDialogOpen}
  <div class="fixed inset-0 z-[1000] flex items-center justify-center">
    <div class="absolute inset-0 bg-black/30 backdrop-blur-sm" role="button" tabindex="-1" onclick={(e) => { e.stopPropagation(); closeTagDialog(); }} onkeydown={(e) => e.key === 'Escape' && closeTagDialog()}></div>
    <div class="relative bg-md-surface rounded-2xl shadow-2xl p-4 w-72 z-10">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-bold text-md-on-surface">Tag Email</h3>
        <button class="w-7 h-7 flex items-center justify-center rounded-full hover:bg-md-surface-variant transition-colors" onclick={(e) => { e.stopPropagation(); closeTagDialog(); }} aria-label="Close">
          <Icon name="x" class="w-4 h-4 text-md-on-surface/60" />
        </button>
      </div>
      <p class="text-xs text-md-on-surface/60 mb-2">Enter comma-separated tags (e.g. Banking, Shopping)</p>
      <input
        type="text"
        class="w-full px-3 py-2 text-sm rounded-lg border border-md-outline-variant bg-md-surface-container-low focus:outline-none focus:border-md-primary focus:ring-1 focus:ring-md-primary"
        placeholder="e.g. Banking, Shopping"
        bind:value={tagDialogInput}
        onkeydown={(e) => { if (e.key === 'Enter') saveEmailTags(); else if (e.key === 'Escape') closeTagDialog(); }}
      />
      {#if allEmailTags.length > 0}
        <div class="flex flex-wrap gap-1.5 mt-2">
          {#each allEmailTags as t}
            <button
              class="px-2 py-0.5 text-[10px] rounded-full bg-md-primary/10 text-md-primary hover:bg-md-primary/20 transition-colors"
              onclick={(e) => { e.stopPropagation(); tagDialogInput = tagDialogInput ? `${tagDialogInput}, ${t}` : t; }}
            >{t}</button>
          {/each}
        </div>
      {/if}
      <div class="flex gap-2 mt-3">
        <button class="flex-1 py-1.5 text-sm rounded-xl bg-md-secondary-container text-md-on-secondary-container hover:bg-md-secondary-container/80 transition-colors" onclick={(e) => { e.stopPropagation(); closeTagDialog(); }}>Cancel</button>
        <button class="flex-1 py-1.5 text-sm rounded-xl bg-md-primary text-md-on-primary hover:bg-md-primary/90 transition-colors" onclick={(e) => { e.stopPropagation(); saveEmailTags(); }}>Save</button>
      </div>
    </div>
  </div>
{/if}

<!-- Email Preview Popup -->
{#if hoveredEmail && emailPreviewEnabled}
  <div
    class="fixed bg-md-surface border border-md-outline-variant rounded-xl shadow-2xl z-[999] w-72 max-h-60 overflow-y-auto pointer-events-none"
    style="left: {previewPosition.x}px; top: {previewPosition.y}px;"
    role="tooltip"
    aria-label="Email preview"
  >
    <div class="p-3 space-y-2">
      <!-- Header -->
      <div class="border-b border-md-outline-variant/30 pb-2">
        <div class="flex items-center justify-between gap-2 mb-0.5">
          <span class="text-xs font-bold text-md-on-surface truncate">
            {hoveredEmail.from_name || hoveredEmail.from || 'Unknown'}
          </span>
          <span class="text-[10px] text-md-on-surface/50 flex-shrink-0">{hoveredEmail.time}</span>
        </div>
        <div class="text-xs text-md-primary/80 font-medium truncate">{hoveredEmail.subject || '(no subject)'}</div>
        {#if hoveredEmail.from_name && hoveredEmail.from}
          <div class="text-[10px] text-md-on-surface/40 truncate">{hoveredEmail.from}</div>
        {/if}
      </div>
      
      <!-- OTP badge if present -->
      {#if hoveredEmail.isOtp}
        <span class="inline-flex px-2 py-0.5 text-[10px] rounded-full bg-md-primary/20 text-md-primary font-medium">
          OTP: {hoveredEmail.otp}
        </span>
      {/if}

      <!-- Body preview -->
      <div class="text-[11px] text-md-on-surface/70 leading-relaxed line-clamp-5">
        {#if hoveredEmail.body_plain}
          {hoveredEmail.body_plain.trim().slice(0, 400)}
        {:else if hoveredEmail.body_html}
          {hoveredEmail.body_html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400)}
        {:else}
          <span class="italic opacity-50">No preview available</span>
        {/if}
      </div>
    </div>
  </div>
{/if}


