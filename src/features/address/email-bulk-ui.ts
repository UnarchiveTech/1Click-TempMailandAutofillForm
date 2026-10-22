// Static import (not `await import()`): address-actions is already statically
// imported by address-creator / use-address-actions / AppLayout / AddressView,
// so a dynamic import here cannot defer loading - it only emits an
// INEFFECTIVE_DYNAMIC_IMPORT build warning.
import { applyEmailLocalAction } from '@/features/address/address-actions.js';
import type { ToastFn } from '@/ui/blocks/layout/use-toast.js';
import { pluralKey } from '@/utils/i18n/i18n-plural.js';
import type { TranslateFn } from '@/utils/i18n/i18n-utils.js';
import type { Email } from '@/utils/types.js';

function emailActionKey(email: Email): string {
  const address = email.original_inbox || (email as Email & { address?: string }).address || '';
  return `${address.toLowerCase()}\u0000${email.id}`;
}

function countedEmailToast(
  deps: EmailBulkDeps,
  key: 'toasts.emailsArchived' | 'toasts.emailsDeleted' | 'toasts.emailsRestored',
  count: number
): string {
  switch (key) {
    case 'toasts.emailsArchived':
      return deps.getTranslation(
        pluralKey(
          { oneKey: 'toasts.emailsArchived', otherKey: 'toasts.emailsArchivedPlural' },
          count
        ),
        { count }
      );
    case 'toasts.emailsDeleted':
      return deps.getTranslation(
        pluralKey(
          { oneKey: 'toasts.emailsDeleted', otherKey: 'toasts.emailsDeletedPlural' },
          count
        ),
        { count }
      );
    case 'toasts.emailsRestored':
      return deps.getTranslation(
        pluralKey(
          { oneKey: 'toasts.emailsRestored', otherKey: 'toasts.emailsRestoredPlural' },
          count
        ),
        { count }
      );
  }
}

function unavailableEmailsToast(deps: EmailBulkDeps, count: number): string {
  return deps.getTranslation(
    pluralKey(
      {
        oneKey: 'toasts.emailsNoLongerAvailable',
        otherKey: 'toasts.emailsNoLongerAvailablePlural',
      },
      count
    ),
    { count }
  );
}

export interface EmailBulkDeps {
  ext: Browser;
  /** Current email list - mutated in place by callers */
  getEmails: () => Email[];
  setEmails: (v: Email[]) => void;
  showToast: ToastFn;
  getTranslation: TranslateFn;
  reloadAddresses: (skip?: boolean) => Promise<void>;
  refreshUnreadCounts: () => Promise<boolean>;
  /** Notify readers of the exact messages that left the live mailbox. */
  onEmailsRemoved?: (messages: Email[]) => void;
}

async function _applyLocalAction(
  deps: EmailBulkDeps,
  emails: Email[],
  action: 'archive' | 'delete' | 'restore',
  toastKey: 'toasts.emailsArchived' | 'toasts.emailsDeleted' | 'toasts.emailsRestored',
  _undoLabel: string,
  fieldName: 'local_archived' | 'local_deleted',
  _negativeFields?: string[]
): Promise<void> {
  if (emails.length === 0) return;
  const { updated, notFound, updatedKeys } = await applyEmailLocalAction(deps.ext, emails, action);
  if (updated <= 0) {
    // Every selected email vanished between render and click (retention
    // cleanup / bag eviction) - surface it instead of silently doing nothing.
    if (notFound > 0) {
      deps.showToast(unavailableEmailsToast(deps, notFound), 'error');
    }
    return;
  }

  const updatedKeySet = new Set(updatedKeys);
  const now = Date.now();
  const currentEmails = deps.getEmails();

  if (action === 'restore') {
    deps.setEmails(
      currentEmails.map((e) =>
        updatedKeySet.has(emailActionKey(e))
          ? {
              ...e,
              local_archived: false,
              local_deleted: false,
              local_archived_at: undefined,
              local_deleted_at: undefined,
            }
          : e
      )
    );
    deps.showToast(countedEmailToast(deps, toastKey, updated), 'success');
  } else {
    deps.setEmails(
      currentEmails.map((e) =>
        updatedKeySet.has(emailActionKey(e))
          ? { ...e, [fieldName]: true, [`${fieldName}_at`]: now }
          : e
      )
    );
    deps.onEmailsRemoved?.(emails.filter((email) => updatedKeySet.has(emailActionKey(email))));
    deps.showToast(
      countedEmailToast(deps, toastKey, updated),
      action === 'archive' ? 'archived' : 'deleted',
      () => {
        void (async () => {
          try {
            const restored = await applyEmailLocalAction(deps.ext, emails, 'restore');
            const restoredKeys = new Set(restored.updatedKeys);
            if (restoredKeys.size > 0) {
              deps.setEmails(
                deps.getEmails().map((e) =>
                  restoredKeys.has(emailActionKey(e))
                    ? {
                        ...e,
                        local_archived: false,
                        local_deleted: false,
                        local_archived_at: undefined,
                        local_deleted_at: undefined,
                      }
                    : e
                )
              );
              await deps.reloadAddresses(true);
              await deps.refreshUnreadCounts();
            }
            if (restored.notFound > 0) {
              deps.showToast(unavailableEmailsToast(deps, restored.notFound), 'warning');
            }
          } catch {
            deps.showToast(unavailableEmailsToast(deps, emails.length), 'error');
          }
        })();
      }
    );
  }
  if (notFound > 0) {
    deps.showToast(unavailableEmailsToast(deps, notFound), 'warning');
  }
  await deps.reloadAddresses(true);
  await deps.refreshUnreadCounts();
}

export function archiveSelectedEmails(deps: EmailBulkDeps, emails: Email[]): Promise<void> {
  return _applyLocalAction(
    deps,
    emails,
    'archive',
    'toasts.emailsArchived',
    'archived',
    'local_archived'
  );
}

export function deleteSelectedEmails(deps: EmailBulkDeps, emails: Email[]): Promise<void> {
  return _applyLocalAction(
    deps,
    emails,
    'delete',
    'toasts.emailsDeleted',
    'deleted',
    'local_deleted'
  );
}

export function restoreSelectedEmails(deps: EmailBulkDeps, emails: Email[]): Promise<void> {
  return _applyLocalAction(
    deps,
    emails,
    'restore',
    'toasts.emailsRestored',
    'success',
    'local_archived'
  );
}
