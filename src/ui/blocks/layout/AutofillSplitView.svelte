<script lang="ts">
import type { AutofillTab } from '@/features/types/view-types.js';
import { loadLazyComponent } from '@/ui/blocks/layout/lazy-view.svelte.js';
import SplitPaneEmptyState from '@/ui/blocks/layout/SplitPaneEmptyState.svelte';
import SplitViewShell from '@/ui/blocks/layout/SplitViewShell.svelte';
import ViewFallback from '@/ui/blocks/layout/ViewFallback.svelte';
import type { Address, CredentialsHistoryItem, Identity } from '@/utils/types.js';

let {
  context,
  layoutSplit,
  layoutVerticalSplit,
  splitModeFlash,
  showSplitPane,
  splitPaneCollapsed,
  splitListWidthPx,
  splitHostRef = $bindable<HTMLElement | null>(null),
  initialTab,
  tabSignal,
  tabSignalValue,
  onTabChange,
  paletteWebsiteFilter,
  paletteWebsiteFilterSignal,
  initialSiteDomain = '',
  savedLogins,
  identities,
  allAddresses,
  mailboxAddresses,
  activeMailboxAddress,
  loginInfoEmailFilter,
  identitiesEmailFilter,
  focusSearchSignal,
  identityCreateSignal,
  identityEditIdSignal,
  vaultLockSignal,
  onDeleteLogin,
  onReorderLogin,
  onOpenInbox,
  onShowToast,
  onShowConfirm,
  onToggleSplitPane,
  onWidthChange,
  onExpandSplitPane,
}: {
  context: 'popup' | 'sidepanel' | 'app';
  layoutSplit: boolean;
  layoutVerticalSplit: boolean;
  splitModeFlash: boolean;
  showSplitPane: boolean;
  splitPaneCollapsed: boolean;
  splitListWidthPx: number;
  splitHostRef?: HTMLElement | null;
  initialTab: AutofillTab;
  tabSignal: number;
  tabSignalValue: AutofillTab;
  onTabChange: (tab: AutofillTab) => void;
  paletteWebsiteFilter: string;
  paletteWebsiteFilterSignal: number;
  initialSiteDomain?: string;
  savedLogins: CredentialsHistoryItem[];
  identities: Identity[];
  allAddresses: Address[];
  mailboxAddresses: string[];
  activeMailboxAddress: string;
  loginInfoEmailFilter: string;
  identitiesEmailFilter: string;
  focusSearchSignal: number;
  identityCreateSignal: number;
  identityEditIdSignal: string;
  vaultLockSignal: number;
  onDeleteLogin: (id: string) => void;
  onReorderLogin: (sourceId: string, targetId: string) => void;
  onOpenInbox: (address: string) => Promise<void>;
  onShowToast: (message: string) => void;
  onShowConfirm: (
    message: string,
    onConfirm: () => void,
    options?: import('@/utils/ui/shared-ui.js').ConfirmDialogOptions
  ) => void;
  onToggleSplitPane: () => void;
  onWidthChange: (width: number) => void;
  onExpandSplitPane: () => void;
} = $props();

// Autofill (profiles + credentials) is a visited-occasionally page; its chunk
// includes IdentitiesView and SavedLoginsView and loads on demand.
const autofillView = loadLazyComponent(() => import('@/ui/views/autofill/AutofillView.svelte'));
</script>

{#snippet mainPane()}
  {#if autofillView.component}
    {@const AutofillViewCmp = autofillView.component}
    <AutofillViewCmp
      {context}
      splitHostRef={splitHostRef}
      {initialTab}
      {tabSignal}
      {tabSignalValue}
      {onTabChange}
      {paletteWebsiteFilter}
      {paletteWebsiteFilterSignal}
      {initialSiteDomain}
      {savedLogins}
      {identities}
      {allAddresses}
      {mailboxAddresses}
      {activeMailboxAddress}
      {loginInfoEmailFilter}
      {identitiesEmailFilter}
      {focusSearchSignal}
      createSignal={identityCreateSignal}
      editIdSignal={identityEditIdSignal}
      {vaultLockSignal}
      {layoutSplit}
      splitHostId="autofill-split-host"
      onDeleteLogin={onDeleteLogin}
      onReorderLogin={onReorderLogin}
      {onOpenInbox}
      showToast={onShowToast}
      showConfirm={onShowConfirm}
    />
  {:else}
    <ViewFallback failed={autofillView.failed} />
  {/if}
{/snippet}

{#snippet detailPane()}
  <SplitPaneEmptyState kind="identity" overlay />
{/snippet}

<SplitViewShell
  {layoutSplit}
  {layoutVerticalSplit}
  {splitModeFlash}
  {showSplitPane}
  {splitPaneCollapsed}
  {splitListWidthPx}
  detailId="autofill-split-host"
  bind:detailRef={splitHostRef}
  mainPaneRelative={false}
  main={mainPane}
  detail={detailPane}
  onToggleSplitPane={onToggleSplitPane}
  onWidthChange={onWidthChange}
  onExpandSplitPane={onExpandSplitPane}
/>
