<script lang="ts">
import { t } from 'svelte-i18n';
import type { Account, SavedSearchFilter } from '@/utils/types.js';
import FiltersManagementView from '@/views/FiltersManagementView.svelte';
import LabelManagementView from '@/views/LabelManagementView.svelte';
import TagManagementView from '@/views/TagManagementView.svelte';

export type OrganizeTab = 'tags' | 'labels' | 'filters';

let {
  initialTab = 'tags' as OrganizeTab,
  allInboxes = [] as Account[],
  savedSearchFilters = [] as SavedSearchFilter[],
  onReloadAccounts = async () => {},
  onFiltersChange = async () => {},
  showConfirm = (_message: string, _onConfirm: () => void) => {},
  tagCreateSignal = 0,
  labelCreateSignal = 0,
  tabSignal = 0,
  tabSignalValue = 'tags' as OrganizeTab,
}: {
  initialTab?: OrganizeTab;
  allInboxes?: Account[];
  savedSearchFilters?: SavedSearchFilter[];
  onReloadAccounts?: () => Promise<void>;
  onFiltersChange?: () => Promise<void>;
  showConfirm?: (message: string, onConfirm: () => void) => void;
  tagCreateSignal?: number;
  labelCreateSignal?: number;
  /** Increment to force tab switch from parent (FAB / deep links) */
  tabSignal?: number;
  tabSignalValue?: OrganizeTab;
} = $props();

let activeTab = $state<OrganizeTab>('tags');
let lastTabSignal = 0;
let lastInitial = '';

$effect(() => {
  // Sync when parent deep-links via initialTab / tabSignal
  const next = tabSignal > 0 ? tabSignalValue : initialTab;
  if (tabSignal > 0 && tabSignal !== lastTabSignal) {
    lastTabSignal = tabSignal;
    activeTab = tabSignalValue;
    return;
  }
  if (initialTab && initialTab !== lastInitial) {
    lastInitial = initialTab;
    activeTab = initialTab;
  }
  void next;
});

let tagCount = $derived(
  new Set(
    allInboxes.map((a) => (a as Account & { tag?: string }).tag).filter((t): t is string => !!t)
  ).size
);
let labelCount = $state(0);
let filterCount = $derived(savedSearchFilters.length);

$effect(() => {
  void (async () => {
    try {
      const { browser } = await import('wxt/browser');
      const { emailTags = {} } = (await browser.storage.local.get(['emailTags'])) as {
        emailTags?: Record<string, string[]>;
      };
      const set = new Set<string>();
      for (const list of Object.values(emailTags)) {
        if (Array.isArray(list)) for (const x of list) if (x) set.add(x);
      }
      labelCount = set.size;
    } catch {
      labelCount = 0;
    }
  })();
});

const tabs = $derived([
  { id: 'tags' as const, labelKey: 'nav.tagManagement', count: tagCount },
  { id: 'labels' as const, labelKey: 'nav.labelManagement', count: labelCount },
  {
    id: 'filters' as const,
    labelKey: 'nav.filtersAndAutomations',
    count: filterCount,
  },
]);
</script>

<div class="relative flex flex-col h-full min-h-0">
  <div class="shrink-0 px-2 pt-2 pb-1 border-b border-md-outline-variant/30">
    <h1 class="text-base font-bold text-md-on-surface px-0.5 mb-2">{$t('nav.organize')}</h1>
    <div
      class="flex gap-1 p-1 rounded-xl bg-md-surface-variant"
      role="tablist"
      aria-label={$t('nav.organize')}
    >
      {#each tabs as tab (tab.id)}
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          id="organize-tab-{tab.id}"
          class="flex-1 min-w-0 px-2 py-1.5 rounded-lg text-xs font-semibold transition-colors truncate
            {activeTab === tab.id
              ? 'bg-md-surface text-md-on-surface shadow-sm'
              : 'text-md-on-surface/60 hover:text-md-on-surface'}"
          onclick={() => (activeTab = tab.id)}
        >
          {$t(tab.labelKey)} ({tab.count})
        </button>
      {/each}
    </div>
  </div>

  <div class="flex-1 min-h-0 overflow-hidden" role="tabpanel" aria-labelledby="organize-tab-{activeTab}">
    {#if activeTab === 'tags'}
      <TagManagementView
        embedded={true}
        {allInboxes}
        {onReloadAccounts}
        {showConfirm}
        createSignal={tagCreateSignal}
      />
    {:else if activeTab === 'labels'}
      <LabelManagementView embedded={true} createSignal={labelCreateSignal} />
    {:else}
      <FiltersManagementView
        embedded={true}
        {savedSearchFilters}
        {onFiltersChange}
        {showConfirm}
      />
    {/if}
  </div>
</div>
