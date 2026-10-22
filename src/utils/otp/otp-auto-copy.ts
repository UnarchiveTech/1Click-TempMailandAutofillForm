/**
 * Per-site OTP auto-copy - shared decision + orchestration.
 *
 * The feature: when a NEW OTP email arrives whose sender domain is on the
 * user's `otpAutoCopyList`, copy the code to the clipboard immediately and
 * confirm with a VALUE-FREE toast / notification (the code itself must never
 * appear in a notification - shoulder-surfing).
 *
 * Used by the real delivery path (`processNewMessages` in email-storage.ts)
 * and by demo-mode delivery (`simulateDemoReceive`), so the behavior is
 * identical offline and online. Side effects are injected (`copy`, `notify`)
 * to keep this module bundle-neutral - the UI and background wire in their
 * own clipboard + notification implementations.
 */

import { browser } from 'wxt/browser';

/** Extract the domain from an email address ("GitHub <noreply@github.com>"). */
export function senderDomainOf(sender: string): string {
  const match = String(sender || '').match(/@([^>\s]+)/);
  if (!match) return '';
  return match[1].toLowerCase().replace(/^www\./, '');
}

/** Case-insensitive membership check against the normalized auto-copy list. */
export function isDomainAutoCopyListed(list: string[] | undefined, domain: string): boolean {
  if (!domain) return false;
  return (list || []).some(
    (d) => typeof d === 'string' && d.toLowerCase() === domain.toLowerCase()
  );
}

export interface OtpAutoCopyInput {
  otp: string;
  sender: string;
  /** Perform the clipboard write (e.g. background-capable copy + purge). */
  copy: (text: string) => Promise<boolean>;
  /** Confirm the outcome to the user - value-free, never the code itself. */
  notify: (ok: boolean) => void;
}

/**
 * If `sender`'s domain is in `otpAutoCopyList`, copy `otp` and notify.
 * Returns whether the auto-copy fired. Never throws.
 */
export async function maybeAutoCopyOtp(input: OtpAutoCopyInput): Promise<boolean> {
  try {
    const { otpAutoCopyList } = (await browser.storage.local.get('otpAutoCopyList')) as {
      otpAutoCopyList?: string[];
    };
    const senderDomain = senderDomainOf(input.sender);
    if (!isDomainAutoCopyListed(otpAutoCopyList, senderDomain)) return false;
    const ok = await input.copy(input.otp);
    input.notify(ok);
    return true;
  } catch {
    /* storage / clipboard failures must never break delivery */
    return false;
  }
}
