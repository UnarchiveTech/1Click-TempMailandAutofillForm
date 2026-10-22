
<script lang="ts">
/**
 * Autofill manager hub - identities, saved logins, and site information.
 * Deep-links: openView autofill|identities|loginInfo + autofillTab.
 */

import { onMount, untrack } from 'svelte';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import type { AutofillTab } from '@/features/types/view-types.js';
import EmptyState from '@/ui/components/composites/EmptyState.svelte';
import FloatingAction from '@/ui/components/composites/FloatingAction.svelte';
import type { TabItem } from '@/ui/components/composites/Tabs.svelte';
import Tabs from '@/ui/components/composites/Tabs.svelte';
import { logError } from '@/utils/logger.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import type { Address, CredentialsHistoryItem, Identity } from '@/utils/types.js';
import { toastStore } from '@/utils/ui/toastStore.js';
import IdentitiesView from './IdentitiesView.svelte';
import SavedLoginsView from './SavedLoginsView.svelte';
import SitesView from './SitesView.svelte';

const tabsIdPrefix = $props.id();

let {
  context = 'popup' as 'popup' | 'sidepanel' | 'app',
  initialTab = 'profiles' as AutofillTab,
  tabSignal = 0,
  tabSignalValue = 'profiles' as AutofillTab,
  onTabChange = (_tab: AutofillTab) => {},
  paletteWebsiteFilter = '',
  paletteWebsiteFilterSignal = 0,
  initialSiteDomain = '',
  savedLogins = [] as CredentialsHistoryItem[],
  identities = [] as Identity[],
  allAddresses = [] as Address[],
  mailboxAddresses = [] as string[],
  activeMailboxAddress = '',
  loginInfoEmailFilter = '',
  identitiesEmailFilter = '',
  focusSearchSignal = 0,
  createSignal = 0,
  editIdSignal = '',
  vaultLockSignal = 0,
  /** When true (≥1280), editor opens in AppLayout data-splitview host (not merged into list) */
  layoutSplit = false,
  splitHostId = 'autofill-split-host',
  splitHostRef = null,
  onDeleteLogin = (_id: string) => {},
  onReorderLogin = (_sourceId: string, _targetId: string) => {},
  onOpenInbox = async (_address: string) => {},
  showToast = (_message: string) => {},
  showConfirm = (
    _message: string,
    _onConfirm: () => void,
    _options?: import('@/utils/ui/shared-ui.js').ConfirmDialogOptions
  ) => {},
}: {
  context?: 'popup' | 'sidepanel' | 'app';
  initialTab?: AutofillTab;
  tabSignal?: number;
  tabSignalValue?: AutofillTab;
  onTabChange?: (tab: AutofillTab) => void;
  paletteWebsiteFilter?: string;
  paletteWebsiteFilterSignal?: number;
  initialSiteDomain?: string;
  savedLogins?: CredentialsHistoryItem[];
  identities?: Identity[];
  /** All mailboxes (incl. archived/deleted/expired) - powers the login health auditor. */
  allAddresses?: Address[];
  mailboxAddresses?: string[];
  activeMailboxAddress?: string;
  loginInfoEmailFilter?: string;
  identitiesEmailFilter?: string;
  focusSearchSignal?: number;
  createSignal?: number;
  editIdSignal?: string;
  vaultLockSignal?: number;
  layoutSplit?: boolean;
  splitHostId?: string;
  splitHostRef?: HTMLElement | null;
  onDeleteLogin?: (id: string) => void;
  onReorderLogin?: (sourceId: string, targetId: string) => void;
  onOpenInbox?: (address: string) => Promise<void>;
  showToast?: (message: string) => void;
  showConfirm?: (
    message: string,
    onConfirm: () => void,
    options?: import('@/utils/ui/shared-ui.js').ConfirmDialogOptions
  ) => void;
} = $props();

let localCreateSignal = $state(0);

let activeTab = $state<AutofillTab>(untrack(() => initialTab));
$effect(() => {
  onTabChange(activeTab);
});
let siteSearchDomain = $state('');
let siteSearchSignal = $state(0);
let loginIdentityFilterId = $state<string | null>(null);
let identityCredentialsContext = $state(false);
let lastTabSignal = 0;
let lastInitial = '';
let lastPaletteWebsiteFilterSignal = 0;
let autofillFeatureEnabled = $state(true);

onMount(() => {
  void browser.storage.local.get(['autofillFeatureEnabled']).then((r) => {
    autofillFeatureEnabled =
      (r as { autofillFeatureEnabled?: boolean }).autofillFeatureEnabled !== false;
  });
  const onChange = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== 'local' || !changes.autofillFeatureEnabled) return;
    autofillFeatureEnabled = changes.autofillFeatureEnabled.newValue !== false;
  };
  try {
    browser.storage.onChanged.addListener(onChange);
  } catch {
    /* ignore */
  }
  return () => {
    try {
      browser.storage.onChanged.removeListener(onChange);
    } catch {
      /* ignore */
    }
  };
});

async function enableAutofillFeature() {
  const previous = autofillFeatureEnabled;
  autofillFeatureEnabled = true;
  try {
    await writeWithRetry({ autofillFeatureEnabled: true });
  } catch (error) {
    autofillFeatureEnabled = previous;
    logError('Failed to enable autofill feature', error);
    toastStore.error($t('toasts.settingsSaveFailed'));
    return;
  }
  showToast($t('preferences.autofillFeatureEnabled'));
}

$effect(() => {
  if (
    paletteWebsiteFilterSignal > 0 &&
    paletteWebsiteFilterSignal !== lastPaletteWebsiteFilterSignal
  ) {
    lastPaletteWebsiteFilterSignal = paletteWebsiteFilterSignal;
    siteSearchDomain = paletteWebsiteFilter;
    siteSearchSignal += 1;
    loginIdentityFilterId = null;
    identityCredentialsContext = false;
    activeTab = 'credentials';
  }
});

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

const tabItems = $derived<TabItem[]>([
  { id: 'profiles', label: $t('nav.profiles'), badge: identities.length, icon: 'person' },
  {
    id: 'credentials',
    label: $t('nav.credentials'),
    subheading: $t('nav.credentialsSubtitle'),
    badge: savedLogins.length,
    icon: 'lock',
  },
  { id: 'sites', label: $t('nav.sites'), icon: 'globe' },
]);

function openSiteCredentials(domain: string) {
  loginIdentityFilterId = null;
  identityCredentialsContext = false;
  siteSearchDomain = domain;
  siteSearchSignal += 1;
  activeTab = 'credentials';
}

function openIdentityCredentials(identityId: string) {
  loginIdentityFilterId = identityId;
  identityCredentialsContext = true;
  siteSearchDomain = '';
  siteSearchSignal = 0;
  activeTab = 'credentials';
}
</script>

<div class="flex flex-col h-full min-h-0" data-tour="autofill-hub">
  {#if !autofillFeatureEnabled}
    <div class="flex-1 min-h-0 flex flex-col">
      <EmptyState
        icon="editSquare"
        title={$t('autofillPage.disabledTitle')}
        description={$t('autofillPage.disabledDescription')}
        actionLabel={$t('autofillPage.enableAction')}
        onAction={() => void enableAutofillFeature()}
        fillParent
      />
    </div>
  {:else}
  <div class="shrink-0 pt-2 pb-1 border-b border-md-outline-variant/30">
    <Tabs
      tabs={tabItems}
      bind:activeTab
      idPrefix={tabsIdPrefix}
      ariaLabel={$t('nav.autofill')}
      showInSidebar={true}
      variant="pill"
      fullWidth={true}
    />
    <FloatingAction
      kind={activeTab === 'profiles' ? 'createIdentity' : 'ghostLogin'}
      onclick={() => {
        if (activeTab === 'profiles') {
          localCreateSignal += 1;
        } else if (activeTab === 'sites') {
          activeTab = 'credentials';
        }
      }}
    />
  </div>

  <div
    id="{tabsIdPrefix}-panel-{activeTab}"
    class="flex-1 min-h-0 overflow-hidden"
    role="tabpanel"
    aria-labelledby="{tabsIdPrefix}-tab-{activeTab}"
    tabindex="0"
  >
    {#if activeTab === 'profiles'}
      <IdentitiesView
        {context}
        savedLogins={savedLogins}
        {mailboxAddresses}
        {activeMailboxAddress}
        onOpenSavedLogins={openIdentityCredentials}
        initialEmailFilter={identitiesEmailFilter}
        createSignal={createSignal + localCreateSignal}
        editIdSignal={editIdSignal}
        useSplitEditor={layoutSplit}
        splitHostId={splitHostId}
        splitHostRef={splitHostRef}
        {showConfirm}
      />
    {:else if activeTab === 'credentials'}
      <SavedLoginsView
        {context}
        {savedLogins}
        {allAddresses}
        {identities}
        initialEmailFilter={identityCredentialsContext ? '' : loginInfoEmailFilter}
        bind:filterIdentityId={loginIdentityFilterId}
        initialWebsiteFilter={siteSearchDomain}
        websiteFilterSignal={siteSearchSignal}
        {focusSearchSignal}
        {vaultLockSignal}
        onDelete={onDeleteLogin}
        onReorder={onReorderLogin}
        {showToast}
      />
    {:else}
      <SitesView
        initialDomain={initialSiteDomain}
        {savedLogins}
        {identities}
        {allAddresses}
        onOpenCredentials={openSiteCredentials}
        {onOpenInbox}
        {focusSearchSignal}
      />
    {/if}
  </div>
  {/if}
</div>
