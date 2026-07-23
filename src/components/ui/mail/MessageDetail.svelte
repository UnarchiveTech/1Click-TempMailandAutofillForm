<script lang="ts">
import { onDestroy, onMount, tick } from 'svelte';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import Icon from '@/components/icons/Icon.svelte';
import EmptyState from '@/components/ui/EmptyState.svelte';
import FaviconImage from '@/components/ui/FaviconImage.svelte';
import { generateSingleEMLContent } from '@/features/inbox/inbox-export.js';
import { copyToClipboardAndSchedulePurge } from '@/utils/clipboard.js';
import { isEmailStarred, toggleStarInSet } from '@/utils/email-star-key.js';
import { logError } from '@/utils/logger.js';
import { escapeHtmlText, initSanitize, sanitizeHtml } from '@/utils/sanitize-html.js';
import { timeAgo } from '@/utils/time.js';
import type { Account, Email } from '@/utils/types.js';

let {
  onBack = () => {},
  selectedThread = [],
  onMarkUnread = () => {},
  onArchive = () => {},
  onDelete = () => {},
  hasPrev = false,
  hasNext = false,
  onPrev = () => {},
  onNext = () => {},
  mailboxAddress = '',
  /** When true (split view), toolbar buttons show icon + text label */
  showToolbarLabels = false,
} = $props<{
  onBack?: () => void;
  selectedThread?: Email[];
  onMarkUnread?: () => void;
  onArchive?: () => void;
  onDelete?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  onPrev?: () => void;
  onNext?: () => void;
  mailboxAddress?: string;
  showToolbarLabels?: boolean;
}>();

// The message action buttons target the latest message in the thread.
let currentMessage = $derived(selectedThread.length > 0 ? selectedThread[0] : null);
let isThread = $derived(selectedThread.length > 1);

let bodiesById = $state<Record<string, string>>({});
let emailTagsMap = $state<Record<string, string[]>>({});
let tagDialogOpen = $state(false);
let tagDialogInput = $state('');
let starredEmailIds = $state<Set<string>>(new Set());
let starBusy = $state(false);

let currentEmailTags = $derived(currentMessage ? emailTagsMap[currentMessage.id] || [] : []);
let isStarred = $derived(
  currentMessage
    ? isEmailStarred(
        starredEmailIds,
        currentMessage.id,
        currentMessage.original_inbox || mailboxAddress
      )
    : false
);
let bestMagicLink = $derived(
  currentMessage?.magicLinks && currentMessage.magicLinks.length > 0
    ? currentMessage.magicLinks[0]
    : null
);
/** Stack height for bottom strips (OTP + magic link) above toolbar */
let bottomStripsRem = $derived.by(() => {
  let n = 0;
  if (currentMessage?.isOtp && currentMessage?.otp) n += 1;
  if (bestMagicLink) n += 1;
  if (n === 0) return '0.75rem';
  // each strip ~2.5rem + gaps
  return `${0.75 + n * 2.75}rem`;
});

async function openMagicLink(url: string) {
  try {
    await browser.tabs.create({ url });
  } catch (err) {
    logError(
      'Failed to open magic link',
      undefined,
      err instanceof Error ? err : new Error(String(err))
    );
  }
}

async function copyMagicLink(url: string) {
  try {
    await copyToClipboardAndSchedulePurge(url);
  } catch (err) {
    logError(
      'Failed to copy magic link',
      undefined,
      err instanceof Error ? err : new Error(String(err))
    );
  }
}

onMount(async () => {
  await initSanitize();
  void sanitizeAll();
});

onMount(() => {
  void loadEmailTags();
  void loadStarred();

  const handleStorageChange = (
    changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
    areaName: string
  ) => {
    if (areaName !== 'local') return;
    if (changes.emailTags) void loadEmailTags();
    if (changes.starredEmails) void loadStarred();
  };

  browser.storage.onChanged.addListener(handleStorageChange);
  onDestroy(() => {
    browser.storage.onChanged.removeListener(handleStorageChange);
  });
});

$effect(() => {
  if (selectedThread.length > 0) {
    void sanitizeAll();
  }
});

function sanitizeAll() {
  const next: Record<string, string> = {};
  for (const msg of selectedThread) {
    next[msg.id] = sanitizeHtml(msg.body_html || `<pre>${escapeHtmlText(msg.body || '')}</pre>`);
  }
  bodiesById = next;
}

async function loadEmailTags() {
  const result = (await browser.storage.local.get(['emailTags'])) as {
    emailTags?: Record<string, string[]>;
  };
  const loaded = result.emailTags || {};
  if (!sameTagsMap(loaded, emailTagsMap)) {
    emailTagsMap = loaded;
  }
}

async function loadStarred() {
  const result = (await browser.storage.local.get(['starredEmails'])) as {
    starredEmails?: string[];
  };
  starredEmailIds = new Set(result.starredEmails || []);
}

async function toggleStar() {
  if (!currentMessage?.id || starBusy) return;
  starBusy = true;
  try {
    const result = (await browser.storage.local.get(['starredEmails'])) as {
      starredEmails?: string[];
    };
    const addr = currentMessage.original_inbox || mailboxAddress;
    const updated = toggleStarInSet(result.starredEmails || [], currentMessage.id, addr);
    starredEmailIds = updated;
    await browser.storage.local.set({ starredEmails: Array.from(updated) });
  } catch (e) {
    logError('toggleStar failed', e);
    await loadStarred();
  } finally {
    starBusy = false;
  }
}

async function saveEmailTagsToStorage() {
  const snapshot = $state.snapshot(emailTagsMap) as Record<string, string[]>;
  await browser.storage.local.set({ emailTags: snapshot });
}

function openTagDialog() {
  if (!currentMessage) return;
  tagDialogInput = (emailTagsMap[currentMessage.id] || []).join(', ');
  tagDialogOpen = true;
}

function closeTagDialog() {
  tagDialogOpen = false;
  tagDialogInput = '';
}

async function saveEmailTags() {
  if (!currentMessage) return;
  const tags = tagDialogInput
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const newMap: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(emailTagsMap)) {
    if (Array.isArray(v)) newMap[k] = v.slice();
  }
  if (tags.length === 0) {
    delete newMap[currentMessage.id];
  } else {
    newMap[currentMessage.id] = tags.slice();
  }
  emailTagsMap = newMap;
  await tick();
  await saveEmailTagsToStorage();
  closeTagDialog();
}

function sameTagsMap(a: Record<string, string[]>, b: Record<string, string[]>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    const av = a[k];
    const bv = b[k];
    if (!Array.isArray(av) || !Array.isArray(bv)) return false;
    if (av.length !== bv.length) return false;
    for (let i = 0; i < av.length; i++) {
      if (av[i] !== bv[i]) return false;
    }
  }
  return true;
}

let allEmailTags = $derived.by(() => {
  const set = new Set<string>();
  for (const tags of Object.values(emailTagsMap)) {
    if (!Array.isArray(tags)) continue;
    for (const t of tags) set.add(t);
  }
  return Array.from(set).sort();
});

function _forwardMessage() {
  if (!currentMessage) return;

  const subject = encodeURIComponent(`Fwd: ${currentMessage.subject || 'No Subject'}`);
  const body = encodeURIComponent(
    `\n\n--- Forwarded Message ---\n` +
      `From: ${currentMessage.from || 'Unknown Sender'}\n` +
      `Date: ${currentMessage.time || 'Unknown'}\n` +
      `Subject: ${currentMessage.subject || 'No Subject'}\n\n` +
      `${currentMessage.body || 'No content'}`
  );
  const mailtoLink = `mailto:?subject=${subject}&body=${body}`;
  browser.tabs.create({ url: mailtoLink });
}

async function _downloadAsEML() {
  if (!currentMessage) return;

  try {
    const { activeInboxId, inboxes = [] } = (await browser.storage.local.get([
      'activeInboxId',
      'inboxes',
    ])) as {
      activeInboxId?: string;
      inboxes?: Account[];
    };

    const currentInbox = inboxes.find((inbox) => inbox.id === activeInboxId);
    if (!currentInbox) {
      logError('No current inbox found');
      return;
    }

    const emlContent = generateSingleEMLContent(currentInbox, currentMessage);
    const blob = new Blob([emlContent], { type: 'message/rfc822' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const subject = (currentMessage.subject || 'No Subject')
      .replace(/[^a-zA-Z0-9\s]/g, '_')
      .substring(0, 50);
    a.download = `${subject}.eml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    logError(
      'Failed to download email as EML:',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

const toolbarBtnClass = $derived(
  showToolbarLabels
    ? 'inline-flex items-center gap-1.5 h-9 px-2.5 rounded-full bg-md-surface-container-high shadow border border-md-outline-variant/30 text-md-on-surface-variant hover:bg-md-secondary-container hover:text-md-on-secondary-container active:scale-95 transition-all text-xs font-semibold whitespace-nowrap'
    : 'w-9 h-9 flex items-center justify-center rounded-full bg-md-surface-container-high shadow border border-md-outline-variant/30 text-md-on-surface-variant hover:bg-md-secondary-container hover:text-md-on-secondary-container active:scale-95 transition-all'
);
</script>

{#if currentMessage}
<div class="sticky top-0 bg-md-surface z-10">
  <!-- Subject header -->
  <div class="bg-md-surface-container-low rounded-xl mx-1 mt-2">
    <div class="p-3">
      <div class="font-semibold text-sm">{currentMessage.subject}</div>
      <div class="text-xs text-md-on-surface/60 mt-1">
        <div>From: {currentMessage.from}</div>
        <div>{currentMessage.time}</div>
      </div>
      <!-- Label pills + "Add a label" pill under time row -->
      <div class="flex flex-wrap items-center gap-1.5 mt-2">
        {#each currentEmailTags as tag (tag)}
          <span class="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-md-primary/15 text-md-primary border border-md-primary/20">
            {tag}
          </span>
        {/each}
        <button
          type="button"
          class="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold rounded-full border border-dashed border-md-outline-variant text-md-on-surface/55 hover:border-md-primary hover:text-md-primary hover:bg-md-primary/10 transition-colors"
          title={$t('inbox.emailActions.addLabel')}
          aria-label={$t('inbox.emailActions.addLabel')}
          onclick={(e) => {
            e.stopPropagation();
            openTagDialog();
          }}
        >
          <Icon name="tag" class="w-3 h-3" />
          {$t('inbox.emailActions.addLabel')}
        </button>
      </div>
      {#if isThread}
        <div class="text-xs font-semibold text-md-primary/80 uppercase tracking-wider mt-1.5">
          {selectedThread.length} messages in thread
        </div>
      {/if}
    </div>
  </div>
</div>
{/if}

{#if selectedThread.length > 0}
<div class="relative flex-1 flex flex-col min-h-0">
  <div class="flex-1 px-1 py-3 flex flex-col gap-3 overflow-y-auto pb-20">
    {#each selectedThread as msg, idx (msg.id)}
      <div class="bg-md-surface-container-low rounded-xl flex-shrink-0">
        {#if isThread}
          <div class="flex items-center justify-between px-3 pt-2">
            <div class="text-xs font-semibold text-md-on-surface/60 uppercase tracking-wider">
              {idx === 0 ? 'Latest' : `#${selectedThread.length - idx}`}
            </div>
            <div class="text-xs text-md-on-surface/50">
              {msg.time}
            </div>
          </div>
        {/if}
        <div class="px-3 pb-3 pt-2">
          {#if isThread}
            <div class="text-xs text-md-on-surface/60 mb-1.5">
              <span class="font-semibold text-md-on-surface">{msg.from || msg.from_name || 'Unknown Sender'}</span>
            </div>
          {/if}
          {#if msg.local_only}
            {@const deletedWhen = (() => {
              const ts =
                msg.local_only_since ||
                msg.local_deleted_at ||
                msg.stored_at ||
                (msg.received_at ? msg.received_at * 1000 : 0);
              return ts ? timeAgo(ts) : '';
            })()}
            <div class="mb-2">
              <span
                class="inline-flex px-1.5 py-0.5 text-xs rounded-full bg-md-tertiary-container text-md-on-tertiary-container cursor-help"
                title={deletedWhen
                  ? $t('inbox.deletedFromServerAgo', { values: { when: deletedWhen } })
                  : $t('inbox.localOnlyTooltip')}
              >{$t('inbox.localOnlyBadge')}</span>
            </div>
          {/if}
          <div class="email-body text-sm text-md-on-surface break-words">
            {@html bodiesById[msg.id] || ''}
          </div>
          {#if isThread}
            {@const msgTags = emailTagsMap[msg.id] || []}
            {#if msgTags.length}
              <div class="flex flex-wrap gap-1.5 mt-2">
                {#each msgTags as tag (tag)}
                  <span class="px-2 py-0.5 text-xs font-semibold rounded-full bg-md-primary/15 text-md-primary">{tag}</span>
                {/each}
              </div>
            {/if}
          {/if}
        </div>
      </div>
    {/each}
  </div>

  <!-- Bottom strips: OTP + magic link (user-click only for links) -->
  <div class="shrink-0 flex flex-col gap-1 mx-1 mb-1">
    {#if currentMessage?.isOtp && currentMessage.otp}
      <div
        id="button-otp-strip-detail"
        class="flex items-center gap-2 px-3 bg-md-secondary-container rounded-xl h-[40px] shadow-sm"
      >
        <div class="flex items-center gap-2 min-w-0">
          <div class="flex-shrink-0 w-7 h-7 rounded-lg bg-md-surface flex items-center justify-center overflow-hidden">
            {#if currentMessage.from}
              <FaviconImage
                email={currentMessage.from}
                size={24}
                class="w-4 h-4"
                fallbackLetter={(currentMessage.from[0] || '?').toUpperCase()}
                fallbackColor="bg-md-primary text-md-on-primary"
              />
            {/if}
          </div>
          <div class="min-w-0">
            <div class="text-xs font-bold text-md-on-surface leading-tight truncate max-w-[80px]">
              {currentMessage.from_name || currentMessage.from?.split('@')[0] || 'OTP'}
            </div>
            <div class="text-xs font-semibold uppercase tracking-wider text-md-on-surface/40 leading-tight">
              {$t('inbox.otpDetected')}
            </div>
          </div>
        </div>
        <div class="w-px h-6 bg-md-outline-variant/20 flex-shrink-0 mx-1"></div>
        <div class="flex-1 flex items-center justify-center">
          <button
            type="button"
            id="button-copy-current-otp-detail"
            class="px-3 py-1 rounded-full text-label-sm font-semibold bg-md-primary text-md-on-primary hover:bg-md-primary/90 flex-shrink-0 flex items-center gap-1.5 transition-colors"
            aria-label={$t('inbox.copyOtpAria')}
            title={$t('inbox.copyOtpAria')}
            onclick={async (e) => {
              e.stopPropagation();
              try {
                await copyToClipboardAndSchedulePurge(currentMessage!.otp);
              } catch (err) {
                logError('Failed to copy', undefined, err instanceof Error ? err : new Error(String(err)));
              }
            }}
          >
            <span class="font-bold text-sm tracking-[0.05em]">{currentMessage.otp.replace(/\s/g, '')}</span>
            <Icon name="copy" class="w-3 h-3 text-md-on-primary/80 flex-shrink-0" />
          </button>
        </div>
      </div>
    {/if}

    {#if bestMagicLink}
      <div
        id="button-magic-link-strip-detail"
        class="flex items-center gap-2 px-3 bg-md-tertiary-container rounded-xl min-h-[40px] py-1 shadow-sm"
      >
        <div class="flex items-center gap-2 min-w-0 flex-1">
          <div class="flex-shrink-0 w-7 h-7 rounded-lg bg-md-surface flex items-center justify-center">
            <Icon name="globe" class="w-4 h-4 text-md-tertiary" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-xs font-semibold uppercase tracking-wider text-md-on-surface/40 leading-tight">
              {$t('inbox.magicLinkDetected')}
            </div>
            <div class="text-label-sm font-semibold text-md-on-surface truncate" title={bestMagicLink.url}>
              {bestMagicLink.host || bestMagicLink.label || bestMagicLink.url}
            </div>
          </div>
        </div>
        <button
          type="button"
          class="px-2.5 py-1 rounded-full text-label-sm font-semibold bg-md-tertiary text-md-on-tertiary hover:opacity-90 flex-shrink-0 transition-opacity"
          aria-label={$t('inbox.openMagicLink')}
          title={$t('inbox.openMagicLinkHost', { values: { host: bestMagicLink.host || '' } })}
          onclick={(e) => {
            e.stopPropagation();
            void openMagicLink(bestMagicLink!.url);
          }}
        >
          {$t('inbox.openMagicLink')}
        </button>
        <button
          type="button"
          class="w-8 h-8 flex items-center justify-center rounded-full hover:bg-md-surface/60 flex-shrink-0"
          aria-label={$t('inbox.copyMagicLink')}
          title={$t('inbox.copyMagicLink')}
          onclick={(e) => {
            e.stopPropagation();
            void copyMagicLink(bestMagicLink!.url);
          }}
        >
          <Icon name="copy" class="w-3.5 h-3.5 text-md-on-surface/70" />
        </button>
      </div>
    {/if}
  </div>

  <!-- Bottom toolbar: actions only (expand lives in navbar Header) -->
  <div
    class="absolute inset-x-0 z-30 flex items-center justify-start gap-1.5 px-2 pointer-events-none"
    style="bottom: {bottomStripsRem};"
  >
    <div class="flex items-center gap-1 pointer-events-auto bg-md-surface/90 backdrop-blur-sm rounded-full p-1 shadow-lg border border-md-outline-variant/25 flex-wrap max-w-full">
      <button
        type="button"
        id="button-star-detail"
        class="{toolbarBtnClass} {isStarred ? 'text-md-tertiary' : ''}"
        aria-label={$t('inbox.emailActions.star')}
        title={$t('inbox.emailActions.star')}
        aria-pressed={isStarred}
        onclick={(e) => {
          e.stopPropagation();
          void toggleStar();
        }}
      >
        <Icon name="star" class="w-4 h-4 shrink-0" filled={isStarred} />
        {#if showToolbarLabels}<span>{$t('inbox.emailActions.star')}</span>{/if}
      </button>
      <button
        type="button"
        id="button-archive-detail"
        class={toolbarBtnClass}
        aria-label={$t('inbox.emailActions.archive')}
        title={$t('inbox.emailActions.archive')}
        onclick={(e) => {
          e.stopPropagation();
          onArchive();
        }}
      >
        <Icon name="archive" class="w-4 h-4 shrink-0" />
        {#if showToolbarLabels}<span>{$t('inbox.emailActions.archive')}</span>{/if}
      </button>
      <button
        type="button"
        id="button-delete-detail"
        class="{toolbarBtnClass} text-md-error"
        aria-label={$t('inbox.emailActions.delete')}
        title={$t('inbox.emailActions.delete')}
        onclick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <Icon name="trash" class="w-4 h-4 shrink-0" />
        {#if showToolbarLabels}<span>{$t('inbox.emailActions.delete')}</span>{/if}
      </button>
      <button
        type="button"
        id="button-download"
        class={toolbarBtnClass}
        aria-label={$t('inbox.emailActions.download')}
        title={$t('inbox.emailActions.download')}
        onclick={(e) => {
          e.stopPropagation();
          void _downloadAsEML();
        }}
      >
        <Icon name="download" class="w-4 h-4 shrink-0" />
        {#if showToolbarLabels}<span>{$t('inbox.emailActions.downloadShort')}</span>{/if}
      </button>
      <button
        type="button"
        id="button-forward"
        class={toolbarBtnClass}
        aria-label={$t('inbox.emailActions.forward')}
        title={$t('inbox.emailActions.forward')}
        onclick={(e) => {
          e.stopPropagation();
          _forwardMessage();
        }}
      >
        <Icon name="envelope" class="w-4 h-4 shrink-0" />
        {#if showToolbarLabels}<span>{$t('inbox.emailActions.forwardShort')}</span>{/if}
      </button>
      <button
        type="button"
        id="button-tag"
        class={toolbarBtnClass}
        aria-label={$t('inbox.emailActions.tag')}
        title={$t('inbox.emailActions.tag')}
        onclick={(e) => {
          e.stopPropagation();
          openTagDialog();
        }}
      >
        <Icon name="tag" class="w-4 h-4 shrink-0" />
        {#if showToolbarLabels}<span>{$t('inbox.emailActions.label')}</span>{/if}
      </button>
      <button
        type="button"
        id="button-mark-unread"
        class={toolbarBtnClass}
        aria-label={$t('inbox.emailActions.markUnread')}
        title={$t('inbox.emailActions.markUnread')}
        onclick={(e) => {
          e.stopPropagation();
          onMarkUnread();
        }}
      >
        <Icon name="mail" class="w-4 h-4 shrink-0" />
        {#if showToolbarLabels}<span>{$t('inbox.emailActions.markUnreadShort')}</span>{/if}
      </button>
    </div>
  </div>

  <!-- Left Chevron Button -->
  <button
    class="absolute start-2 top-1/2 -translate-y-1/2 z-20 w-8 h-8 rounded-full flex items-center justify-center bg-md-surface-container-high/70 backdrop-blur-sm border border-md-outline-variant/30 text-md-primary shadow-md transition-all opacity-40 hover:opacity-100 hover:scale-105 active:scale-95 disabled:opacity-15 disabled:cursor-not-allowed disabled:scale-100"
    onclick={(e) => { e.stopPropagation(); onPrev(); }}
    disabled={!hasPrev}
    title={hasPrev ? $t('inbox.emailActions.prevEmail') || 'Previous Email' : $t('inbox.emailActions.noPrevEmail') || 'No previous email exists'}
    aria-label="Previous email"
  >
    <Icon name="chevronLeft" class="w-5 h-5 rtl-flip" />
  </button>

  <!-- End-side chevron (next) -->
  <button
    class="absolute end-2 top-1/2 -translate-y-1/2 z-20 w-8 h-8 rounded-full flex items-center justify-center bg-md-surface-container-high/70 backdrop-blur-sm border border-md-outline-variant/30 text-md-primary shadow-md transition-all opacity-40 hover:opacity-100 hover:scale-105 active:scale-95 disabled:opacity-15 disabled:cursor-not-allowed disabled:scale-100"
    onclick={(e) => { e.stopPropagation(); onNext(); }}
    disabled={!hasNext}
    title={hasNext ? $t('inbox.emailActions.nextEmail') || 'Next Email' : $t('inbox.emailActions.noNextEmail') || 'No next email exists'}
    aria-label="Next email"
  >
    <Icon name="chevronRight" class="w-5 h-5 rtl-flip" />
  </button>

  <!-- Label dialog: absolute so it stays inside this detail pane only -->
  {#if tagDialogOpen}
    <div class="absolute inset-0 z-[1000] flex items-center justify-center p-3" role="dialog" aria-modal="true">
      <div class="absolute inset-0 bg-black/30 backdrop-blur-sm" role="button" tabindex="-1" onclick={closeTagDialog} onkeydown={(e) => e.key === 'Escape' && closeTagDialog()}></div>
      <div class="relative bg-md-surface rounded-2xl shadow-2xl p-4 w-72 z-10 border border-md-outline-variant/30">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-bold text-md-on-surface">{$t('inbox.emailActions.tag')}</h3>
          <button type="button" class="w-7 h-7 flex items-center justify-center rounded-full hover:bg-md-surface-variant transition-colors" onclick={(e) => { e.stopPropagation(); closeTagDialog(); }} aria-label={$t('common.close')}>
            <Icon name="x" class="w-4 h-4 text-md-on-surface/60" />
          </button>
        </div>
        <p class="text-xs text-md-on-surface/60 mb-2">{$t('inbox.labelDialogHint')}</p>
        <input
          type="text"
          class="w-full px-3 py-2 text-sm rounded-lg border border-md-outline-variant bg-md-surface-container-low focus:outline-none focus:border-md-primary focus:ring-1 focus:ring-md-primary"
          placeholder={$t('inbox.labelDialogPlaceholder')}
          bind:value={tagDialogInput}
          onkeydown={(e) => { if (e.key === 'Enter') saveEmailTags(); else if (e.key === 'Escape') closeTagDialog(); }}
        />
        {#if allEmailTags.length > 0}
          <div class="flex flex-wrap gap-1.5 mt-2">
            {#each allEmailTags as t}
              <button
                type="button"
                class="px-2 py-0.5 text-xs rounded-full bg-md-primary/10 text-md-primary hover:bg-md-primary/20 transition-colors"
                onclick={(e) => { e.stopPropagation(); tagDialogInput = tagDialogInput ? `${tagDialogInput}, ${t}` : t; }}
              >{t}</button>
            {/each}
          </div>
        {/if}
        <div class="flex gap-2 mt-3">
          <button type="button" class="flex-1 py-1.5 text-sm rounded-xl bg-md-secondary-container text-md-on-secondary-container hover:bg-md-secondary-container/80 transition-colors" onclick={(e) => { e.stopPropagation(); closeTagDialog(); }}>{$t('common.cancel')}</button>
          <button type="button" class="flex-1 py-1.5 text-sm rounded-xl bg-md-primary text-md-on-primary hover:bg-md-primary/90 transition-colors" onclick={(e) => { e.stopPropagation(); saveEmailTags(); }}>{$t('common.save')}</button>
        </div>
      </div>
    </div>
  {/if}
</div>
{:else}
  <EmptyState
    compact={true}
    iconName="mail"
    title={$t('inbox.noMessageSelected')}
    description={$t('inbox.splitEmptyHint')}
  />
{/if}

<style>
  /* Sanitized HTML body: readable layout without external CSS from emails */
  :global(.email-body) {
    line-height: 1.55;
    word-break: break-word;
    overflow-wrap: anywhere;
  }
  :global(.email-body img) {
    max-width: 100%;
    height: auto;
  }
  :global(.email-body table) {
    max-width: 100%;
    border-collapse: collapse;
  }
  :global(.email-body a) {
    color: var(--md-primary);
    text-decoration: underline;
  }
  :global(.email-body pre) {
    white-space: pre-wrap;
    word-break: break-word;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.8125rem;
  }
  :global(.email-body blockquote) {
    margin: 0.5rem 0;
    padding-inline-start: 0.75rem;
    border-inline-start: 3px solid color-mix(in srgb, var(--md-outline-variant) 70%, transparent);
    color: color-mix(in srgb, var(--md-on-surface) 70%, transparent);
  }
</style>
