<script lang="ts">
import type { AddressListPaneProps } from '@/ui/blocks/layout/addresses-list-pane-props.js';
import { loadLazyComponent } from '@/ui/blocks/layout/lazy-view.svelte.js';
import ViewFallback from '@/ui/blocks/layout/ViewFallback.svelte';

let {
  onBack,
  mgmtTab,
  mgmtSearch,
  selectedAddresses,
  mgmtAddresses,
  allAddresses,
  allSelected,
  loadingAddresses,
  storedEmails,
  preExpiryWindowMinutes,
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
  highlightAddress,
}: AddressListPaneProps = $props();

const addressesView = loadLazyComponent(() => import('@/ui/views/addresses/AddressesView.svelte'));
</script>

{#if addressesView.component}
  {@const AddressesViewCmp = addressesView.component}
  <AddressesViewCmp
    {onBack}
    {mgmtTab}
    {mgmtSearch}
    {selectedAddresses}
    {mgmtAddresses}
    {allAddresses}
    {allSelected}
    {loadingAddresses}
    {storedEmails}
    {preExpiryWindowMinutes}
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
{:else}
  <ViewFallback failed={addressesView.failed} />
{/if}
