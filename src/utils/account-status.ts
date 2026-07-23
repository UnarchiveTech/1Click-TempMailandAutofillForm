/**
 * Canonical soft-delete / archive / expired semantics for mail addresses.
 * Use these helpers everywhere toolbars, drag dialogs, and strips decide labels.
 */

import { loadProviderConfig } from '@/utils/email-service.js';
import type { Account } from '@/utils/types.js';

export type LifecycleStatus = 'active' | 'expired' | 'archived' | 'deleted';

export interface AccountLike {
  accountStatus?: string | null;
  status?: string | null;
  expiresAt?: number | null;
  autoExtend?: boolean | null;
  provider?: string | null;
}

export function isDeleted(a: AccountLike | null | undefined): boolean {
  return a?.accountStatus === 'deleted' || a?.status === 'deleted';
}

export function isArchived(a: AccountLike | null | undefined): boolean {
  if (isDeleted(a)) return false;
  return a?.accountStatus === 'archived' || a?.status === 'archived';
}

export function isTimeExpired(a: AccountLike | null | undefined, now = Date.now()): boolean {
  const exp = a?.expiresAt ?? 0;
  return exp > 0 && exp <= now;
}

/** Live = not archived/deleted and not past expiresAt */
export function isLive(a: AccountLike | null | undefined, now = Date.now()): boolean {
  if (!a || isDeleted(a) || isArchived(a)) return false;
  if (isTimeExpired(a, now)) return false;
  return true;
}

export function isExpiredNotArchived(a: AccountLike | null | undefined, now = Date.now()): boolean {
  return !isDeleted(a) && !isArchived(a) && isTimeExpired(a, now);
}

export function getLifecycleStatus(
  a: AccountLike | null | undefined,
  now = Date.now()
): LifecycleStatus {
  if (!a || isDeleted(a)) return 'deleted';
  if (isArchived(a)) return 'archived';
  if (isTimeExpired(a, now)) return 'expired';
  return 'active';
}

/** Provider supports renewal API */
export function providerSupportsRenew(providerId: string | null | undefined): boolean {
  if (!providerId) return false;
  try {
    const cfg = loadProviderConfig(providerId);
    return !!cfg.expiry?.renewable;
  } catch {
    return providerId === 'demo';
  }
}

export function canAutoRenew(a: AccountLike | null | undefined): boolean {
  if (!a || isDeleted(a) || isArchived(a)) return false;
  return providerSupportsRenew(a.provider);
}

/**
 * Toolbar archive button: show Unarchive when archived, else Archive.
 */
export function archiveToolbarMode(a: AccountLike | null | undefined): 'archive' | 'unarchive' {
  return isArchived(a) ? 'unarchive' : 'archive';
}

/**
 * Drag Live/Inactive target resolution.
 * - archived → Live: unarchive (and renew if expired+supported)
 * - expired (not archived) → Live: renew if supported else error
 * - live → Inactive: archive
 */
export type DragLifecycleAction =
  | 'unarchive'
  | 'renew'
  | 'unarchive_and_renew'
  | 'archive'
  | 'error_no_renew'
  | 'noop';

export function resolveDragLifecycleAction(
  account: AccountLike,
  targetTab: 'live' | 'inactive'
): DragLifecycleAction {
  if (isDeleted(account)) return 'noop';

  if (targetTab === 'live') {
    if (isLive(account)) return 'noop';
    if (isArchived(account) && isTimeExpired(account)) {
      return canAutoRenew(account) ? 'unarchive_and_renew' : 'unarchive';
    }
    if (isArchived(account)) return 'unarchive';
    if (isExpiredNotArchived(account)) {
      return canAutoRenew(account) ? 'renew' : 'error_no_renew';
    }
    return 'noop';
  }

  // inactive
  if (isArchived(account) || isExpiredNotArchived(account)) return 'noop';
  if (isLive(account)) return 'archive';
  return 'noop';
}

/** Display status string for list rows (same values as historical getEmailStatus). */
export function getLifecycleStatusLabel(inbox: Account | AccountLike): string {
  return getLifecycleStatus(inbox);
}
