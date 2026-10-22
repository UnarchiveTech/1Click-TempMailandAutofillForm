import type { ToastFn } from '@/ui/blocks/layout/use-toast.js';
import { t } from '@/utils/i18n/i18n-utils.js';
import { logWarn } from '@/utils/logger.js';
import type { Address } from '@/utils/types.js';

export interface AddressTagState {
  addressViewTagDialogOpen: boolean;
  addressViewTagTarget: Address | null;
  addressViewTagTargets: Address[];
}

export interface AddressTagsDeps {
  ext: Browser;
  /** Live accessors for AppLayout-owned reactive state. */
  get: {
    allAddresses: () => Address[];
    selectedAddresses: () => Set<string>;
    currentEmailDetail: () => Address | null;
    tagTarget: () => Address | null;
    tagTargets: () => Address[];
  };
  /** Writers that push updated state back into AppLayout. */
  set: {
    tagDialogOpen: (value: boolean) => void;
    tagTarget: (value: Address | null) => void;
    tagTargets: (value: Address[]) => void;
    currentEmailDetail: (value: Address | null) => void;
  };
  loadAddresses: (skipEmailSelection?: boolean) => Promise<void>;
  logDebug: (message: string, ...args: unknown[]) => void;
  /** Optional error surface for rejected tag saves (TagDialog keeps its dialog
   * open when `saveAddressViewTags` reports failure via its return value). */
  showToast?: ToastFn;
}

export function createAddressTagsController(deps: AddressTagsDeps) {
  const { ext, get, set, loadAddresses } = deps;

  function openAddressViewTagDialog(account: Address) {
    // Multi-select: if this account is among a selection of 2+, tag the whole selection
    const selected = get.selectedAddresses();
    let targets: Address[];
    if (selected.size > 1 && selected.has(account.id)) {
      targets = get.allAddresses().filter((a) => selected.has(a.id));
    } else {
      targets = [account];
    }
    set.tagTargets(targets);
    set.tagTarget(targets[0] ?? account);
    set.tagDialogOpen(true);
  }

  function openAddressViewTagDialogForSelected() {
    const selected = get.allAddresses().filter((a) => get.selectedAddresses().has(a.id));
    if (selected.length === 0) return;
    set.tagTargets(selected);
    set.tagTarget(selected[0] ?? null);
    set.tagDialogOpen(true);
  }

  function closeAddressViewTagDialog() {
    set.tagDialogOpen(false);
    set.tagTarget(null);
    set.tagTargets([]);
  } /**
   * Save the FULL multi-tag list on EVERY target. Returns true when the tags
   * were persisted on every target; false when any target was rejected
   * (stale/deleted addressId) or a transport error occurred. TagDialog uses
   * this to keep the dialog open on failure.
   */
  async function saveAddressViewTags(
    tags: Array<{ name: string; color: string }>
  ): Promise<boolean> {
    const batch = get.tagTargets();
    const single = get.tagTarget();
    const targets = batch.length > 0 ? batch : single ? [single] : [];
    if (targets.length === 0) return true;
    try {
      // One batched round-trip: the background applies the full tag list to
      // every target in a single locked pass (one address-list read + write
      // instead of N full-list read-modify-writes).
      const result = (await ext.runtime.sendMessage({
        type: 'updateAddressesTag',
        addressIds: targets.map((acc) => acc.id),
        tag: tags[0]?.name || '',
        color: tags[0]?.color,
        tags,
      } as never)) as { success?: boolean; missing?: string[] } | undefined;
      if (!result?.success) {
        // success:false (e.g. stale addressId deleted in another window) - do
        // NOT reload or fake-apply the tags locally. Surface the rejection and
        // keep the dialog open so the user knows the tags were not applied.
        logWarn('updateAddressesTag rejected by background', {
          targets: targets.map((target) => target.id),
          missing: result?.missing,
        });
        deps.showToast?.(await t('toasts.tagSaveFailed'), 'error');
        return false;
      }
      await loadAddresses(true);
      // Re-read the detail from the reloaded list rather than splicing the new tags
      // in: a save writes the tag's color to EVERY address carrying it, so this
      // address's own colors can change even when it was not among the targets.
      // The splice stays the fallback for a detail the reloaded list does not carry
      // (an archived or filtered-out address).
      const current = get.currentEmailDetail();
      if (current) {
        const refreshed = get.allAddresses().find((account) => account.id === current.id);
        const first = tags[0];
        set.currentEmailDetail(
          refreshed ?? { ...current, tags, tag: first?.name, tagColor: first?.color }
        );
      }
      return true;
    } catch (e) {
      deps.logDebug('Failed to update inbox tags', e);
      deps.showToast?.(await t('toasts.tagSaveFailed'), 'error');
      return false;
    }
  }

  return {
    openAddressViewTagDialog,
    openAddressViewTagDialogForSelected,
    closeAddressViewTagDialog,
    saveAddressViewTags,
  };
}
