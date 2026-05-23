<script lang="ts">
import { browser } from 'wxt/browser';
import IconCopy from '@/components/icons/IconCopy.svelte';
import IconMail from '@/components/icons/IconMail.svelte';
import IconTrash from '@/components/icons/IconTrash.svelte';
import EmptyState from '@/components/ui/EmptyState.svelte';
import FaviconImage from '@/components/ui/FaviconImage.svelte';
import Skeleton from '@/components/ui/Skeleton.svelte';
import { logDebug, logError } from '@/utils/logger.js';
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

$effect(() => {
  loadStarredEmails();
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
    swipeActionTriggered = true;
    // Close the context menu after a brief delay
    setTimeout(() => {
      swipeDistance = 0;
      swipeDirection = null;
      swipingEmail = null;
      swipeActionTriggered = false;
    }, 300);
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

// Track per-email favicon loaded state for container styling
let faviconLoaded = $state<Record<string, boolean>>({});

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
</script>

<div class="relative">
  <!-- Pull-to-refresh overlay (outside scrollable area) -->
  {#if pullDistance > 0}
    <div
      class="absolute top-0 left-0 right-0 flex items-center justify-center py-2 z-10 bg-md-surface pointer-events-none"
      style="opacity: {Math.min(pullDistance / 60, 1)}; transform: translateY({Math.min(pullDistance - 10, 50)}px); transition: opacity 0.1s;"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="w-5 h-5 text-md-primary"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="2"
        style="transform: rotate({refreshRotation}deg);"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
        />
      </svg>
      <span class="text-xs text-md-primary ml-2 font-semibold">
        {pullDistance > 60 ? 'Release to refresh' : 'Pull to refresh'}
      </span>
    </div>
  {/if}

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<!-- Pull-to-refresh gesture area: touch/mouse handlers are intentional for mobile refresh functionality -->
<!-- This is a scrollable list region that supports pull-to-refresh gesture -->
<div
  class="flex-1 px-1 border-t border-md-secondary-container {displayedEmails.length > 0 ? 'overflow-y-auto' : ''} relative"
  style="max-height: 300px; padding-bottom: 120px; scrollbar-width: thin; scrollbar-color: var(--md-primary) transparent;"
  role="region"
  aria-label="Email list with pull-to-refresh"
  aria-hidden="false"
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
      icon="<svg xmlns='http://www.w3.org/2000/svg' class='w-8 h-8 text-md-on-surface/40' fill='none' viewBox='0 0 24 24' stroke='currentColor' stroke-width='2'><path stroke-linecap='round' stroke-linejoin='round' d='M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75'/></svg>"
      title="No emails found"
      description={searchQuery || otpOnly ? "Try adjusting your filters or search terms" : "Your inbox is empty. Emails will appear here when they arrive."}
      actionLabel={searchQuery || otpOnly ? "Clear Filters" : "Refresh Inbox"}
      onAction={searchQuery || otpOnly ? onClearFilters : () => onRefreshInbox()}
    />
  {:else}
    {#each displayedEmails as mail, index}
      <div class="relative overflow-hidden border-b border-md-outline-variant/50" id="email-item-{mail.id}">
        <!-- Swipe action background (delete/archive) -->
        {#if swipingEmail === mail && swipeDirection}
          <div
            class="absolute inset-0 flex items-center justify-end gap-2 px-4 transition-colors duration-200"
            class:bg-red-500={swipeDirection === 'left'}
            class:bg-blue-500={swipeDirection === 'right'}
            style="opacity: {Math.abs(swipeDistance) / 120};"
          >
            {#if swipeDirection === 'left'}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="w-6 h-6 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
              <span class="text-white font-medium">Delete</span>
            {:else}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="w-6 h-6 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
                />
              </svg>
              <span class="text-white font-medium">Archive</span>
            {/if}
          </div>
        {/if}

        <!-- Email item -->
        <button
          id="email-button-{mail.id}"
          class="w-full text-left border-0 focus:outline-none hover:bg-md-surface-variant/40 duration-150 {mail.id === highlightedEmailId ? 'bg-md-primary/5' : ''} {mail.unread ? 'bg-md-primary/5' : 'bg-transparent'} py-1 px-1"
          style="transform: translateX({swipingEmail === mail ? swipeDistance : 0}px); transition: {swipeActionTriggered ? 'transform 0.3s' : 'none'}; user-select: none;"
          onclick={(e) => { if (Math.abs(swipeDistance) > 5) { e.preventDefault(); return; } if (selectionMode) { toggleEmailSelection(mail.id); } else { onOpenMessageDetail(mail); } }}
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
            {@const isLoaded = faviconLoaded[mail.id] === true}
            <div class="flex-shrink-0 w-[35px] h-[35px] rounded-lg {selectedEmailIds.has(mail.id) ? 'bg-md-primary' : (isLoaded ? 'bg-md-surface-container-low' : (mail.unread ? avatarColor(mail.from) : 'bg-gray-400'))} overflow-hidden flex items-center justify-center relative">
              {#if selectedEmailIds.has(mail.id)}
                <!-- Tick icon when selected -->
                <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                </svg>
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
              <span class="text-sm font-bold {mail.unread ? 'text-md-on-surface' : 'text-md-on-surface/70'} truncate leading-tight">{getDisplayName(mail.from, mail.from_name)}</span>
              <span class="text-[10px] font-medium {mail.unread ? 'text-md-on-surface/60' : 'text-md-on-surface/40'} flex-shrink-0">{mail.time}</span>
            </div>
            <div class="flex items-start gap-1">
              <!-- col1: subject + body/OTP -->
              <div class="flex flex-col flex-1 min-w-0">
                <p class="text-xs {mail.unread ? 'font-semibold text-md-on-surface' : 'text-md-on-surface/50'} truncate leading-tight">{mail.subject || '(no subject)'}</p>
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
                <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" viewBox="0 0 24 24" fill={starredEmailIds.has(mail.id) ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                </svg>
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
      onclick={closeContextMenu}
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-md-on-surface/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
    <span class="text-xs font-semibold text-md-on-surface/70 px-1 flex-shrink-0">{selectedEmailIds.size} selected</span>
    <div class="flex-1"></div>
    <button
      class="flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium text-md-error hover:bg-md-error/10 rounded-full transition-colors"
      aria-label="Delete selected"
      onclick={() => { closeContextMenu(); }}
    >
      <IconTrash class="w-4 h-4" />
      <span>Delete</span>
    </button>
    <div class="w-px h-6 bg-md-outline-variant/50"></div>
    <button
      class="flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium text-md-primary hover:bg-md-primary/10 rounded-full transition-colors"
      aria-label="Archive selected"
      onclick={() => { closeContextMenu(); }}
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
      </svg>
      <span>Archive</span>
    </button>
  </div>
{/if}



