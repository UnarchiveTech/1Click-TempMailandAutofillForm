<script lang="ts">
import { get } from 'svelte/store';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import Icon from '@/components/icons/Icon.svelte';
import { timeAgo } from '@/utils/time.js';
import type { Account } from '@/utils/types.js';

type CatalogTag = { tag: string; color: string; createdAt?: number };

let {
  onBack = () => {},
  allInboxes = [] as Account[],
  onReloadAccounts = async () => {},
  onNavigateTo = undefined,
  showConfirm = (_message: string, _onConfirm: () => void) => {},
  createSignal = 0,
  /** When true (Organize page), hide page chrome + legacy sub-nav */
  embedded = false,
} = $props<{
  onBack?: () => void;
  allInboxes?: Account[];
  onReloadAccounts?: () => Promise<void>;
  onNavigateTo?: (view: string) => void;
  showConfirm?: (message: string, onConfirm: () => void) => void;
  createSignal?: number;
  embedded?: boolean;
}>();

let tagCatalog = $state<CatalogTag[]>([]);

async function loadTagCatalog() {
  try {
    const res = (await browser.storage.local.get(['mailboxTagCatalog'])) as {
      mailboxTagCatalog?: CatalogTag[];
    };
    tagCatalog = (res.mailboxTagCatalog || []).map((c) => ({
      tag: c.tag,
      color: c.color || '#6750a4',
      createdAt: c.createdAt || Date.now(),
    }));
  } catch {
    tagCatalog = [];
  }
}

$effect(() => {
  void loadTagCatalog();
});

// Collect unique tags across all inboxes + catalog
let tagGroups = $derived.by(() => {
  const map = new Map<string, { color: string; accounts: Account[]; createdAt: number }>();
  for (const acc of allInboxes) {
    if (!acc.tag) continue;
    const key = acc.tag;
    if (!map.has(key)) {
      map.set(key, {
        color: acc.tagColor || '#6750a4',
        accounts: [],
        createdAt: 0,
      });
    }
    map.get(key)?.accounts.push(acc);
  }
  for (const c of tagCatalog) {
    if (!map.has(c.tag)) {
      map.set(c.tag, {
        color: c.color || '#6750a4',
        accounts: [],
        createdAt: c.createdAt || Date.now(),
      });
    } else {
      const g = map.get(c.tag);
      if (g) {
        g.createdAt = c.createdAt || g.createdAt;
        if (!g.color) g.color = c.color;
      }
    }
  }
  return [...map.entries()]
    .map(([tag, { color, accounts, createdAt }]) => ({
      tag,
      color,
      accounts,
      createdAt,
    }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
});

let editingTag = $state<{
  oldTag: string;
  newTag: string;
  color: string;
  isNew?: boolean;
  assignIds: string[];
} | null>(null);
let saving = $state(false);
let errorMsg = $state('');
/** After create — offer assign dialog if user skipped assignment */
let postCreateAssign = $state<{ tag: string; color: string } | null>(null);
let postAssignIds = $state<string[]>([]);

let lastTagCreateSignal = 0;
$effect(() => {
  const n = createSignal;
  if (n > 0 && n !== lastTagCreateSignal) {
    lastTagCreateSignal = n;
    editingTag = {
      oldTag: '',
      newTag: '',
      color: '#6750a4',
      isNew: true,
      assignIds: [],
    };
    errorMsg = '';
    postCreateAssign = null;
  }
});

function startEdit(tag: string, color: string, accounts: Account[]) {
  editingTag = {
    oldTag: tag,
    newTag: tag,
    color,
    isNew: false,
    assignIds: accounts.map((a) => a.id),
  };
  errorMsg = '';
}

function cancelEdit() {
  editingTag = null;
  errorMsg = '';
}

function toggleAssignId(id: string) {
  if (!editingTag) return;
  const set = new Set(editingTag.assignIds);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  editingTag = { ...editingTag, assignIds: [...set] };
}

async function applyTagToInboxes(tag: string, color: string, assignIds: string[], oldTag?: string) {
  const { inboxes = [] } = (await browser.storage.local.get(['inboxes'])) as {
    inboxes?: Account[];
  };
  const assignSet = new Set(assignIds);
  const updated = inboxes.map((a) => {
    // Rename: clear old tag from non-assigned
    if (oldTag && a.tag === oldTag && !assignSet.has(a.id)) {
      return { ...a, tag: undefined, tagColor: undefined };
    }
    if (assignSet.has(a.id)) {
      return { ...a, tag, tagColor: color };
    }
    return a;
  });
  await browser.storage.local.set({ inboxes: updated });
}

async function saveEdit() {
  if (!editingTag) return;
  const { oldTag, newTag, color, isNew, assignIds } = editingTag;
  const trimmed = newTag.trim();
  if (!trimmed) {
    errorMsg = get(t)('tagManagement.tagNameEmpty');
    return;
  }
  // Unique name (case-insensitive) among other tags
  const clash = tagGroups.some(
    (g) => g.tag.toLowerCase() === trimmed.toLowerCase() && g.tag !== oldTag
  );
  if (clash) {
    errorMsg = get(t)('tagManagement.tagNameDuplicate');
    return;
  }
  saving = true;
  try {
    if (isNew || !oldTag) {
      const next: CatalogTag[] = [
        ...tagCatalog.filter((c) => c.tag.toLowerCase() !== trimmed.toLowerCase()),
        { tag: trimmed, color, createdAt: Date.now() },
      ];
      tagCatalog = next;
      await browser.storage.local.set({ mailboxTagCatalog: next });
      if (assignIds.length > 0) {
        await applyTagToInboxes(trimmed, color, assignIds);
        await onReloadAccounts();
        editingTag = null;
      } else {
        editingTag = null;
        // Suggest assignment dialog (issue 14)
        postCreateAssign = { tag: trimmed, color };
        postAssignIds = [];
      }
      return;
    }
    await applyTagToInboxes(trimmed, color, assignIds, oldTag);
    const nextCat = tagCatalog.map((c) => (c.tag === oldTag ? { ...c, tag: trimmed, color } : c));
    // Ensure catalog entry exists
    if (!nextCat.some((c) => c.tag === trimmed)) {
      nextCat.push({ tag: trimmed, color, createdAt: Date.now() });
    }
    tagCatalog = nextCat;
    await browser.storage.local.set({ mailboxTagCatalog: nextCat });
    await onReloadAccounts();
    editingTag = null;
  } finally {
    saving = false;
  }
}

async function deleteTag(tag: string) {
  showConfirm(get(t)('tagManagement.removeTagConfirm', { values: { name: tag } }), () => {
    void (async () => {
      saving = true;
      try {
        const { inboxes = [] } = (await browser.storage.local.get(['inboxes'])) as {
          inboxes?: Account[];
        };
        const updated = inboxes.map((a) =>
          a.tag === tag ? { ...a, tag: undefined, tagColor: undefined } : a
        );
        await browser.storage.local.set({ inboxes: updated });
        // Also remove from catalog (tags with 0 inboxes)
        const nextCat = tagCatalog.filter((c) => c.tag !== tag);
        tagCatalog = nextCat;
        await browser.storage.local.set({ mailboxTagCatalog: nextCat });
        await onReloadAccounts();
      } finally {
        saving = false;
      }
    })();
  });
}

function togglePostAssign(id: string) {
  const set = new Set(postAssignIds);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  postAssignIds = [...set];
}

async function savePostAssign() {
  if (!postCreateAssign) return;
  saving = true;
  try {
    if (postAssignIds.length > 0) {
      await applyTagToInboxes(postCreateAssign.tag, postCreateAssign.color, postAssignIds);
      await onReloadAccounts();
    }
    postCreateAssign = null;
    postAssignIds = [];
  } finally {
    saving = false;
  }
}

function formatCreated(ts: number): string {
  if (!ts) return '';
  try {
    return timeAgo(ts > 1e12 ? Math.floor(ts / 1000) : ts);
  } catch {
    return new Date(ts).toLocaleDateString();
  }
}
</script>

<div class="relative flex flex-col h-full min-h-0">
  {#if !embedded}
    <div class="px-2 py-2 border-b border-md-outline-variant/30 shrink-0">
      <h1 class="text-base font-bold text-md-on-surface">{$t('tagManagement.title')}</h1>
      <p class="text-xs text-md-on-surface/50">{$t('tagManagement.subtitle')}</p>
    </div>
  {/if}

  <div class="flex-1 overflow-y-auto px-2 py-3 min-h-0">
    {#if tagGroups.length === 0}
      <div class="text-center py-12 text-md-on-surface/40">
        <div class="text-4xl mb-3">🏷️</div>
        <p class="text-sm">{$t('tagManagement.noTags')}</p>
        <p class="text-xs mt-1">{$t('tagManagement.noTagsHint')}</p>
      </div>
    {:else}
      <div
        class="grid gap-3"
        style="grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr));"
      >
      {#each tagGroups as group (group.tag)}
        <div class="density-row-pad bg-md-primary-container rounded-xl px-4 min-w-0">
          <div class="flex items-start justify-between gap-2">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 min-w-0">
                <span
                  class="w-3 h-3 rounded-full shrink-0"
                  style="background-color: {group.color};"
                ></span>
                <span class="font-medium text-sm text-md-on-surface truncate">{group.tag}</span>
                <span class="text-xs text-md-on-surface/50 ms-1 shrink-0">
                  · {$t('tagManagement.inboxCount', {
                    values: { n: group.accounts.length },
                  })}
                </span>
              </div>
              {#if group.createdAt}
                <p class="text-xs text-md-on-surface/45 mt-0.5 ps-5">
                  {$t('tagManagement.createdAt', { values: { time: formatCreated(group.createdAt) } })}
                </p>
              {/if}
            </div>
            <div class="flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                class="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-md-primary/10 text-md-primary transition-colors"
                onclick={() => startEdit(group.tag, group.color, group.accounts)}
                aria-label={$t('tagManagement.editTag', { values: { name: group.tag } })}
                title={$t('tagManagement.editTag', { values: { name: group.tag } })}
              >
                <Icon name="editSquare" class="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                class="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-md-error/10 text-md-error transition-colors"
                onclick={() => deleteTag(group.tag)}
                aria-label={$t('tagManagement.deleteTag', { values: { name: group.tag } })}
                disabled={saving}
              >
                <Icon name="trash" class="w-4 h-4" />
              </button>
            </div>
          </div>
          <div class="mt-2 space-y-1 ps-5">
            {#each group.accounts as acc (acc.id)}
              <div class="text-xs text-md-on-surface/60 truncate" style="direction:ltr;unicode-bidi:isolate;">{acc.address}</div>
            {/each}
          </div>
        </div>
      {/each}
      </div>
    {/if}
  </div>

  <!-- Create / Edit tag dialog overlay -->
  {#if editingTag}
    <div class="absolute inset-0 z-[100] flex items-center justify-center p-3" role="dialog" aria-modal="true">
      <button
        type="button"
        class="absolute inset-0 bg-md-scrim/40 backdrop-blur-sm border-0 cursor-default"
        aria-label={$t('common.close')}
        onclick={cancelEdit}
      ></button>
      <div class="relative z-10 w-full max-w-sm max-h-[min(90%,520px)] overflow-y-auto rounded-2xl bg-md-surface border border-md-outline-variant/40 shadow-2xl p-4 space-y-3">
        <h3 class="text-sm font-bold text-md-on-surface">
          {editingTag.isNew ? $t('tagManagement.createTitle') : $t('tagManagement.editTag', { values: { name: editingTag.oldTag } })}
        </h3>
        <div class="flex items-center gap-2">
          <input
            type="color"
            class="w-8 h-8 rounded-lg cursor-pointer border-0 p-0.5 bg-transparent"
            bind:value={editingTag.color}
            aria-label={$t('tagManagement.tagColor')}
          />
          <input
            type="text"
            class="flex-1 bg-md-secondary-container text-sm text-md-on-surface rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-md-primary"
            bind:value={editingTag.newTag}
            placeholder={$t('tagManagement.tagName')}
            aria-label={$t('tagManagement.tagName')}
          />
        </div>
        <div class="space-y-1">
          <p class="text-label-sm font-semibold text-md-on-surface/60">{$t('tagManagement.assignAddresses')}</p>
          <div class="max-h-36 overflow-y-auto rounded-lg border border-md-outline-variant/30 divide-y divide-md-outline-variant/20">
            {#if allInboxes.length === 0}
              <p class="text-label-sm text-md-on-surface/40 px-2 py-2">{$t('tagManagement.noAddresses')}</p>
            {:else}
              {#each allInboxes as acc (acc.id)}
                <label class="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-md-surface-variant/40">
                  <input
                    type="checkbox"
                    class="rounded border-md-outline-variant"
                    checked={editingTag.assignIds.includes(acc.id)}
                    onchange={() => toggleAssignId(acc.id)}
                  />
                  <span class="text-label-sm truncate" style="direction:ltr;unicode-bidi:isolate;">{acc.address}</span>
                </label>
              {/each}
            {/if}
          </div>
        </div>
        {#if errorMsg}
          <p class="text-xs text-md-error">{errorMsg}</p>
        {/if}
        <div class="flex gap-2">
          <button
            type="button"
            class="flex-1 px-3 py-2 text-xs rounded-xl bg-md-primary text-md-on-primary font-semibold disabled:opacity-50"
            onclick={() => void saveEdit()}
            disabled={saving}
          >{$t('tagManagement.save')}</button>
          <button
            type="button"
            class="flex-1 px-3 py-2 text-xs rounded-xl bg-md-secondary-container text-md-on-surface"
            onclick={cancelEdit}
          >{$t('tagManagement.cancel')}</button>
        </div>
      </div>
    </div>
  {/if}

  {#if postCreateAssign}
    <div class="absolute inset-0 z-[100] flex items-center justify-center p-3" role="dialog" aria-modal="true">
      <button
        type="button"
        class="absolute inset-0 bg-md-scrim/40 backdrop-blur-sm border-0 cursor-default"
        aria-label={$t('common.close')}
        onclick={() => { postCreateAssign = null; postAssignIds = []; }}
      ></button>
      <div class="relative z-10 w-full max-w-sm rounded-2xl bg-md-surface border border-md-outline-variant/40 shadow-2xl p-4 space-y-3">
        <p class="text-xs font-semibold text-md-on-surface">
          {$t('tagManagement.assignAfterCreate', { values: { name: postCreateAssign.tag } })}
        </p>
        <div class="max-h-36 overflow-y-auto rounded-lg border border-md-outline-variant/30 divide-y divide-md-outline-variant/20">
          {#each allInboxes as acc (acc.id)}
            <label class="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-md-surface-variant/40">
              <input
                type="checkbox"
                class="rounded border-md-outline-variant"
                checked={postAssignIds.includes(acc.id)}
                onchange={() => togglePostAssign(acc.id)}
              />
              <span class="text-label-sm truncate" style="direction:ltr;unicode-bidi:isolate;">{acc.address}</span>
            </label>
          {/each}
        </div>
        <div class="flex gap-2">
          <button
            type="button"
            class="flex-1 px-3 py-2 text-xs rounded-xl bg-md-primary text-md-on-primary font-semibold disabled:opacity-50"
            disabled={saving}
            onclick={() => void savePostAssign()}
          >{$t('tagManagement.assignSave')}</button>
          <button
            type="button"
            class="flex-1 px-3 py-2 text-xs rounded-xl bg-md-surface-variant text-md-on-surface"
            onclick={() => { postCreateAssign = null; postAssignIds = []; }}
          >{$t('tagManagement.skipAssign')}</button>
        </div>
      </div>
    </div>
  {/if}
</div>
