/**
 * Star keys are scoped per mailbox so the same provider message id
 * (common when two addresses share a session / id space) does not share star state.
 *
 * Format: `{addressLower}_{emailId}`
 * Legacy bare ids (no `_` with `@` before) are still honored as a fallback when reading.
 */

import type { Email } from '@/utils/types.js';

export function emailStarKey(emailId: string, mailboxAddress?: string | null): string {
  const id = String(emailId || '').trim();
  if (!id) return '';
  const addr = (mailboxAddress || '').trim().toLowerCase();
  if (!addr) return id;
  return `${addr}_${id}`;
}

export function starKeyForEmail(email: Email, mailboxAddress?: string | null): string {
  const addr = email.original_inbox || mailboxAddress || '';
  return emailStarKey(email.id, addr);
}

/** True if this email is starred in the given mailbox (supports legacy bare ids). */
export function isEmailStarred(
  starred: Set<string> | Iterable<string>,
  emailId: string,
  mailboxAddress?: string | null
): boolean {
  const set = starred instanceof Set ? starred : new Set(starred);
  const composite = emailStarKey(emailId, mailboxAddress);
  if (composite && set.has(composite)) return true;
  // Legacy: bare id only matches when no mailbox context, or as last-resort fallback
  // only if no composite keys exist for this id under any address would be ideal -
  // we keep bare-id match only when mailbox is empty to avoid cross-inbox bleed.
  if (!mailboxAddress) return set.has(emailId);
  return false;
}

export function toggleStarInSet(
  starred: Iterable<string>,
  emailId: string,
  mailboxAddress?: string | null
): Set<string> {
  const set = new Set(starred);
  const key = emailStarKey(emailId, mailboxAddress);
  if (!key) return set;
  // Remove legacy bare id so star no longer bleeds across inboxes
  set.delete(emailId);
  if (set.has(key)) set.delete(key);
  else set.add(key);
  return set;
}
