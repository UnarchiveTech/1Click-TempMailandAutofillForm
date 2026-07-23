/**
 * Notification smartness — quiet hours, OTP/magic-only, muted senders, digest.
 */

import type { Email } from '@/utils/types.js';
import { loadNotificationIntelligence, normalizeDomain } from './storage.js';
import type { NotificationIntelligenceSettings } from './types.js';

function hourLocal(now = Date.now()): number {
  return new Date(now).getHours();
}

/** Quiet hours wrap midnight (e.g. 22→8). */
export function isInQuietHours(
  settings: NotificationIntelligenceSettings,
  now = Date.now()
): boolean {
  if (!settings.quietHoursEnabled) return false;
  const h = hourLocal(now);
  const start = settings.quietHoursStart;
  const end = settings.quietHoursEnd;
  if (start === end) return false;
  if (start < end) {
    return h >= start && h < end;
  }
  // wraps midnight
  return h >= start || h < end;
}

function senderDomain(email: Email): string {
  const from = email.from || '';
  const at = from.lastIndexOf('@');
  if (at >= 0) return normalizeDomain(from.slice(at + 1));
  return normalizeDomain(from);
}

export function isOtpOrMagic(email: Email): boolean {
  if (email.otp || email.isOtp) return true;
  if (email.hasMagicLink) return true;
  if (email.magicLinks && email.magicLinks.length > 0) return true;
  return false;
}

export function isSenderMuted(email: Email, settings: NotificationIntelligenceSettings): boolean {
  const domain = senderDomain(email);
  if (!domain) return false;
  return settings.mutedSenderDomains.some((m) => {
    const mm = normalizeDomain(m);
    return domain === mm || domain.endsWith(`.${mm}`);
  });
}

export interface NotifyDecision {
  allow: boolean;
  reason: 'ok' | 'quiet' | 'muted' | 'not_otp' | 'disabled_bucket';
  /** Messages that should produce notifications after filtering */
  emails: Email[];
  /** If groupDigest, caller may create one summary notification */
  digest: boolean;
}

/**
 * Filter new messages for OS notifications.
 */
export async function filterEmailsForNotification(
  emails: Email[],
  opts?: { forceAllow?: boolean }
): Promise<NotifyDecision> {
  const settings = await loadNotificationIntelligence();
  if (opts?.forceAllow) {
    return { allow: true, reason: 'ok', emails, digest: false };
  }

  if (isInQuietHours(settings)) {
    return { allow: false, reason: 'quiet', emails: [], digest: false };
  }

  let list = emails.filter((e) => !isSenderMuted(e, settings));
  if (list.length === 0 && emails.length > 0) {
    return { allow: false, reason: 'muted', emails: [], digest: false };
  }

  if (settings.otpAndMagicOnly) {
    list = list.filter(isOtpOrMagic);
    if (list.length === 0) {
      return { allow: false, reason: 'not_otp', emails: [], digest: false };
    }
  }

  const digest = settings.groupDigest && list.length > 1;
  return { allow: list.length > 0, reason: 'ok', emails: list, digest };
}

export async function getNotificationIntelligenceSettings(): Promise<NotificationIntelligenceSettings> {
  return loadNotificationIntelligence();
}
