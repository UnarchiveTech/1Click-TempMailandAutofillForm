import type { Email } from '@/utils/types.js';

/** Scope per-message labels to the inbox because provider message IDs can collide. */
export function emailLabelKey(emailId: string, mailboxAddress?: string | null): string {
  const id = String(emailId || '').trim();
  if (!id) return '';
  const address = (mailboxAddress || '').trim().toLowerCase();
  return address ? `${address}_${id}` : id;
}

export function emailLabelKeyForEmail(email: Email, fallbackAddress?: string | null): string {
  return emailLabelKey(email.id, email.original_inbox || fallbackAddress);
}

export function isScopedEmailLabelKey(key: string): boolean {
  const at = key.indexOf('@');
  return at > 0 && key.indexOf('_', at) > at;
}

/**
 * Move legacy bare-ID label entries into mailbox-scoped keys. When old IDs
 * collide, copy the visible legacy labels to each matching message so users
 * keep their existing labels while future edits remain isolated per inbox.
 */
export function migrateLegacyEmailLabelKeys(
  labels: Record<string, string[]>,
  emailMaps: { storedEmails: Record<string, Email[]>; archivedEmails: Record<string, Email[]> }
): Record<string, string[]> {
  const next = { ...labels };
  let changed = false;
  const addressesById = new Map<string, Set<string>>();
  const compoundKeys = new Set<string>();

  for (const map of [emailMaps.storedEmails, emailMaps.archivedEmails]) {
    for (const [fallbackAddress, emails] of Object.entries(map)) {
      for (const email of emails || []) {
        const address = email.original_inbox || fallbackAddress;
        const key = emailLabelKey(email.id, address);
        if (!key) continue;
        compoundKeys.add(key);
        const addresses = addressesById.get(email.id) || new Set<string>();
        addresses.add(address.trim().toLowerCase());
        addressesById.set(email.id, addresses);
      }
    }
  }

  for (const [legacyId, values] of Object.entries(labels)) {
    if (isScopedEmailLabelKey(legacyId) || compoundKeys.has(legacyId)) continue;
    const addresses = addressesById.get(legacyId);
    if (addresses) {
      for (const address of addresses) {
        const key = emailLabelKey(legacyId, address);
        next[key] = [...new Set([...(next[key] || []), ...values])];
      }
    }
    // Unmatched bare IDs refer to deleted mail; scoped keys are retained.
    delete next[legacyId];
    changed = true;
  }

  return changed ? next : labels;
}
