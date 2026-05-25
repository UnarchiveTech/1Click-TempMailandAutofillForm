<script lang="ts">
import { browser } from 'wxt/browser';
import IconChevronLeft from '@/components/icons/IconChevronLeft.svelte';
import IconTrash from '@/components/icons/IconTrash.svelte';
import type { Account } from '@/utils/types.js';

let {
  onBack = () => {},
  allInboxes = [] as Account[],
  onReloadAccounts = async () => {},
} = $props<{
  onBack?: () => void;
  allInboxes?: Account[];
  onReloadAccounts?: () => Promise<void>;
}>();

// Collect unique tags across all inboxes
let tagGroups = $derived.by(() => {
  const map = new Map<string, { color: string; accounts: Account[] }>();
  for (const acc of allInboxes) {
    if (!acc.tag) continue;
    const key = acc.tag;
    if (!map.has(key)) {
      map.set(key, { color: acc.tagColor || '#6750a4', accounts: [] });
    }
    map.get(key)!.accounts.push(acc);
  }
  return [...map.entries()].map(([tag, { color, accounts }]) => ({ tag, color, accounts }));
});

let editingTag = $state<{ oldTag: string; newTag: string; color: string } | null>(null);
let saving = $state(false);
let errorMsg = $state('');

function startEdit(tag: string, color: string) {
  editingTag = { oldTag: tag, newTag: tag, color };
  errorMsg = '';
}

function cancelEdit() {
  editingTag = null;
  errorMsg = '';
}

async function saveEdit() {
  if (!editingTag) return;
  const { oldTag, newTag, color } = editingTag;
  const trimmed = newTag.trim();
  if (!trimmed) {
    errorMsg = 'Tag name cannot be empty';
    return;
  }
  saving = true;
  try {
    const { inboxes = [] } = (await browser.storage.local.get(['inboxes'])) as {
      inboxes?: Account[];
    };
    const updated = inboxes.map((a) =>
      a.tag === oldTag ? { ...a, tag: trimmed, tagColor: color } : a
    );
    await browser.storage.local.set({ inboxes: updated });
    await onReloadAccounts();
    editingTag = null;
  } finally {
    saving = false;
  }
}

async function deleteTag(tag: string) {
  if (!confirm(`Remove tag "${tag}" from all inboxes?`)) return;
  saving = true;
  try {
    const { inboxes = [] } = (await browser.storage.local.get(['inboxes'])) as {
      inboxes?: Account[];
    };
    const updated = inboxes.map((a) =>
      a.tag === tag ? { ...a, tag: undefined, tagColor: undefined } : a
    );
    await browser.storage.local.set({ inboxes: updated });
    await onReloadAccounts();
  } finally {
    saving = false;
  }
}
</script>

<div class="flex flex-col h-full">
  <!-- Header -->
  <div class="flex items-center gap-3 px-4 py-4 border-b border-md-secondary-container">
    <button
      class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-md-secondary-container transition-colors"
      onclick={onBack}
      aria-label="Back"
    >
      <IconChevronLeft class="w-5 h-5" />
    </button>
    <div>
      <h1 class="text-base font-bold text-md-on-surface">Tag Management</h1>
      <p class="text-xs text-md-on-surface/50">Manage mailbox tags</p>
    </div>
  </div>

  <div class="flex-1 overflow-y-auto px-4 py-4 space-y-3" style="scrollbar-width: thin;">
    {#if tagGroups.length === 0}
      <div class="text-center py-12 text-md-on-surface/40">
        <div class="text-4xl mb-3">🏷️</div>
        <p class="text-sm">No tags created yet.</p>
        <p class="text-xs mt-1">Add tags to your inboxes from the inbox list.</p>
      </div>
    {:else}
      {#each tagGroups as group}
        <div class="bg-md-primary-container rounded-xl px-4 py-3">
          {#if editingTag?.oldTag === group.tag}
            <div class="space-y-2">
              <div class="flex items-center gap-2">
                <input
                  type="color"
                  class="w-8 h-8 rounded-lg cursor-pointer border-0 p-0.5 bg-transparent"
                  bind:value={editingTag.color}
                  aria-label="Tag color"
                />
                <input
                  type="text"
                  class="flex-1 bg-md-secondary-container text-sm text-md-on-surface rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-md-primary"
                  bind:value={editingTag.newTag}
                  placeholder="Tag name"
                  aria-label="Tag name"
                />
              </div>
              {#if errorMsg}
                <p class="text-xs text-md-error">{errorMsg}</p>
              {/if}
              <div class="flex gap-2">
                <button
                  class="flex-1 px-3 py-1.5 text-xs rounded-lg bg-md-primary text-md-on-primary hover:bg-md-primary/90 transition-colors disabled:opacity-50"
                  onclick={saveEdit}
                  disabled={saving}
                >Save</button>
                <button
                  class="flex-1 px-3 py-1.5 text-xs rounded-lg bg-md-secondary-container text-md-on-surface hover:bg-md-secondary-container/80 transition-colors"
                  onclick={cancelEdit}
                >Cancel</button>
              </div>
            </div>
          {:else}
            <div class="flex items-center justify-between">
              <button
                class="flex items-center gap-2 flex-1 text-left"
                onclick={() => startEdit(group.tag, group.color)}
                aria-label="Edit tag {group.tag}"
              >
                <span class="w-3 h-3 rounded-full shrink-0" style="background:{group.color}"></span>
                <span class="font-medium text-sm text-md-on-surface">{group.tag}</span>
                <span class="text-xs text-md-on-surface/50 ml-1">· {group.accounts.length} inbox{group.accounts.length === 1 ? '' : 'es'}</span>
              </button>
              <button
                class="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-md-error/10 text-md-error transition-colors ml-2"
                onclick={() => deleteTag(group.tag)}
                aria-label="Delete tag {group.tag}"
                disabled={saving}
              >
                <IconTrash class="w-4 h-4" />
              </button>
            </div>
            <!-- Inbox list under tag -->
            <div class="mt-2 space-y-1 pl-5">
              {#each group.accounts as acc}
                <div class="text-xs text-md-on-surface/60 truncate">{acc.address}</div>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</div>
