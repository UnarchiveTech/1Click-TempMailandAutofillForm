<script lang="ts">
import { onDestroy, onMount, tick } from 'svelte';
import { browser } from 'wxt/browser';
import Icon from '@/components/icons/Icon.svelte';
import { generateSingleEMLContent } from '@/features/inbox/inbox-export.js';
import { logError } from '@/utils/logger.js';
import { initSanitize, sanitizeHtml } from '@/utils/sanitize-html.js';
import type { Account, Email } from '@/utils/types.js';

let {
  onBack = () => {},
  selectedMessage = null,
  onMarkUnread = () => {},
} = $props<{
  onBack?: () => void;
  selectedMessage?: Email | null;
  onMarkUnread?: () => void;
}>();

let sanitizedBody = $state('');
let _loaded = $state(false);

// Email tags state (declared early so onMount and storage listener can use it)
let emailTagsMap = $state<Record<string, string[]>>({});
let tagDialogOpen = $state(false);
let tagDialogInput = $state('');

let currentEmailTags = $derived(selectedMessage ? emailTagsMap[selectedMessage.id] || [] : []);

onMount(async () => {
  await initSanitize();
  _loaded = true;
  if (selectedMessage) {
    sanitizedBody = sanitizeHtml(
      selectedMessage.body_html || `<pre>${selectedMessage.body || ''}</pre>`
    );
  }
});

onMount(() => {
  void loadEmailTags();

  const handleStorageChange = (
    changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
    areaName: string
  ) => {
    if (areaName !== 'local') return;
    if (changes.emailTags) void loadEmailTags();
  };

  browser.storage.onChanged.addListener(handleStorageChange);
  onDestroy(() => {
    browser.storage.onChanged.removeListener(handleStorageChange);
  });
});

// Re-sanitize when message changes
$effect(() => {
  if (_loaded && selectedMessage) {
    sanitizedBody = sanitizeHtml(
      selectedMessage.body_html || `<pre>${selectedMessage.body || ''}</pre>`
    );
  }
});

async function loadEmailTags() {
  const result = (await browser.storage.local.get(['emailTags'])) as {
    emailTags?: Record<string, string[]>;
  };
  const loaded = result.emailTags || {};
  // Deep-equal guard: avoid reassigning when the loaded value matches current
  // state. Reassigning a $state proxy to an equivalent object can cause
  // {#each} blocks keyed on inner arrays to drop their children.
  if (!sameTagsMap(loaded, emailTagsMap)) {
    emailTagsMap = loaded;
  }
}

async function saveEmailTagsToStorage() {
  // Snapshot the $state proxy into a plain object so structured-clone
  // serialization in chrome.storage.local is deterministic.
  const snapshot = $state.snapshot(emailTagsMap) as Record<string, string[]>;
  await browser.storage.local.set({ emailTags: snapshot });
}

function openTagDialog() {
  if (!selectedMessage) return;
  tagDialogInput = (emailTagsMap[selectedMessage.id] || []).join(', ');
  tagDialogOpen = true;
}

function closeTagDialog() {
  tagDialogOpen = false;
  tagDialogInput = '';
}

async function saveEmailTags() {
  if (!selectedMessage) return;
  const tags = tagDialogInput
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  // Build a fresh top-level object so Svelte 5's proxy treats the assignment
  // as a structural change and notifies every reader (including the
  // {#each} over the inner array).
  const newMap: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(emailTagsMap)) {
    if (Array.isArray(v)) newMap[k] = v.slice();
  }
  if (tags.length === 0) {
    delete newMap[selectedMessage.id];
  } else {
    newMap[selectedMessage.id] = tags.slice();
  }
  emailTagsMap = newMap;
  // Force the DOM commit before persisting so storage + UI stay in sync.
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
  if (!selectedMessage) return;

  const subject = encodeURIComponent(`Fwd: ${selectedMessage.subject || 'No Subject'}`);
  const body = encodeURIComponent(
    `\n\n--- Forwarded Message ---\n` +
      `From: ${selectedMessage.from || 'Unknown Sender'}\n` +
      `Date: ${selectedMessage.time || 'Unknown'}\n` +
      `Subject: ${selectedMessage.subject || 'No Subject'}\n\n` +
      `${selectedMessage.body || 'No content'}`
  );
  const mailtoLink = `mailto:?subject=${subject}&body=${body}`;
  browser.tabs.create({ url: mailtoLink });
}

async function _expandView() {
  if (!selectedMessage) return;
  const { activeInboxId, inboxes = [] } = (await browser.storage.local.get([
    'activeInboxId',
    'inboxes',
  ])) as {
    activeInboxId?: string;
    inboxes?: Account[];
  };
  const currentInbox = inboxes.find((inbox) => inbox.id === activeInboxId);

  await browser.storage.local.set({
    expandedEmailId: selectedMessage.id,
    expandedInboxAddress: selectedMessage.original_inbox || currentInbox?.address || '',
    expandedInboxId: activeInboxId || currentInbox?.id || '',
    expandedMessage: selectedMessage,
  });
  await browser.tabs.create({ url: '/app.html' });
}

async function _downloadAsEML() {
  if (!selectedMessage) return;

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

    const emlContent = generateSingleEMLContent(currentInbox, selectedMessage);
    const blob = new Blob([emlContent], { type: 'message/rfc822' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const subject = (selectedMessage.subject || 'No Subject')
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
</script>

{#if selectedMessage}
<div class="sticky top-0 bg-md-surface z-10">
  <div class="flex items-center justify-between px-1 py-2 border-b border-md-outline-variant">
    <button id="button-back" class="px-2 py-1 text-md-primary rounded-lg bg-transparent hover:bg-md-surface-variant transition-colors flex items-center gap-1" aria-label="Go back" onclick={onBack}>
      <Icon name="back" class="w-4 h-4" />
      Back
    </button>
    <div class="flex items-center gap-1">
      <button id="button-expand-view" class="px-2 py-1 text-md-primary rounded-lg bg-transparent hover:bg-md-surface-variant transition-colors flex items-center gap-1" aria-label="Expand view" onclick={_expandView}>
        <Icon name="monitor" class="w-4 h-4" />
        Expand View
      </button>
      <button id="button-download" class="px-2 py-1 text-md-primary rounded-lg bg-transparent hover:bg-md-surface-variant transition-colors flex items-center gap-1" aria-label="Download as EML" onclick={_downloadAsEML}>
        <Icon name="download" class="w-4 h-4" />
        Download
      </button>
      <button id="button-forward" class="px-2 py-1 text-md-primary rounded-lg bg-transparent hover:bg-md-surface-variant transition-colors flex items-center gap-1" aria-label="Forward message" onclick={_forwardMessage}>
        <Icon name="envelope" class="w-4 h-4" />
        Forward
      </button>
      <button id="button-tag" class="px-2 py-1 text-md-primary rounded-lg bg-transparent hover:bg-md-surface-variant transition-colors flex items-center gap-1" aria-label="Tag email" onclick={openTagDialog}>
        <Icon name="tag" class="w-4 h-4" />
        Tag
      </button>
      <button id="button-mark-unread" class="px-2 py-1 text-md-primary rounded-lg bg-transparent hover:bg-md-surface-variant transition-colors flex items-center gap-1" aria-label="Mark as unread" onclick={() => onMarkUnread()}>
        <Icon name="mail" class="w-4 h-4" />
        Mark unread
      </button>
    </div>
  </div>
  <div class="bg-md-surface-container-low rounded-xl mx-1 mt-3">
    <div class="p-3">
      <div class="font-semibold text-sm">{selectedMessage.subject}</div>
      <div class="text-xs text-md-on-surface/60 mt-1">
        <div>From: {selectedMessage.from}</div>
        <div>{selectedMessage.time}</div>
      </div>
      {#if currentEmailTags.length}
        <div class="flex flex-wrap gap-1.5 mt-2">
          {#each currentEmailTags as tag (tag)}
            <span class="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-md-primary/15 text-md-primary">{tag}</span>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>
{/if}

<!-- Tag Dialog -->
{#if tagDialogOpen}
  <div class="fixed inset-0 z-[1000] flex items-center justify-center">
    <div class="absolute inset-0 bg-black/30 backdrop-blur-sm" role="button" tabindex="-1" onclick={closeTagDialog} onkeydown={(e) => e.key === 'Escape' && closeTagDialog()}></div>
    <div class="relative bg-md-surface rounded-2xl shadow-2xl p-4 w-72 z-10">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-bold text-md-on-surface">Tag Email</h3>
        <button class="w-7 h-7 flex items-center justify-center rounded-full hover:bg-md-surface-variant transition-colors" onclick={closeTagDialog} aria-label="Close">
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
              onclick={() => { tagDialogInput = tagDialogInput ? `${tagDialogInput}, ${t}` : t; }}
            >{t}</button>
          {/each}
        </div>
      {/if}
      <div class="flex gap-2 mt-3">
        <button class="flex-1 py-1.5 text-sm rounded-xl bg-md-secondary-container text-md-on-secondary-container hover:bg-md-secondary-container/80 transition-colors" onclick={closeTagDialog}>Cancel</button>
        <button class="flex-1 py-1.5 text-sm rounded-xl bg-md-primary text-md-on-primary hover:bg-md-primary/90 transition-colors" onclick={saveEmailTags}>Save</button>
      </div>
    </div>
  </div>
{/if}
{#if selectedMessage}
  <div class="flex-1 px-1 py-3 flex flex-col overflow-hidden">
    {#if selectedMessage.isOtp}
      <div class="bg-md-primary/10 border border-md-primary/20 rounded-xl mt-3">
        <div class="p-4">
          <div class="flex items-center justify-between">
            <div>
              <div class="text-xs font-medium text-md-primary mb-1">Verification Code</div>
              <div class="text-2xl font-bold text-md-primary font-mono">{selectedMessage.otp}</div>
            </div>
            <button id="button-copy-otp" class="w-8 h-8 flex items-center justify-center rounded-lg bg-transparent hover:bg-md-surface-variant transition-colors" aria-label="Copy OTP" onclick={async () => { try { await navigator.clipboard.writeText(selectedMessage.otp); } catch(e) { logError('Failed to copy', undefined, e instanceof Error ? e : new Error(String(e))); } }}>
              <Icon name="copy" class="w-5 h-5 text-md-primary" />
            </button>
          </div>
        </div>
      </div>
    {/if}
    <div class="bg-md-surface-container-low rounded-xl flex-1 overflow-y-auto mt-3">
      <div class="p-3">
        <div class="text-sm">{@html sanitizedBody}</div>
      </div>
    </div>
  </div>
{:else}
  <div class="flex-1 flex items-center justify-center text-md-on-surface/50">
    <div class="text-center">
      <p class="text-sm">No message selected</p>
    </div>
  </div>
{/if}
