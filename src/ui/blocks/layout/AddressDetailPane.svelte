<script lang="ts">
import { get } from 'svelte/store';
import { t } from 'svelte-i18n';
import {
  flushQueuedEmailReadState,
  queueEmailReadStates,
} from '@/features/address/address-actions.js';
import { loadLazyComponent } from '@/ui/blocks/layout/lazy-view.svelte.js';
import { type ToastFn } from '@/ui/blocks/layout/use-toast.js';
import ViewFallback from '@/ui/blocks/layout/ViewFallback.svelte';
import type { Address, CredentialsHistoryItem, Email } from '@/utils/types.js';

type DetailMode = 'split' | 'page';

let {
  mode,
  currentEmailDetail,
  emails,
  savedLogins,
  loading = false,
  onBack,
  onNavigateToMailbox,
  onOpenMessageDetail,
  onRefreshMessages,
  onExportEmail,
  onAddressDomainChanged,
  onArchiveAddress,
  onUnarchiveAddress,
  onRemoveAddress,
  onToggleAutoExtend,
  onExtendAddress,
  onOpenTagDialog,
  onOpenQrDialog,
  onOpenSavedLogins,
  onOpenSite,
  onOpenIdentities,
  showToast,
  tagUsage = {},
  tagColors = {},
}: {
  mode: DetailMode;
  currentEmailDetail: Address | null;
  emails: Email[];
  savedLogins: CredentialsHistoryItem[];
  loading?: boolean;
  onBack: () => void;
  onNavigateToMailbox: () => void | Promise<void>;
  onOpenMessageDetail: (thread: Email[]) => void;
  onRefreshMessages: () => void | Promise<void>;
  onExportEmail: () => void;
  onAddressDomainChanged: (address: string) => void | Promise<void>;
  onArchiveAddress: (account: Address) => void | Promise<void>;
  onUnarchiveAddress: (account: Address) => void | Promise<void>;
  onRemoveAddress: (address: string) => void | Promise<void>;
  onToggleAutoExtend: (account: Address) => void | Promise<void>;
  onExtendAddress: (account: Address) => void | Promise<void>;
  onOpenTagDialog: () => void;
  onOpenQrDialog: (email: string) => void;
  onOpenSavedLogins: (email: string, domain?: string) => void;
  onOpenSite?: (domain: string) => void;
  onOpenIdentities: (email: string) => void;
  showToast: ToastFn;
  /** `buildTagAddressUsage(...)` for the address list, forwarded to the chip. */
  tagUsage?: Record<string, string[]>;
  /** `buildTagColors(...)` for the address list, forwarded to the chip. */
  tagColors?: Record<string, string>;
} = $props();

async function markAll(read: boolean) {
  if (!currentEmailDetail) return;
  try {
    // Queue + flush (not a bare get→set): a queued single-read flush for an
    // overlapping open would otherwise clobber this write, or vice versa.
    queueEmailReadStates(
      emails.map((email) => ({
        emailId: email.id,
        casings: [currentEmailDetail.address, email.original_inbox],
        read,
      }))
    );
    await flushQueuedEmailReadState();
    showToast(
      get(t)(read ? 'addressView.markAllRead' : 'addressView.markAllUnread') as string,
      'success'
    );
    await onRefreshMessages();
  } catch {
    showToast(get(t)('toasts.operationFailed') as string, 'error');
  }
}

async function archiveAddress(account: Address) {
  await onArchiveAddress(account);
  if (mode === 'page') await onNavigateToMailbox();
  else onBack();
}

async function removeAddress(address: string) {
  await onRemoveAddress(address);
  if (mode === 'split') onBack();
}

const addressView = loadLazyComponent(() => import('@/ui/views/addresses/AddressView.svelte'));
</script>

{#if addressView.component}
  {@const AddressViewCmp = addressView.component}
  <AddressViewCmp
    currentEmailDetail={currentEmailDetail}
    emails={emails}
    savedLogins={savedLogins}
    loading={loading}
    showToolbarLabels={mode === 'split'}
    onBack={onBack}
    onOpenMessageDetail={onOpenMessageDetail}
    onRefreshMessages={onRefreshMessages}
    onExportEmail={onExportEmail}
    onAddressDomainChanged={onAddressDomainChanged}
    showToast={showToast}
    {tagUsage}
    {tagColors}
    onNavigateToMailbox={onNavigateToMailbox}
    onArchiveAddress={archiveAddress}
    onUnarchiveAddress={onUnarchiveAddress}
    onRemoveAddress={removeAddress}
    onToggleAutoExtend={onToggleAutoExtend}
    onExtendAddress={onExtendAddress}
    onMarkAllRead={() => void markAll(true)}
    onMarkAllUnread={() => void markAll(false)}
    onOpenTagDialog={onOpenTagDialog}
    onOpenQrDialog={onOpenQrDialog}
    onOpenSavedLogins={onOpenSavedLogins}
    {onOpenSite}
    onOpenIdentities={onOpenIdentities}
  />
{:else}
  <ViewFallback failed={addressView.failed} />
{/if}
