/**
 * OTP recipient matching - shared by the Wait-for-OTP panel and the
 * multi-step watcher.
 *
 * A code addressed to a DIFFERENT inbox must never be auto-filled into a form
 * waiting on another address (two tabs waiting, or two addresses open). The
 * rules:
 *   - no expected recipient (unknown address)  → accept
 *   - no incoming recipient tag (legacy senders) → accept
 *   - otherwise → only accept an exact case-insensitive address match
 */

/** Extract the bare address from an RFC 5322 form like `"Name <a@b.c>"`. */
function bareAddress(value: string): string {
  const lt = value.indexOf('<');
  const gt = value.lastIndexOf('>');
  if (lt !== -1 && gt > lt) return value.slice(lt + 1, gt).trim();
  return value.trim();
}

export function otpRecipientMatches(
  expectedRecipient: string,
  incomingRecipient?: string | null
): boolean {
  const expected = bareAddress((expectedRecipient || '').trim()).toLowerCase();
  if (!expected) return true;
  const incoming = bareAddress((incomingRecipient || '').trim()).toLowerCase();
  if (!incoming) return true;
  return incoming === expected;
}

/** Strict binding for the cross-tab Wait-for-OTP panel. */
export function waitPanelRecipientMatches(
  expectedRecipient: string,
  incomingRecipient?: string | null
): boolean {
  if (!expectedRecipient.trim() || !incomingRecipient?.trim()) return false;
  return otpRecipientMatches(expectedRecipient, incomingRecipient);
}
