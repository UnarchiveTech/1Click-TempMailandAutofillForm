import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { getErrorMessage } from '@/utils/errors.js';
import { logError } from '@/utils/logger.js';
import { injectAutoFillButtons, removeInjectedButtons } from './autofill/autofill-buttons.js';
import { findSignupForm } from './autofill/form-detector.js';
import { fillSignupForm } from './autofill/form-filler.js';
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

    window.addEventListener('load', () => {
      setTimeout(scanForFormsAndInjectButtons, 1000);
    });

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
        scanForFormsAndInjectButtons();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    window.addEventListener('unload', () => {
      observer.disconnect();
      removeInjectedButtons(injectedButtons, updatePositionListeners);
    });

    browser.runtime.onMessage.addListener(
      // biome-ignore lint/suspicious/noExplicitAny: Chrome runtime message listener requires any for discriminated union
      (message: any, _sender: any, sendResponse: (r: unknown) => void) => {
        if (message.action === 'startSignup') {
          (async () => {
            try {
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

        if (message.type === 'fillOTP') {
          (async () => {
            try {
              await fillOtp(message.otp);
            } catch (error: unknown) {
              logError('Error filling OTP', error);
            }
          })();
          sendResponse({ success: true });
          return true;
        }

        if (message.type === 'checkFormDetected') {
          (async () => {
            try {
              const form = await findSignupForm();
              sendResponse({ formDetected: !!form });
            } catch {
              sendResponse({ formDetected: false });
            }
          })();
          return true;
        }

        if (message.type === 'autofillForm') {
          scanForFormsAndInjectButtons();
          return true;
        }
      }
    );
  },
});
