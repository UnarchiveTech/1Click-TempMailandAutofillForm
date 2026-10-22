/**
 * Multi-step signup (Canva-style): after email is entered, site may advance to
 * name → OTP without a full page reload. Keep Wait-for-OTP attached and fill
 * when OTP fields appear + latestOtp arrives.
 */

import {
  getStorageViaBg,
  loadSmartAutofillSettingsViaBg,
} from '@/utils/content/content-bg-bridge.js';
import { getCachedSitePrivacySettingsOrDisabled } from '@/utils/content/site-privacy-settings.js';
import { logDebug } from '@/utils/logger.js';
import { getOrCreateShadowRoot, protectShadowHost } from '../dom/shadow-dom.js';
import { isPlausibleOtpCode, otpFreshEnough } from './otp-code.js';
import { fillOtp, findOtpInputs } from './otp-handler.js';
import { waitPanelRecipientMatches } from './otp-recipient.js';
import { getActiveWaitOtpPanel, isVerificationPage, showWaitOtpPanel } from './wait-otp-panel.js';

let multiStepCleanup: (() => void) | null = null;
let multiStepGeneration = 0;

/**
 * Fallback cadence for the watcher's `latestOtp` storage reads. The
 * background's `fillOTP` broadcast is the PRIMARY delivery path while a wait
 * panel is mounted, and the panel reads storage once at open - so the 1.2s
 * poll never needs to read storage per tick. It reads only when OTP inputs
 * just appeared (the transition moment) or at this cadence as a fallback for
 * rare panels that failed to mount. Keeps the poll's SW wakes for step
 * DETECTION (DOM-only) while removing its per-tick storage round-trips.
 */
export const MULTI_STEP_OTP_STORAGE_POLL_MIN_GAP_MS = 10_000;

/**
 * Pure decision core for the poll's storage read gate (unit-pinned):
 * read on the no-inputs → inputs transition, or when at least
 * MULTI_STEP_OTP_STORAGE_POLL_MIN_GAP_MS has passed since the last read.
 */
export function shouldOtpStoragePoll(
  hasInputs: boolean,
  hadInputs: boolean,
  lastPollAt: number,
  now: number
): boolean {
  if (!hasInputs) return false;
  return hasInputs !== hadInputs || now - lastPollAt >= MULTI_STEP_OTP_STORAGE_POLL_MIN_GAP_MS;
}

/**
 * Start watching for OTP step after an email was filled on this page.
 * Safe to call multiple times - replaces previous watcher.
 */
export async function startMultiStepOtpWatch(opts?: { email?: string | null }): Promise<void> {
  if (!getCachedSitePrivacySettingsOrDisabled().otpDetection) return;
  multiStepCleanup?.();
  multiStepCleanup = null;
  const generation = ++multiStepGeneration;

  const email = opts?.email || null;
  let stopped = false;
  let lastFilled = '';
  // Do not mount a waiting panel merely because an email was filled. Only
  // attach it when the SPA actually transitions to a verification step or
  // exposes OTP inputs. This prevents false OTP panels on ordinary signup
  // pages that happen to be multi-step.
  const verificationWasPresentAtStart = isVerificationPage();
  let openingVerificationPanel = false;
  // Freshness anchor: only codes that arrived AFTER the watch started may be
  // auto-filled. Without this, any flow that refreshes `latestOtp` from an old
  // email (re-scan, inbox-deletion fallback) fills a stale code into the site.
  const watchStartedAt = Date.now();

  const ensureVerificationPanel = async (): Promise<void> => {
    if (
      generation !== multiStepGeneration ||
      stopped ||
      !getCachedSitePrivacySettingsOrDisabled().otpDetection
    )
      return;
    if (getActiveWaitOtpPanel()) return;
    const hasOtpInputs = findOtpInputs().length > 0;
    const enteredVerificationStep = isVerificationPage() && !verificationWasPresentAtStart;
    if (!hasOtpInputs && !enteredVerificationStep) return;
    if (openingVerificationPanel) return;
    openingVerificationPanel = true;
    try {
      const smartSettings = (await loadSmartAutofillSettingsViaBg()) as {
        smartOtpAttach?: unknown;
      } | null;
      if (
        generation !== multiStepGeneration ||
        stopped ||
        !getCachedSitePrivacySettingsOrDisabled().otpDetection ||
        smartSettings?.smartOtpAttach !== true
      )
        return;
      await showWaitOtpPanel({
        email,
        autoFill: true,
        timeoutMs: 10 * 60 * 1000,
        skipIfNotVerificationPage: true,
      });
      if (generation !== multiStepGeneration || stopped) return;
    } catch (error: unknown) {
      logDebug(`Could not open multi-step OTP panel: ${String(error)}`);
    } finally {
      openingVerificationPanel = false;
    }
  };

  // Do not show a panel on the initial email step. It will be mounted by the
  // mutation/poll path once the page becomes an actual verification step.
  await ensureVerificationPanel();
  if (generation !== multiStepGeneration) return;

  const retryTimers: Array<ReturnType<typeof setTimeout>> = [];
  let autoStopTimer: ReturnType<typeof setTimeout> | null = null;

  const tryFillFromStorage = async () => {
    if (
      stopped ||
      generation !== multiStepGeneration ||
      !getCachedSitePrivacySettingsOrDisabled().otpDetection
    )
      return;
    try {
      const { latestOtp } = (await getStorageViaBg(['latestOtp'])) as {
        latestOtp?: { otp?: string; recipient?: string; received_at?: number };
      };
      const otp = latestOtp?.otp;
      if (!otp || otp === lastFilled) return;
      // Same trust boundary as the wait panel: never fill a malformed code or
      // a code that predates this watch (stale - possibly already-consumed -
      // codes must not land in the form or re-notify the panel).
      if (!isPlausibleOtpCode(otp) || !otpFreshEnough(latestOtp?.received_at, watchStartedAt)) {
        return;
      }
      // Recipient matching: only fill a code addressed to the address we
      // filled this flow with (stale codes from other addresses are ignored).
      if (!waitPanelRecipientMatches(email || '', latestOtp?.recipient)) return;
      const inputs = findOtpInputs();
      if (inputs.length === 0) return;
      lastFilled = otp;
      await fillOtp(otp);
      if (stopped || generation !== multiStepGeneration) return;
      const panel = getActiveWaitOtpPanel();
      if (panel) {
        void panel.notifyOtp(otp, { recipient: latestOtp?.recipient || email || undefined });
      }
      logDebug('Multi-step OTP auto-filled');
    } catch (e) {
      logDebug(`Multi-step OTP fill failed: ${String(e)}`);
    }
  };

  const onMut = () => {
    if (stopped || generation !== multiStepGeneration) return;
    // When OTP fields or verification copy appears (SPA step), attach the
    // panel and try filling immediately.
    void ensureVerificationPanel();
    if (findOtpInputs().length > 0) void tryFillFromStorage();
  };

  const observer = new MutationObserver(onMut);
  try {
    observer.observe(document.body, { childList: true, subtree: true });
  } catch {
    /* ignore */
  }

  // Periodic poll for SPA that don't mutate heavily (Canva OTP step)
  let hadOtpInputs = false;
  let lastStoragePollAt = 0;
  const poll = setInterval(() => {
    if (stopped || generation !== multiStepGeneration) return;
    const found = findOtpInputs();
    const hasInputs = found.length > 0;
    if (hasInputs || (isVerificationPage() && !verificationWasPresentAtStart)) {
      // Ensure wait panel still mounted (sites may wipe shadow host)
      void (async () => {
        try {
          getOrCreateShadowRoot();
          protectShadowHost();
          await ensureVerificationPanel();
        } catch {
          /* ignore */
        }
      })();
      // Amortized storage read (see shouldOtpStoragePoll): the fillOTP
      // broadcast covers mounted panels, so the poll reads only on the
      // inputs-appeared transition or on the ≥10s fallback cadence.
      const now = Date.now();
      if (shouldOtpStoragePoll(hasInputs, hadOtpInputs, lastStoragePollAt, now)) {
        lastStoragePollAt = now;
        void tryFillFromStorage();
      }
    }
    hadOtpInputs = hasInputs;
  }, 1200);

  // Initial check + delayed retries after Continue transitions
  void tryFillFromStorage();
  retryTimers.push(setTimeout(() => void tryFillFromStorage(), 800));
  retryTimers.push(setTimeout(() => void tryFillFromStorage(), 2500));
  retryTimers.push(setTimeout(() => void tryFillFromStorage(), 6000));

  multiStepCleanup = () => {
    if (generation !== multiStepGeneration) return;
    multiStepGeneration += 1;
    stopped = true;
    observer.disconnect();
    clearInterval(poll);
    for (const timer of retryTimers) clearTimeout(timer);
    if (autoStopTimer) clearTimeout(autoStopTimer);
    if (multiStepCleanup) multiStepCleanup = null;
  };

  // Auto-stop after 20 minutes (multi-step can be slow)
  autoStopTimer = setTimeout(() => multiStepCleanup?.(), 20 * 60 * 1000);
}

export function stopMultiStepOtpWatch(): void {
  if (multiStepCleanup) {
    const cleanup = multiStepCleanup;
    multiStepCleanup = null;
    cleanup();
    return;
  }
  // Invalidate a watcher that is still awaiting its initial async setup and
  // has not installed its cleanup callback yet.
  multiStepGeneration += 1;
}
