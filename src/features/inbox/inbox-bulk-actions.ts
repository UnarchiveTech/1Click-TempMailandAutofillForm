import type { Browser } from 'wxt/browser';
import type { Account } from '@/utils/types.js';
import { canUnarchive } from './inbox-management.js';

export interface BulkActionsState {
  selectedAddresses: Set<string>;
  accounts: Account[];
  allInboxes: Account[];
}

export interface BulkActionsSetters {
  setSelectedAddresses: (addresses: Set<string>) => void;
  setShowToast: (
    message: string,
    type?: 'success' | 'error' | 'warning',
    undoAction?: (() => void) | null
  ) => void;
  loadInboxes: () => Promise<void>;
  showConfirm: (message: string, onConfirm: () => void) => void;
  closeConfirm: () => void;
}

export function toggleSelectAll(
  mgmtAccounts: Account[],
  selectedAddresses: Set<string>
): Set<string> {
  const allSelected =
    mgmtAccounts.length > 0 && mgmtAccounts.every((a) => selectedAddresses.has(a.id));
  if (allSelected) return new Set();
  return new Set(mgmtAccounts.map((a) => a.id));
}

export function toggleSelect(selectedAddresses: Set<string>, id: string): Set<string> {
  const next = new Set(selectedAddresses);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export async function archiveSelected(
  ext: Browser,
  state: BulkActionsState,
  setters: BulkActionsSetters
) {
  try {
    const count = state.selectedAddresses.size;
    const result = (await ext.storage.local.get(['inboxes'])) as { inboxes?: Account[] };
    const inboxes = result.inboxes || [];
    const archivedInboxes = inboxes.filter((i: Account) => state.selectedAddresses.has(i.id));
    const updated = inboxes.map((i) =>
      state.selectedAddresses.has(i.id) ? { ...i, accountStatus: 'archived' as const } : i
    );
    await ext.storage.local.set({ inboxes: updated });
    await setters.loadInboxes();
    setters.setSelectedAddresses(new Set());
    setters.setShowToast(`${count} email(s) archived`, 'success', async () => {
      // Undo: restore archived inboxes
      const currentResult = (await ext.storage.local.get(['inboxes'])) as { inboxes?: Account[] };
      const currentInboxes = currentResult.inboxes || [];
      const restored = currentInboxes.map((i: Account) => {
        const wasArchived = archivedInboxes.find((a) => a.id === i.id);
        return wasArchived ? { ...i, accountStatus: 'active' as const } : i;
      });
      await ext.storage.local.set({ inboxes: restored });
      await setters.loadInboxes();
      setters.setShowToast('Archive undone');
    });
  } catch (_e) {
    setters.setShowToast('Failed to archive', 'error');
  }
}

export async function unarchiveSelected(
  ext: Browser,
  state: BulkActionsState,
  setters: BulkActionsSetters
) {
  try {
    const count = state.selectedAddresses.size;
    const result = (await ext.storage.local.get(['inboxes'])) as { inboxes?: Account[] };
    const inboxes = result.inboxes || [];

    // Filter out expired burner emails that cannot be unarchived
    const canUnarchiveIds = new Set<string>();
    for (const id of state.selectedAddresses) {
      const inbox = inboxes.find((i) => i.id === id);
      if (inbox && canUnarchive(inbox)) {
        canUnarchiveIds.add(id);
      }
    }

    if (canUnarchiveIds.size === 0) {
      setters.setShowToast(
        'No emails can be unarchived (expired emails cannot be unarchived)',
        'error'
      );
      return;
    }

    if (canUnarchiveIds.size < state.selectedAddresses.size) {
      setters.setShowToast(
        `${canUnarchiveIds.size} of ${count} email(s) can be unarchived (expired emails cannot be unarchived)`,
        'warning'
      );
    }

    const updated = inboxes.map((i) =>
      canUnarchiveIds.has(i.id) ? { ...i, accountStatus: 'active' as const } : i
    );
    await ext.storage.local.set({ inboxes: updated });
    await setters.loadInboxes();
    setters.setSelectedAddresses(new Set());
    setters.setShowToast(`${canUnarchiveIds.size} email(s) unarchived`, 'success');
  } catch (_e) {
    setters.setShowToast('Failed to unarchive', 'error');
  }
}

export async function deleteSelected(
  ext: Browser,
  state: BulkActionsState,
  setters: BulkActionsSetters
) {
  setters.showConfirm(
    `Are you sure you want to delete ${state.selectedAddresses.size} inbox(es)? This cannot be undone.`,
    async () => {
      try {
        const count = state.selectedAddresses.size;
        const _deletedIds = Array.from(state.selectedAddresses);
        const result = (await ext.storage.local.get(['inboxes'])) as { inboxes?: Account[] };
        const inboxes = result.inboxes || [];
        const deletedInboxes = inboxes.filter((i: Account) => state.selectedAddresses.has(i.id));

        for (const id of state.selectedAddresses) {
          await ext.runtime.sendMessage({ type: 'deleteInbox', inboxId: id });
        }
        await setters.loadInboxes();
        setters.setShowToast(`${count} inbox(es) deleted`, 'success', async () => {
          // Undo: restore deleted inboxes
          const currentResult = (await ext.storage.local.get(['inboxes'])) as {
            inboxes?: Account[];
          };
          const currentInboxes = currentResult.inboxes || [];
          const restored = [...currentInboxes, ...deletedInboxes];
          await ext.storage.local.set({ inboxes: restored });
          await setters.loadInboxes();
          setters.setShowToast('Delete undone');
        });
        setters.setSelectedAddresses(new Set());
        setters.closeConfirm();
      } catch (_e) {
        setters.setShowToast('Failed to delete', 'error');
      }
    }
  );
}

export async function exportSelected(
  accounts: Account[],
  selectedAddresses: Set<string>,
  exportAccountEmails: (account: Account) => Promise<void>
) {
  for (const id of selectedAddresses) {
    const acct = accounts.find((a) => a.id === id);
    if (acct) await exportAccountEmails(acct);
  }
}
