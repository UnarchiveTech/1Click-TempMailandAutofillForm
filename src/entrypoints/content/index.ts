import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { detectSignupPage } from '@/features/intelligence/signup-page.js';
import type {
  SignupAttemptRef,
  SignupPageEvidence,
  SignupProgress,
} from '@/features/intelligence/signup-state.js';
import { isTrustedContentScriptMessage } from '@/utils/content/content-message-guard.js';
import { detectHumanVerification } from './autofill/challenge-detector.js';
import { hasAuthOrFormSurfaceDeep, nodeHasFormSurface } from './content-frame-gate.js';

export { getDomainName, getRootDomain } from '@/utils/security/root-domain.js';
export {
  AUTH_PROBE_DEEP_SCAN_INTERVAL,
  hasAuthOrFormSurface,
  hasAuthOrFormSurfaceDeep,
  hasAuthSurface,
  isTabRelatedToOtp,
  restoreHistoryMethods,
} from './content-frame-gate.js';

const SHADOW_SURFACE_PROBE_MS = 8_000;

export default defineContentScript({
  matches: ['<all_urls>'],
  // Keep iframe support: controls must be positioned in the document that owns
  // each form. Empty frames start only this small gate until a form appears.
  allFrames: true,
  runAt: 'document_end',
  main() {
    const isTopFrame = window.self === window.top;
    let runtimeStarted = false;
    let runtimeLoading = false;
    let runtimeFailed = false;
    let retryCount = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let surfaceCheckTimer: ReturnType<typeof setTimeout> | null = null;
    let observer: MutationObserver | null = null;
    let shadowProbeTimer: ReturnType<typeof setInterval> | null = null;
    let gateMessageListenerInstalled = false;
    let gateStopped = false;
    let reportingOutcome = false;
    let outcomeFinished = false;
    let outcomeAttempt: SignupAttemptRef | null = null;
    let unmatchedOutcomeLookups = 0;
    const reportedOutcomes = new Set<SignupProgress>();

    // The statically registered script can observe a confirmation page even
    // when scripting.executeScript lacks host permission for the full runtime.
    async function reportVisibleOutcome(evidence: SignupPageEvidence): Promise<void> {
      if (
        gateStopped ||
        outcomeFinished ||
        reportingOutcome ||
        (!evidence.failed && !evidence.accountCreated && evidence.emailVerification === 'unknown')
      )
        return;
      const progress: SignupProgress[] = evidence.failed
        ? ['failed']
        : [
            ...(evidence.accountCreated ? ['created' as const] : []),
            ...(evidence.emailVerification === 'pending' ? ['verification_pending' as const] : []),
            ...(evidence.emailVerification === 'confirmed' ? ['email_confirmed' as const] : []),
          ];
      if (
        progress.every((item) => reportedOutcomes.has(item)) ||
        (!outcomeAttempt && unmatchedOutcomeLookups >= 3)
      )
        return;
      if (outcomeAttempt && outcomeAttempt.expiresAt <= Date.now()) {
        outcomeFinished = true;
        return;
      }
      reportingOutcome = true;
      try {
        const privacy = (await browser.runtime.sendMessage({ type: 'getSitePrivacySettings' })) as
          | { success?: boolean; settings?: { formScanning?: boolean } }
          | undefined;
        if (gateStopped || !privacy?.success || privacy.settings?.formScanning !== true) return;
        if (!outcomeAttempt?.submitted) {
          const response = (await browser.runtime.sendMessage({ type: 'getSignupAttempt' })) as
            | { success?: boolean; attempt?: SignupAttemptRef }
            | undefined;
          outcomeAttempt = response?.success ? (response.attempt ?? null) : null;
          if (!outcomeAttempt) unmatchedOutcomeLookups += 1;
        }
        if (gateStopped || !outcomeAttempt?.submitted || outcomeAttempt.expiresAt <= Date.now())
          return;
        for (const item of progress) {
          if (gateStopped || reportedOutcomes.has(item)) continue;
          const response = (await browser.runtime.sendMessage({
            type: 'reportSignupProgress',
            attemptId: outcomeAttempt.id,
            progress: item,
          })) as { success?: boolean } | undefined;
          if (response?.success) {
            reportedOutcomes.add(item);
            if (item === 'email_confirmed') outcomeFinished = true;
          }
        }
      } catch (error) {
        console.error('[content] failed to report signup outcome', error);
      } finally {
        reportingOutcome = false;
      }
    }

    const handleGateMessage = (
      message: unknown,
      sender: { id?: string },
      sendResponse: (response: unknown) => void
    ): boolean => {
      if (!isTrustedContentScriptMessage(message, sender.id, browser.runtime.id)) return false;
      const runtimeMessage = message as { type?: string; gateProbe?: boolean };
      if (runtimeMessage.type !== 'checkFormDetected') return false;

      if (runtimeMessage.gateProbe === true || !runtimeStarted) {
        const formDetected = hasAuthOrFormSurfaceDeep();
        sendResponse({
          formDetected,
          verificationRequired: detectHumanVerification().detected,
          gate: true,
        });
        if (formDetected) startRuntime();
        return false;
      }
      return false;
    };

    browser.runtime.onMessage.addListener(handleGateMessage);
    gateMessageListenerInstalled = true;

    const stopGate = () => {
      gateStopped = true;
      outcomeAttempt = null;
      reportedOutcomes.clear();
      observer?.disconnect();
      observer = null;
      if (gateMessageListenerInstalled) {
        browser.runtime.onMessage.removeListener(handleGateMessage);
        gateMessageListenerInstalled = false;
      }
      if (shadowProbeTimer !== null) {
        clearInterval(shadowProbeTimer);
        shadowProbeTimer = null;
      }
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      if (surfaceCheckTimer !== null) {
        clearTimeout(surfaceCheckTimer);
        surfaceCheckTimer = null;
      }
      document.removeEventListener('focusin', handleFormFocus);
    };
    window.addEventListener('pagehide', stopGate, { once: true });

    const scheduleRetry = () => {
      if (runtimeStarted || runtimeFailed || retryTimer !== null || retryCount >= 4) return;
      const delayMs = Math.min(1_000 * 2 ** retryCount, 8_000);
      retryCount += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        startRuntime();
      }, delayMs);
    };

    const startRuntime = () => {
      if (runtimeStarted || runtimeFailed || runtimeLoading) return;
      runtimeLoading = true;
      void (async () => {
        try {
          const response = (await browser.runtime.sendMessage({
            type: 'ensureContentRuntime',
          })) as { success?: boolean } | undefined;
          if (!response?.success) {
            throw new Error('Background did not confirm content runtime injection');
          }
          runtimeStarted = true;
          stopGate();
        } catch (error: unknown) {
          if (retryCount < 4) {
            scheduleRetry();
          } else {
            runtimeFailed = true;
            stopGate();
            console.error('[content] failed to load autofill runtime', error);
          }
        } finally {
          runtimeLoading = false;
        }
      })();
    };

    // The small gate handles top-frame session cleanup. Only a frame with an
    // auth/form surface needs the full runtime; same-origin and cross-origin
    // iframe forms still start it in the frame that owns their DOM.
    if (isTopFrame) {
      void (async () => {
        try {
          const response = (await browser.runtime.sendMessage({
            type: 'clearSessionCredentials',
          })) as { success?: boolean } | undefined;
          if (!response?.success) throw new Error('Background did not clear session credentials');
        } catch (error: unknown) {
          console.error('[content] failed to clear session credentials', error);
        }
      })();
    }

    // Signup outcome evidence belongs to the top-level page. An embedded
    // third-party frame must not be able to report a false success for the
    // tab's pending signup attempt.
    if (isTopFrame) {
      const evidence = detectSignupPage();
      void reportVisibleOutcome(evidence);
    }
    if (hasAuthOrFormSurfaceDeep()) {
      startRuntime();
      return;
    }

    const root = document.documentElement;
    if (!root) {
      startRuntime();
      return;
    }

    observer = new MutationObserver((mutations) => {
      if (!mutations.some((mutation) => Array.from(mutation.addedNodes).some(nodeHasFormSurface)))
        return;
      if (surfaceCheckTimer !== null) return;
      surfaceCheckTimer = setTimeout(() => {
        surfaceCheckTimer = null;
        if (hasAuthOrFormSurfaceDeep()) startRuntime();
      }, 50);
    });
    observer.observe(root, { childList: true, subtree: true });

    // Focusing a late shadow-hosted field is user intent; do not make it wait
    // for the occasional idle-frame shadow probe.
    function handleFormFocus(): void {
      if (hasAuthOrFormSurfaceDeep()) startRuntime();
    }
    document.addEventListener('focusin', handleFormFocus);

    // MutationObserver cannot see changes inside a shadow root attached to an
    // existing host. Keep the occasional probe in the top document, where it
    // also detects SPA signup outcomes. Every child frame still has mutation
    // and focus triggers, but should not run a permanent timer in ad/analytics
    // frames just because the content script is registered with allFrames.
    if (isTopFrame) {
      shadowProbeTimer = setInterval(() => {
        const page = detectSignupPage();
        void reportVisibleOutcome(page);
        if (hasAuthOrFormSurfaceDeep()) startRuntime();
      }, SHADOW_SURFACE_PROBE_MS);
    }
  },
});
