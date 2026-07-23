<script lang="ts">
/**
 * Autofill manager hub — Profiles (person templates) + Credentials (signup autofill).
 * Deep-links: openView autofill|identities|loginInfo + autofillTab.
 */
import { t } from 'svelte-i18n';
import type { CredentialsHistoryItem, Identity } from '@/utils/types.js';
import IdentitiesView from '@/views/IdentitiesView.svelte';
import SavedLoginsView from '@/views/SavedLoginsView.svelte';

export type AutofillTab = 'profiles' | 'credentials';

let {
  context = 'popup' as 'popup' | 'sidepanel' | 'app',
  initialTab = 'profiles' as AutofillTab,
  tabSignal = 0,
  tabSignalValue = 'profiles' as AutofillTab,
  savedLogins = [] as CredentialsHistoryItem[],
  identities = [] as Identity[],
  mailboxAddresses = [] as string[],
  activeMailboxAddress = '',
  loginInfoEmailFilter = '',
  identitiesEmailFilter = '',
  focusSearchSignal = 0,
  createSignal = 0,
  editIdSignal = '',
  /** When true (≥1280), editor opens in AppLayout data-splitview host (not merged into list) */
  layoutSplit = false,
  /** DOM id of the splitview host column */
  splitHostId = 'autofill-split-host',
  onDeleteLogin = (_id: string) => {},
  onReorderLogin = (_sourceId: string, _targetId: string) => {},
  showToast = (_message: string) => {},
  showConfirm = (_message: string, _onConfirm: () => void) => {},
}: {
  context?: 'popup' | 'sidepanel' | 'app';
  initialTab?: AutofillTab;
  tabSignal?: number;
  tabSignalValue?: AutofillTab;
  savedLogins?: CredentialsHistoryItem[];
  identities?: Identity[];
  mailboxAddresses?: string[];
  activeMailboxAddress?: string;
  loginInfoEmailFilter?: string;
  identitiesEmailFilter?: string;
  focusSearchSignal?: number;
  createSignal?: number;
  editIdSignal?: string;
  layoutSplit?: boolean;
  splitHostId?: string;
  onDeleteLogin?: (id: string) => void;
  onReorderLogin?: (sourceId: string, targetId: string) => void;
  showToast?: (message: string) => void;
  showConfirm?: (message: string, onConfirm: () => void) => void;
} = $props();

let activeTab = $state<AutofillTab>('profiles');
let lastTabSignal = 0;
let lastInitial = '';

$effect(() => {
  if (tabSignal > 0 && tabSignal !== lastTabSignal) {
    lastTabSignal = tabSignal;
    activeTab = tabSignalValue;
    return;
  }
  if (initialTab && initialTab !== lastInitial) {
    lastInitial = initialTab;
    activeTab = initialTab;
  }
});

const tabs = $derived([
  {
    id: 'profiles' as const,
    labelKey: 'nav.profiles',
    count: identities.length,
  },
  {
    id: 'credentials' as const,
    labelKey: 'nav.credentials',
    subtitleKey: 'nav.credentialsSubtitle',
    count: savedLogins.length,
  },
]);
</script>

<div class="flex flex-col h-full min-h-0" data-tour="autofill-hub">
  <div class="shrink-0 px-2 pt-2 pb-1 border-b border-md-outline-variant/30">
    <h1 class="text-base font-bold text-md-on-surface px-0.5 mb-0.5">{$t('nav.autofill')}</h1>
    <p class="text-xs text-md-on-surface/55 px-0.5 mb-2">{$t('nav.autofillSubtitle')}</p>
    <div
      class="flex gap-1 p-1 rounded-xl bg-md-surface-variant"
      role="tablist"
      aria-label={$t('nav.autofill')}
    >
      {#each tabs as tab (tab.id)}
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          id="autofill-tab-{tab.id}"
          data-tour="autofill-tab-{tab.id}"
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
    {#if activeTab === 'credentials'}
      <p class="text-label-sm text-md-on-surface/50 px-0.5 mt-1.5">
        {$t('nav.credentialsSubtitle')}
      </p>
    {/if}
  </div>

  <div
    class="flex-1 min-h-0 overflow-hidden"
    role="tabpanel"
    aria-labelledby="autofill-tab-{activeTab}"
  >
    {#if activeTab === 'profiles'}
      <IdentitiesView
        {context}
        savedLogins={savedLogins}
        {mailboxAddresses}
        {activeMailboxAddress}
        initialEmailFilter={identitiesEmailFilter}
        {createSignal}
        {editIdSignal}
        useSplitEditor={layoutSplit}
        splitHostId={splitHostId}
        {showConfirm}
      />
    {:else}
      <SavedLoginsView
        {context}
        {savedLogins}
        {identities}
        initialEmailFilter={loginInfoEmailFilter}
        {focusSearchSignal}
        onDelete={onDeleteLogin}
        onReorder={onReorderLogin}
        {showToast}
      />
    {/if}
  </div>
</div>
