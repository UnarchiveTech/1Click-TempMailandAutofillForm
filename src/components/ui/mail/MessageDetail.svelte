<script lang="ts">
import DOMPurify from 'dompurify';
import { browser } from 'wxt/browser';
import IconBack from '@/components/icons/IconBack.svelte';
import IconCopy from '@/components/icons/IconCopy.svelte';
import IconDownload from '@/components/icons/IconDownload.svelte';
import IconEnvelope from '@/components/icons/IconEnvelope.svelte';
import IconMonitor from '@/components/icons/IconMonitor.svelte';
import IconTag from '@/components/icons/IconTag.svelte';
import IconX from '@/components/icons/IconX.svelte';
import { generateSingleEMLContent } from '@/features/inbox/inbox-export.js';
import type { Account, Email } from '@/utils/types.js';

let { onBack = () => {}, selectedMessage = null } = $props<{
  onBack?: () => void;
  selectedMessage?: Email | null;
}>();

// Email tags state
let emailTagsMap = $state<Record<string, string[]>>({});
let tagDialogOpen = $state(false);
let tagDialogInput = $state('');

async function loadEmailTags() {
  const result = (await browser.storage.local.get(['emailTags'])) as {
    emailTags?: Record<string, string[]>;
  };
  emailTagsMap = result.emailTags || {};
}

async function saveEmailTagsToStorage() {
  await browser.storage.local.set({ emailTags: emailTagsMap });
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
  if (tags.length === 0) {
    const next = { ...emailTagsMap };
    delete next[selectedMessage.id];
    emailTagsMap = next;
  } else {
    emailTagsMap = { ...emailTagsMap, [selectedMessage.id]: tags };
  }
  await saveEmailTagsToStorage();
  closeTagDialog();
}

let allEmailTags = $derived.by(() => {
  const set = new Set<string>();
  for (const tags of Object.values(emailTagsMap)) for (const t of tags) set.add(t);
  return Array.from(set).sort();
});

$effect(() => {
  loadEmailTags();
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
  window.open(mailtoLink, '_self');
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
      console.error('No current inbox found');
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
    console.error('Failed to download email as EML:', error);
  }
}
</script>

{#if selectedMessage}
<div class="sticky top-0 bg-md-surface z-10">
  <div class="flex items-center justify-between px-1 py-2 border-b border-md-outline-variant">
    <button id="button-back" class="px-2 py-1 text-md-primary rounded-lg bg-transparent hover:bg-md-surface-variant transition-colors flex items-center gap-1" aria-label="Go back" onclick={onBack}>
      <IconBack class="w-4 h-4" />
      Back
    </button>
    <div class="flex items-center gap-1">
      <button id="button-expand-view" class="px-2 py-1 text-md-primary rounded-lg bg-transparent hover:bg-md-surface-variant transition-colors flex items-center gap-1" aria-label="Expand view" onclick={_expandView}>
        <IconMonitor class="w-4 h-4" />
        Expand View
      </button>
      <button id="button-download" class="px-2 py-1 text-md-primary rounded-lg bg-transparent hover:bg-md-surface-variant transition-colors flex items-center gap-1" aria-label="Download as EML" onclick={_downloadAsEML}>
        <IconDownload class="w-4 h-4" />
        Download
      </button>
      <button id="button-forward" class="px-2 py-1 text-md-primary rounded-lg bg-transparent hover:bg-md-surface-variant transition-colors flex items-center gap-1" aria-label="Forward message" onclick={_forwardMessage}>
        <IconEnvelope class="w-4 h-4" />
        Forward
      </button>
      <button id="button-tag" class="px-2 py-1 text-md-primary rounded-lg bg-transparent hover:bg-md-surface-variant transition-colors flex items-center gap-1" aria-label="Tag email" onclick={openTagDialog}>
        <IconTag class="w-4 h-4" />
        Tag
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
      {#if emailTagsMap[selectedMessage.id]?.length}
        <div class="flex flex-wrap gap-1.5 mt-2">
          {#each emailTagsMap[selectedMessage.id] as tag}
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
          <IconX class="w-4 h-4 text-md-on-surface/60" />
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
            <button id="button-copy-otp" class="w-8 h-8 flex items-center justify-center rounded-lg bg-transparent hover:bg-md-surface-variant transition-colors" aria-label="Copy OTP" onclick={() => navigator.clipboard.writeText(selectedMessage.otp)}>
              <IconCopy class="w-5 h-5 text-md-primary" />
            </button>
          </div>
        </div>
      </div>
    {/if}
    <div class="bg-md-surface-container-low rounded-xl flex-1 overflow-y-auto mt-3" style="scrollbar-width: thin; scrollbar-color: var(--md-primary) transparent;">
      <div class="p-3">
        <div class="text-sm">{@html DOMPurify.sanitize(selectedMessage.body_html || `<pre>${selectedMessage.body || ''}</pre>`)}</div>
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
