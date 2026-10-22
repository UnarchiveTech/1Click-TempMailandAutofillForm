/**
 * "Copy latest OTP" keyboard shortcut (Alt+Shift+O).
 *
 * Reads the authoritative `latestOtp` cache that the email-storage writers
 * maintain in storage.local (see setStoredEmailsForAddressUnlocked's M5 step -
 * `{ otp, sender, senderName, context, received_at, recipient }`).
 * Untimestamped legacy session values are not used: their freshness cannot
 * be verified, and no internal writer maintains that key.
 *
 * The OTP never appears in a desktop notification (shoulder-surfing): on
 * success the open extension UI shows the `otpCopied` toast, and only when no
 * extension page is listening does the background fall back to a value-free
 * copied/failed notification so the shortcut is never silent.
 */

import { browser } from 'wxt/browser';
import { copyToClipboardFromBackground } from '@/utils/clipboard/clipboard.js';
import { tSync } from '@/utils/i18n/i18n-background.js';
import { logDebug, logError } from '@/utils/logger.js';
import { createBrowserNotification } from '@/utils/notifications/notification-permission.js';
import { playNotificationSoundIfEnabled } from '@/utils/notifications/notification-sound.js';
import { isOtpCacheFresh, type OtpCacheRecord } from '@/utils/otp/otp-cache.js';

/** Authoritative cache shape written by the email-storage M5 step. */
type LatestOtpRecord = OtpCacheRecord;

/**
 * Resolve the code the shortcut should copy, or '' when nothing is cached.
 * Only the timestamped `latestOtp` cache can establish freshness.
 */
export async function resolveLatestOtpForCopy(): Promise<string> {
  try {
    const {
      latestOtp,
      addresses = [],
      activeAddressId,
    } = (await browser.storage.local.get(['latestOtp', 'addresses', 'activeAddressId'])) as {
      latestOtp?: LatestOtpRecord;
      addresses?: Array<{ id?: string; address?: string }>;
      activeAddressId?: string;
    };
    if (latestOtp?.otp) {
      // Staleness guard (shared with the WebMCP OTP tools, see otp-cache.ts):
      // received_at bounds the code's age; a missing timestamp also fails
      // closed. This age check does not establish whether its message exists.
      if (!isOtpCacheFresh(latestOtp)) {
        logDebug('latestOtp cache is stale - refusing to copy, clearing key');
        try {
          await browser.storage.local.remove('latestOtp');
        } catch {
          /* self-heal is best-effort */
        }
      } else {
        const activeAddress = addresses.find((address) => address.id === activeAddressId)?.address;
        if (
          activeAddress &&
          (latestOtp.recipient || '').trim().toLowerCase() !== activeAddress.trim().toLowerCase()
        ) {
          logDebug('latestOtp recipient does not match the active inbox - refusing to copy');
          return '';
        }
        return latestOtp.otp;
      }
    }
  } catch (error) {
    logError('Failed to read latest OTP cache', error);
  }
  return '';
}

/** Handle the `copy-latest-otp` browser command. Never rejects. */
export async function handleCopyLatestOtpCommand(): Promise<void> {
  try {
    const otp = await resolveLatestOtpForCopy();
    if (!otp) return; // nothing cached - stay silent, there is nothing to copy

    const ok = await copyToClipboardFromBackground(otp);
    // Audible alert for a successful copy - same custom sound as new-email
    // notifications, gated by the soundEnabled toggle.
    if (ok) void playNotificationSoundIfEnabled();
    try {
      await browser.runtime.sendMessage({ type: 'otpCopied', ok });
    } catch {
      // No extension page open - fall back to a value-free desktop
      // notification so the shortcut is never silent. Stable id: repeat
      // presses replace the one card instead of stacking a new one per press.
      createBrowserNotification('otp_copy', {
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: ok
          ? tSync('notifications.otpCopiedTitle')
          : tSync('notifications.otpCopyFailedTitle'),
        message: ok
          ? tSync('notifications.otpCopiedMessage')
          : tSync('notifications.otpCopyFailedMessage'),
      });
    }
  } catch (error) {
    logError('Failed copy latest OTP shortcut', error);
  }
}
