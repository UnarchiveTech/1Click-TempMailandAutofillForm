/**
 * Promotional / Marketing Email Detection and 24h Auto-Purge Utilities.
 *
 * Detects promotional/marketing emails based on subject keywords, sender indicators,
 * and unsubscribe headers while strictly protecting OTP and transactional verification codes.
 */
import { browser } from 'wxt/browser';
import { log } from '@/utils/logger.js';
import { withLock } from '@/utils/mutex.js';
import {
  getEmailMaps,
  getStoredEmailsMap,
  setLogicalEmailMapsUnlockedForLockedCaller,
} from '@/utils/storage/storage-keys.js';
import type { Email } from '@/utils/types.js';

const PROMO_KEYWORDS = [
  'discount',
  'promo',
  'special offer',
  'exclusive offer',
  'sale',
  'off your',
  'coupon',
  'voucher',
  'black friday',
  'cyber monday',
  'weekend deal',
  'limited time',
  'newsletter',
  'weekly update',
  'monthly update',
  'digest',
  'free trial',
  'save up to',
  '% off',
];

const PROMO_BODY_SIGNALS = [
  'unsubscribe',
  'opt out',
  'opt-out',
  'list-unsubscribe',
  'view in browser',
  'email preferences',
  'manage your preferences',
  'marketing communications',
  'special offer',
  'promo code',
  'coupon code',
  'discount code',
];

const OTP_SECURITY_SUBJECTS = [
  'verification code',
  'verify your',
  'verification token',
  'security code',
  'login code',
  'password reset',
  'reset your password',
  'confirm your',
  'one-time password',
  'otp',
  '2fa',
  'mfa',
  'auth code',
  'passcode',
  'magic link',
];

export function isPromotionalEmail(email: Email): boolean {
  if (!email) return false;

  // Never classify emails with OTP or auth codes as promotional
  if (email.otp && typeof email.otp === 'string' && email.otp.trim().length > 0) {
    return false;
  }

  const subject = (email.subject || '').toLowerCase();
  const body = (email.body || email.body_plain || email.body_html || '').toLowerCase();
  const sender = (email.from || email.from_name || '').toLowerCase();

  // Protect transactional & security emails
  for (const s of OTP_SECURITY_SUBJECTS) {
    if (subject.includes(s)) return false;
  }

  // Check subject keywords
  for (const kw of PROMO_KEYWORDS) {
    if (subject.includes(kw)) return true;
  }

  // Check sender keywords (e.g. newsletter@, marketing@, promo@, offers@, deals@)
  if (
    /^(newsletter|marketing|promo|promotions|offers|deals|news|updates|digest)@/i.test(sender) ||
    /@(marketing|promo|newsletters|news|updates|mailings)\./i.test(sender)
  ) {
    return true;
  }

  // Check body signals: require MULTIPLE marketing signals. A lone
  // unsubscribe / preferences footer is mandated by CAN-SPAM/GDPR in nearly
  // every automated email (order confirmations, GitHub PR notifications,
  // Stripe invoices, Jira updates, AWS alerts), so a single such signal would
  // misclassify critical transactional mail as promotional and - with
  // autoDeletePromo24h enabled - permanently purge it after 24 hours.
  let bodyMatches = 0;
  for (const sig of PROMO_BODY_SIGNALS) {
    if (body.includes(sig)) {
      bodyMatches++;
    }
  }

  return bodyMatches >= 2;
}

export function isEmailOlderThan24Hours(
  email: Email | null | undefined,
  now: number = Date.now()
): boolean {
  if (!email) return false;
  let timestamp = 0;
  if (typeof email.received_at === 'number') {
    timestamp = email.received_at > 1e11 ? email.received_at : email.received_at * 1000;
  } else if (typeof email.stored_at === 'number') {
    timestamp = email.stored_at;
  }

  if (!timestamp || Number.isNaN(timestamp)) return false;
  return now - timestamp > 24 * 60 * 60 * 1000;
}

/**
 * Sweeps stored emails across all active addresses and deletes promotional emails older than 24h
 * if the `autoDeletePromo24h` automation rule is enabled.
 */
export async function purgePromotionalEmailsOlderThan24Hours(
  browserExt: typeof browser = browser,
  now: number = Date.now()
): Promise<number> {
  try {
    const res = (await browserExt.storage.local.get(['automationRules'])) as {
      automationRules?: { autoDeletePromo24h?: boolean };
    };
    if (!res.automationRules?.autoDeletePromo24h) {
      return 0;
    }

    let purgedCount = 0;

    await withLock('emails_storage_lock', async () => {
      // All 3.0 runtime paths use the stable address-ID storage adapter.
      const storedEmails = await getStoredEmailsMap();

      let modified = false;
      for (const [address, emails] of Object.entries(storedEmails)) {
        if (!Array.isArray(emails)) continue;
        const remaining = emails.filter((email) => {
          const isOld = isEmailOlderThan24Hours(email, now);
          if (isOld && isPromotionalEmail(email)) {
            purgedCount++;
            return false;
          }
          return true;
        });

        if (remaining.length !== emails.length) {
          storedEmails[address] = remaining;
          modified = true;
        }
      }

      if (modified) {
        const { archivedEmails } = await getEmailMaps();
        await setLogicalEmailMapsUnlockedForLockedCaller(storedEmails, archivedEmails);
        log(`Auto-deleted ${purgedCount} promotional emails older than 24h`);
      }
    });

    return purgedCount;
  } catch {
    /* non-blocking background sweep error */
    return 0;
  }
}
