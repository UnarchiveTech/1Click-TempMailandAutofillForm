<script lang="ts">
import TagDialog from '@/ui/blocks/dialogs/TagDialog.svelte';
import AddressDetailPane from '@/ui/blocks/layout/AddressDetailPane.svelte';
import AddressesListPane from '@/ui/blocks/layout/AddressesListPane.svelte';
import type { AddressListPaneProps } from '@/ui/blocks/layout/addresses-list-pane-props.js';
import SplitPaneEmptyState from '@/ui/blocks/layout/SplitPaneEmptyState.svelte';
import SplitViewShell from '@/ui/blocks/layout/SplitViewShell.svelte';
import { type ToastFn } from '@/ui/blocks/layout/use-toast.js';
import { addressTagsList } from '@/utils/address/address-tags.js';
import type { Address, CredentialsHistoryItem, Email } from '@/utils/types.js';

let {
  layoutSplit,
  layoutVerticalSplit,
  splitModeFlash,
  showSplitPane,
  splitPaneCollapsed,
  hideDetailWhileSelecting = false,
  splitListWidthPx,
  currentEmailDetail,
  emails,
  savedLogins,
  loading,
  mgmtTab,
  mgmtSearch,
  selectedAddresses,
  mgmtAddresses,
  allAddresses,
  allSelected,
  loadingAddresses,
  allStoredEmails,
  autoRenewWindowMinutes,
  addressViewTagDialogOpen,
  addressViewTagTarget,
  addressViewTagTargets,
  allExistingTags,
  allTagColors,
  allTagAddresses,
  highlightAddress,
  onBack,
  onTabChange,
  onSearchChange,
  onScrollDirection,
  onToggleSelectAll,
  onToggleSelect,
  onArchiveSelected,
  onUnarchiveSelected,
  onDeleteSelected,
  onExportSelected,
  onMarkSelectedRead,
  onMarkSelectedUnread,
  onTagSelected,
  onOpenAddressView,
  onArchiveAddress,
  onUnarchiveAddress,
  onDeleteAddresses,
  onArchiveAddresses,
  onUnarchiveAddresses,
  onRenewAddresses,
  onExportAddressEmails,
  onGenerateNewAddress,
  onEditAddress,
  onExtendAddress,
  onToggleAutoExtend,
  onTagAddress,
  onMarkAddressAllRead,
  onMarkAddressAllUnread,
  onReorderAddresses,
  onOpenMessageDetail,
  onDetailBack,
  onRefreshMessages,
  onExportEmail,
  onAddressDomainChanged,
  onNavigateToMailbox,
  onRemoveAddress,
  onToggleDetailAutoExtend,
  onExtendDetailAddress,
  onOpenDetailTagDialog,
  onOpenQrDialog,
  onOpenSavedLogins,
  onOpenSite,
  onOpenIdentities,
  showToast,
  onCloseTagDialog,
  onManageTags,
  onSaveTags,
  onToggleSplitPane,
  onWidthChange,
  onExpandSplitPane,
}: Omit<AddressListPaneProps, 'storedEmails' | 'preExpiryWindowMinutes'> & {
  layoutSplit: boolean;
  layoutVerticalSplit: boolean;
  splitModeFlash: boolean;
  showSplitPane: boolean;
  splitPaneCollapsed: boolean;
  hideDetailWhileSelecting?: boolean;
  splitListWidthPx: number;
  currentEmailDetail: Address | null;
  emails: Email[];
  savedLogins: CredentialsHistoryItem[];
  loading: boolean;
  /** Derived by this view: mapped to AddressListPaneProps.storedEmails. */
  allStoredEmails: Record<string, Email[]>;
  /** Derived by this view: mapped to AddressListPaneProps.preExpiryWindowMinutes. */
  autoRenewWindowMinutes: number;
  addressViewTagDialogOpen: boolean;
  addressViewTagTarget: Address | null;
  addressViewTagTargets: Address[];
  allExistingTags: string[];
  allTagColors: Record<string, string>;
  allTagAddresses: Record<string, string[]>;
  onOpenMessageDetail: (thread: Email[]) => void;
  onDetailBack: () => void;
  onRefreshMessages: () => void | Promise<void>;
  onExportEmail: () => void;
  onAddressDomainChanged: (address: string) => void | Promise<void>;
  onNavigateToMailbox: () => void | Promise<void>;
  onRemoveAddress: (address: string) => void | Promise<void>;
  onToggleDetailAutoExtend: (account: Address) => void | Promise<void>;
  onExtendDetailAddress: (account: Address) => void | Promise<void>;
  onOpenDetailTagDialog: () => void;
  onOpenQrDialog: (email: string) => void;
  onOpenSavedLogins: (email: string, domain?: string) => void;
  onOpenSite?: (domain: string) => void;
  onOpenIdentities: (email: string) => void;
  showToast: ToastFn;
  onCloseTagDialog: () => void;
  onManageTags: () => void;
  onSaveTags: (tags: Array<{ name: string; color: string }>) => unknown;
  onToggleSplitPane: () => void;
  onWidthChange: (width: number) => void;
  onExpandSplitPane: () => void;
} = $props();
</script>

{#snippet mainPane()}
  <AddressesListPane
    {onBack}
    {mgmtTab}
    {mgmtSearch}
    {selectedAddresses}
    {mgmtAddresses}
    {allAddresses}
    {allSelected}
    {loadingAddresses}
    storedEmails={allStoredEmails}
    preExpiryWindowMinutes={autoRenewWindowMinutes}
    {onTabChange}
    {onSearchChange}
    {onScrollDirection}
    {onToggleSelectAll}
    {onToggleSelect}
    {onArchiveSelected}
    {onUnarchiveSelected}
    {onDeleteSelected}
    {onExportSelected}
    {onMarkSelectedRead}
    {onMarkSelectedUnread}
    {onTagSelected}
    {onOpenAddressView}
    {onArchiveAddress}
    {onUnarchiveAddress}
    {onDeleteAddresses}
    {onArchiveAddresses}
    {onUnarchiveAddresses}
    {onRenewAddresses}
    {onExportAddressEmails}
    {onGenerateNewAddress}
    {onEditAddress}
    {onExtendAddress}
    {onToggleAutoExtend}
    {onTagAddress}
    {onMarkAddressAllRead}
    {onMarkAddressAllUnread}
    {onReorderAddresses}
    {highlightAddress}
  />
  {#if addressViewTagDialogOpen && (layoutSplit || layoutVerticalSplit) && addressViewTagTarget?.id !== currentEmailDetail?.id}
    <TagDialog
      open={addressViewTagDialogOpen}
      currentTag={addressViewTagTargets.length > 1 ? null : (addressViewTagTarget?.tag ?? null)}
      currentTagColor={addressViewTagTargets.length > 1 ? null : (addressViewTagTarget?.tagColor ?? null)}
      currentTags={addressViewTagTargets.length > 1 ? [] : addressTagsList(addressViewTagTarget)}
      existingTags={allExistingTags}
      tagColors={allTagColors}
      tagAddresses={allTagAddresses}
      onClose={onCloseTagDialog}
      onManageTags={onManageTags}
      onSaveTags={onSaveTags}
      portal={false}
    />
  {/if}
{/snippet}

{#snippet detailPane()}
  {#if currentEmailDetail}
    <AddressDetailPane
      mode="split"
      {currentEmailDetail}
      {emails}
      {savedLogins}
      {loading}
      onBack={onDetailBack}
      onNavigateToMailbox={onNavigateToMailbox}
      onOpenMessageDetail={onOpenMessageDetail}
      onRefreshMessages={onRefreshMessages}
      onExportEmail={onExportEmail}
      onAddressDomainChanged={onAddressDomainChanged}
      onArchiveAddress={onArchiveAddress}
      onUnarchiveAddress={onUnarchiveAddress}
      onRemoveAddress={onRemoveAddress}
      onToggleAutoExtend={onToggleDetailAutoExtend}
      onExtendAddress={onExtendDetailAddress}
      onOpenTagDialog={onOpenDetailTagDialog}
      onOpenQrDialog={onOpenQrDialog}
      onOpenSavedLogins={onOpenSavedLogins}
      {onOpenSite}
      onOpenIdentities={onOpenIdentities}
      tagUsage={allTagAddresses}
      tagColors={allTagColors}
      {showToast}
    />
    {#if addressViewTagDialogOpen && addressViewTagTarget?.id === currentEmailDetail?.id}
      <TagDialog
        open={addressViewTagDialogOpen}
        currentTag={addressViewTagTargets.length > 1 ? null : (addressViewTagTarget?.tag ?? null)}
        currentTagColor={addressViewTagTargets.length > 1 ? null : (addressViewTagTarget?.tagColor ?? null)}
        currentTags={addressViewTagTargets.length > 1 ? [] : addressTagsList(addressViewTagTarget)}
        existingTags={allExistingTags}
        tagColors={allTagColors}
      tagAddresses={allTagAddresses}
        onClose={onCloseTagDialog}
        onManageTags={onManageTags}
        onSaveTags={onSaveTags}
        portal={false}
      />
    {/if}
  {:else}
    <SplitPaneEmptyState kind="address" />
  {/if}
{/snippet}

<SplitViewShell
  {layoutSplit}
  {layoutVerticalSplit}
  {splitModeFlash}
  {showSplitPane}
  {splitPaneCollapsed}
  {hideDetailWhileSelecting}
  {splitListWidthPx}
  listMinWidth={360}
  listMaxWidth={640}
  detailMinWidth={360}
  main={mainPane}
  detail={detailPane}
  onToggleSplitPane={onToggleSplitPane}
  onWidthChange={onWidthChange}
  onExpandSplitPane={onExpandSplitPane}
/>
