import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { getErrorMessage } from '@/utils/errors.js';
import { logError } from '@/utils/logger.js';
import { isDomainBlocked } from '@/utils/storage-keys.js';
import { injectAutoFillButtons, removeInjectedButtons } from './autofill/autofill-buttons.js';
import { findSignupForm } from './autofill/form-detector.js';
import { fillSignupForm } from './autofill/form-filler.js';
import { attachDisposableHint } from './disposable/disposable-detector.js';
import { fillOtp } from './otp/otp-handler.js';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_end',
  main() {
    browser.runtime
      .sendMessage({ type: 'clearSessionCredentials' })
      .catch((e: Error) => logError('Could not send clear session message', e));

    const autoFillButtonsInjected = { value: false };
    const injectedButtons: HTMLElement[] = [];
    const updatePositionListeners: Array<() => void> = [];
    const disposableTrackers = new Set<{ cleanup: () => void }>();
    let initialScanTimer: ReturnType<typeof setTimeout> | null = null;
    let rescanTimer: ReturnType<typeof setTimeout> | null = null;
    let currentUrl = window.location.href;

    async function updateAndCopyCredentials(
      credentialsToUpdate: Record<string, string>
    ): Promise<void> {
      try {
        await browser.runtime.sendMessage({
          type: 'updateSessionCredentials',
          credentials: credentialsToUpdate,
        });
      } catch (error: unknown) {
        logError('Error sending update credentials message', error);
      }
    }

    async function scanForFormsAndInjectButtons(): Promise<void> {
      try {
        // Check if current domain is blocked from autofill
        const currentDomain = window.location.hostname;
        if (await isDomainBlocked(currentDomain)) {
          return;
        }

        const form = await findSignupForm();
        if (form) {
          await injectAutoFillButtons(
            form,
            injectedButtons,
            updatePositionListeners,
            autoFillButtonsInjected,
            updateAndCopyCredentials
          );
        }
      } catch (error: unknown) {
        logError('Error scanning for forms', error);
      }
    }

    function scheduleScan(delay = 0): void {
      if (rescanTimer) clearTimeout(rescanTimer);
      rescanTimer = setTimeout(() => {
        rescanTimer = null;
        void scanForFormsAndInjectButtons();
      }, delay);
    }

    function clearInjectedUi(): void {
      removeInjectedButtons(injectedButtons, updatePositionListeners);
      autoFillButtonsInjected.value = false;
      disposableTrackers.forEach((t) => {
        try {
          t.cleanup();
        } catch (error: unknown) {
          logError('Failed to clean up disposable tracker', error);
        }
      });
      disposableTrackers.clear();
    }

    function scanForDisposableHints(): void {
      const emailFields = document.querySelectorAll<HTMLInputElement>(
        'input[type="email"], input[name*="email" i], input[id*="email" i], input[autocomplete="email"]'
      );
      emailFields.forEach((field: HTMLInputElement) => {
        const tracker = attachDisposableHint(field, updatePositionListeners);
        if (tracker) disposableTrackers.add(tracker);
      });
    }

    function handlePageLoad(): void {
      scheduleScan(0);
    }

    function handleSpaNavigation(): void {
      if (window.location.href === currentUrl) return;
      currentUrl = window.location.href;
      clearInjectedUi();
      scheduleScan(0);
    }

    const originalPushState = history.pushState.bind(history);
    const originalReplaceState = history.replaceState.bind(history);
    history.pushState = (...args) => {
      originalPushState(...args);
      handleSpaNavigation();
    };
    history.replaceState = (...args) => {
      originalReplaceState(...args);
      handleSpaNavigation();
    };

    window.addEventListener('load', handlePageLoad);
    window.addEventListener('popstate', handleSpaNavigation);
    scheduleScan(0);
    scanForDisposableHints();
    initialScanTimer = setTimeout(() => {
      initialScanTimer = null;
      scheduleScan(0);
      scanForDisposableHints();
    }, 1000);

    const observer = new MutationObserver((mutations: MutationRecord[]) => {
      const mightHaveAddedForm = mutations.some(
        (mutation: MutationRecord) =>
          mutation.addedNodes.length > 0 &&
          Array.from(mutation.addedNodes).some(
            (node: Node) =>
              node.nodeName === 'FORM' ||
              (node.nodeType === 1 && (node as Element).querySelector('form, input[type="email"]'))
          )
      );
      if (mightHaveAddedForm && !autoFillButtonsInjected.value) {
        scheduleScan(100);
      }
    });

    const disposableObserver = new MutationObserver(() => {
      scanForDisposableHints();
    });
    disposableObserver.observe(document.body, { childList: true, subtree: true });

    observer.observe(document.body, { childList: true, subtree: true });

    function teardown(): void {
      if (initialScanTimer) clearTimeout(initialScanTimer);
      if (rescanTimer) clearTimeout(rescanTimer);
      observer.disconnect();
      disposableObserver.disconnect();
      clearInjectedUi();
      window.removeEventListener('load', handlePageLoad);
      window.removeEventListener('popstate', handleSpaNavigation);
      window.removeEventListener('pagehide', teardown);
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;
    }

    window.addEventListener('pagehide', teardown);

    browser.runtime.onMessage.addListener(
      (message: unknown, _sender: unknown, sendResponse: (r: unknown) => void) => {
        if (typeof message !== 'object' || message === null) return false;
        const runtimeMessage = message as Record<string, unknown>;
        if (runtimeMessage.action === 'startSignup') {
          (async () => {
            try {
              // Check if current domain is blocked from autofill
              const currentDomain = window.location.hostname;
              if (await isDomainBlocked(currentDomain)) {
                browser.runtime.sendMessage({
                  status: 'Autofill is disabled for this website',
                  isError: true,
                });
                return;
              }

              const form = await findSignupForm();
              if (!form) {
                browser.runtime.sendMessage({
                  status: 'No signup form found on this page',
                  isError: true,
                });
                return;
              }

              // Load selected identity from storage
              const { identities = [], selectedIdentityId } = (await browser.storage.local.get([
                'identities',
                'selectedIdentityId',
              ])) as {
                identities?: Array<{
                  id: string;
                  firstNames: string;
                  lastNames: string;
                  useRandomPassword: boolean;
                  customPassword?: string;
                  phone?: string;
                  pin?: string;
                }>;
                selectedIdentityId?: string;
              };

              const selectedIdentity = identities.find((i) => i.id === selectedIdentityId);

              const success = await fillSignupForm(
                form,
                updateAndCopyCredentials,
                selectedIdentity
              );
              if (success) {
                const hasPasswordField = form.querySelector(
                  'input[type="password"], input[name*="password"], input[id*="password"]'
                );
                browser.runtime.sendMessage({
                  status: hasPasswordField
                    ? 'Form filled successfully. Please review and submit.'
                    : 'Email-only form filled successfully. Please review and submit.',
                  isError: false,
                });
              } else {
                browser.runtime.sendMessage({ status: 'Failed to fill form', isError: true });
              }
            } catch (error: unknown) {
              browser.runtime.sendMessage({
                status: `Error during signup process: ${getErrorMessage(error)}`,
                isError: true,
              });
            }
          })();
          return true;
        }

        if (runtimeMessage.type === 'fillOTP') {
          (async () => {
            try {
              await fillOtp(typeof runtimeMessage.otp === 'string' ? runtimeMessage.otp : '');
            } catch (error: unknown) {
              logError('Error filling OTP', error);
            }
          })();
          sendResponse({ success: true });
          return true;
        }

        if (runtimeMessage.type === 'checkFormDetected') {
          (async () => {
            try {
              const form = await findSignupForm();
              sendResponse({ formDetected: !!form });
            } catch (error: unknown) {
              logError('Error checking whether a signup form is present', error);
              sendResponse({ formDetected: false });
            }
          })();
          return true;
        }

        if (runtimeMessage.type === 'autofillForm') {
          scheduleScan(0);
          return true;
        }

        if (runtimeMessage.type === 'autofillBlocklistChanged') {
          (async () => {
            const currentDomain = window.location.hostname;
            const blocked = await isDomainBlocked(currentDomain);
            if (blocked) {
              // Remove any injected buttons if domain was just blocked
              clearInjectedUi();
            } else {
              // Re-scan and inject buttons if domain was just unblocked
              clearInjectedUi();
              scheduleScan(0);
            }
          })();
          return true;
        }
      }
    );
  },
});
