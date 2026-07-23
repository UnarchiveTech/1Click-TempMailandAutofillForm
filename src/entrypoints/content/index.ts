import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { getErrorMessage } from '@/utils/errors.js';
import { getRootDomain } from '@/utils/favicon.js';
import { getCurrentLocale, preloadTranslations } from '@/utils/i18n-utils.js';
import { logError } from '@/utils/logger.js';
import { isDomainBlocked } from '@/utils/storage-keys.js';
import { injectAutoFillButtons, removeInjectedButtons } from './autofill/autofill-buttons.js';
import { findSignupForm } from './autofill/form-detector.js';
import { fillSignupForm } from './autofill/form-filler.js';
import { attachDisposableHint } from './disposable/disposable-detector.js';
import { fillOtp } from './otp/otp-handler.js';
import { getActiveWaitOtpPanel } from './otp/wait-otp-panel.js';

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
    /** Gate scans until the correct locale pack is loaded */
    let localeReady: Promise<void> = Promise.resolve();

    async function ensureLocaleReady(): Promise<void> {
      try {
        const loc = await getCurrentLocale();
        await preloadTranslations(loc);
      } catch (e) {
        logError('Failed to preload content-script translations', e);
      }
    }

    // MUST complete before injecting any UI so labels are not English by default
    localeReady = ensureLocaleReady();

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
        await localeReady;
        // Check if current domain is blocked from autofill
        const currentDomain = window.location.hostname;
        if (await isDomainBlocked(currentDomain)) {
          return;
        }

        // Field icons: lower bar; Autofill All uses score gate inside inject
        const form = await findSignupForm(35);
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

    let idleCallbackId: number | null = null;
    let disposableIdleId: number | null = null;
    let disposableTimerId: ReturnType<typeof setTimeout> | null = null;

    function scheduleScan(delay = 0): void {
      if (rescanTimer) clearTimeout(rescanTimer);
      if (idleCallbackId !== null) {
        if ('cancelIdleCallback' in window) {
          window.cancelIdleCallback(idleCallbackId);
        }
        idleCallbackId = null;
      }

      if (delay > 0) {
        rescanTimer = setTimeout(() => {
          rescanTimer = null;
          triggerScan();
        }, delay);
      } else {
        triggerScan();
      }
    }

    function triggerScan(): void {
      if ('requestIdleCallback' in window) {
        idleCallbackId = window.requestIdleCallback(
          () => {
            idleCallbackId = null;
            void scanForFormsAndInjectButtons();
          },
          { timeout: 500 }
        );
      } else {
        void scanForFormsAndInjectButtons();
      }
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

    function scheduleDisposableScan(): void {
      if (disposableTimerId) clearTimeout(disposableTimerId);
      if (disposableIdleId !== null) {
        if ('cancelIdleCallback' in window) {
          window.cancelIdleCallback(disposableIdleId);
        }
        disposableIdleId = null;
      }

      disposableTimerId = setTimeout(() => {
        disposableTimerId = null;
        if ('requestIdleCallback' in window) {
          disposableIdleId = window.requestIdleCallback(
            () => {
              disposableIdleId = null;
              scanForDisposableHints();
            },
            { timeout: 500 }
          );
        } else {
          scanForDisposableHints();
        }
      }, 100);
    }

    function scanForDisposableHints(): void {
      void localeReady.then(() => {
        const emailFields = document.querySelectorAll<HTMLInputElement>(
          'input[type="email"], input[name*="email" i], input[id*="email" i], input[autocomplete="email"]'
        );
        emailFields.forEach((field: HTMLInputElement) => {
          const tracker = attachDisposableHint(field, updatePositionListeners);
          if (tracker) disposableTrackers.add(tracker);
        });
      });
    }

    // Re-inject translated UI when user changes extension language;
    // also re-scan when inboxes become available (create on another tab).
    const onLocaleStorageChange = (
      changes: Record<string, { newValue?: unknown }>,
      area: string
    ) => {
      if (area !== 'local') return;
      if (changes.locale || changes.preferredLanguage) {
        localeReady = ensureLocaleReady().then(() => {
          clearInjectedUi();
          scheduleScan(0);
          scheduleDisposableScan();
        });
        return;
      }
      if (
        changes.inboxes ||
        changes.activeInboxId ||
        changes.onboardingComplete ||
        changes.autofillBlocklist
      ) {
        clearInjectedUi();
        scheduleScan(50);
        scheduleDisposableScan();
      }
    };
    try {
      browser.storage.onChanged.addListener(onLocaleStorageChange);
    } catch {
      /* ignore */
    }

    function handlePageLoad(): void {
      scheduleScan(0);
    }

    function handleSpaNavigation(): void {
      if (window.location.href === currentUrl) return;
      currentUrl = window.location.href;
      clearInjectedUi();
      scheduleScan(50);
      scheduleDisposableScan();
      // Tell extension UI form may have gone
      try {
        void browser.runtime
          .sendMessage({ type: 'formPresence', formDetected: false })
          .catch(() => {});
      } catch {
        /* ignore */
      }
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
    window.addEventListener('hashchange', handleSpaNavigation);
    // SPA frameworks that only mutate URL bar without history APIs
    try {
      const nav = (window as unknown as { navigation?: EventTarget }).navigation;
      nav?.addEventListener?.('navigate', () => {
        setTimeout(handleSpaNavigation, 0);
      });
    } catch {
      /* Navigation API optional */
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') scheduleScan(100);
    });
    window.addEventListener('pagehide', teardown);
    window.addEventListener('unload', teardown);
    scheduleScan(0);
    scheduleDisposableScan();
    initialScanTimer = setTimeout(() => {
      initialScanTimer = null;
      scheduleScan(0);
      scheduleDisposableScan();
    }, 1000);

    // Soft re-check: if buttons were injected but form disappeared (SPA), clear UI
    let formWatchTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
      if (!autoFillButtonsInjected.value) return;
      void findSignupForm().then((form) => {
        if (!form) {
          clearInjectedUi();
          try {
            void browser.runtime
              .sendMessage({ type: 'formPresence', formDetected: false })
              .catch(() => {});
          } catch {
            /* ignore */
          }
        }
      });
    }, 8000);

    const observer = new MutationObserver((mutations: MutationRecord[]) => {
      let mightHaveAddedForm = false;
      let mightHaveRemovedForm = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          for (const node of Array.from(mutation.addedNodes)) {
            if (node.nodeType !== 1) continue;
            const el = node as Element;
            if (
              el.classList?.contains('oneclick-autofill-btn') ||
              el.id?.includes('oneclick') ||
              el.hasAttribute?.('data-oneclick-injected')
            ) {
              continue;
            }
            if (el.nodeName === 'FORM' || el.querySelector?.('form, input[type="email"]')) {
              mightHaveAddedForm = true;
            }
          }
        }
        if (mutation.removedNodes.length > 0 && autoFillButtonsInjected.value) {
          for (const node of Array.from(mutation.removedNodes)) {
            if (node.nodeType !== 1) continue;
            const el = node as Element;
            if (el.nodeName === 'FORM' || el.querySelector?.('form, input[type="email"]')) {
              mightHaveRemovedForm = true;
            }
          }
        }
      }
      if (mightHaveAddedForm) {
        // Re-scan even if already injected — SPA may replace the form node
        if (autoFillButtonsInjected.value && mightHaveRemovedForm) {
          clearInjectedUi();
        }
        scheduleScan(120);
      } else if (mightHaveRemovedForm) {
        void findSignupForm().then((form) => {
          if (!form) clearInjectedUi();
          else {
            clearInjectedUi();
            scheduleScan(80);
          }
        });
      }
    });

    const disposableObserver = new MutationObserver((mutations: MutationRecord[]) => {
      const shouldRescan = mutations.some(
        (mutation: MutationRecord) =>
          mutation.addedNodes.length > 0 &&
          Array.from(mutation.addedNodes).some((node: Node) => {
            if (node.nodeType !== 1) return false;
            const el = node as Element;
            return !el.classList?.contains('oneclick-autofill-btn');
          })
      );
      if (shouldRescan) {
        scheduleDisposableScan();
      }
    });
    disposableObserver.observe(document.body, { childList: true, subtree: true });

    observer.observe(document.body, { childList: true, subtree: true });

    function teardown(): void {
      if (initialScanTimer) clearTimeout(initialScanTimer);
      if (rescanTimer) clearTimeout(rescanTimer);
      if (disposableTimerId) clearTimeout(disposableTimerId);
      if (formWatchTimer) {
        clearInterval(formWatchTimer);
        formWatchTimer = null;
      }

      if (idleCallbackId !== null && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(idleCallbackId);
      }
      if (disposableIdleId !== null && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(disposableIdleId);
      }

      try {
        browser.storage.onChanged.removeListener(onLocaleStorageChange);
      } catch {
        /* ignore */
      }
      observer.disconnect();
      disposableObserver.disconnect();
      clearInjectedUi();
      window.removeEventListener('load', handlePageLoad);
      window.removeEventListener('popstate', handleSpaNavigation);
      window.removeEventListener('pagehide', teardown);
      window.removeEventListener('unload', teardown);
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
                  preferredEmail?: string | null;
                  gender?: string | null;
                  dateOfBirth?: string | null;
                  country?: string | null;
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
              const currentDomain = window.location.hostname;
              const isBlocked = await isDomainBlocked(currentDomain);
              if (isBlocked) {
                return;
              }

              const otp = typeof runtimeMessage.otp === 'string' ? runtimeMessage.otp : '';
              const sender = typeof runtimeMessage.sender === 'string' ? runtimeMessage.sender : '';
              const senderName =
                typeof runtimeMessage.senderName === 'string' ? runtimeMessage.senderName : '';
              const subject =
                typeof runtimeMessage.subject === 'string' ? runtimeMessage.subject : '';

              // Always feed the Wait-for-OTP panel when open (user opted in by starting wait)
              const waitPanel = getActiveWaitOtpPanel();
              if (waitPanel && otp) {
                await waitPanel.notifyOtp(otp, { sender, subject });
                return;
              }

              // Verify the current site is opted-in for OTP auto-fill (defaults to off)
              const { otpOptInList = [] } = (await browser.storage.local.get(['otpOptInList'])) as {
                otpOptInList?: string[];
              };
              const domainKey = currentDomain.replace(/^www\./, '').toLowerCase();
              const isOptedIn = otpOptInList.some(
                (d) => typeof d === 'string' && d.toLowerCase() === domainKey
              );
              if (!isOptedIn) {
                return;
              }

              if (!isTabRelatedToOtp(currentDomain, sender, senderName, subject)) {
                return;
              }

              await fillOtp(otp);
            } catch (error: unknown) {
              logError('Error filling OTP', error);
            }
          })();
          sendResponse({ success: true });
          return true;
        }

        if (runtimeMessage.type === 'ping') {
          sendResponse({ ok: true });
          return true;
        }

        if (runtimeMessage.type === 'checkFormDetected') {
          (async () => {
            try {
              const form = await findSignupForm();
              const detected = !!form;
              sendResponse({ formDetected: detected });
              try {
                void browser.runtime
                  .sendMessage({ type: 'formPresence', formDetected: detected })
                  .catch(() => {});
              } catch {
                /* ignore */
              }
            } catch (error: unknown) {
              logError('Error checking whether a signup form is present', error);
              sendResponse({ formDetected: false });
            }
          })();
          return true;
        }

        if (runtimeMessage.type === 'rescanForms') {
          (async () => {
            try {
              clearInjectedUi();
              await scanForFormsAndInjectButtons();
              const form = await findSignupForm();
              sendResponse({ ok: true, formDetected: !!form });
              try {
                void browser.runtime
                  .sendMessage({ type: 'formPresence', formDetected: !!form })
                  .catch(() => {});
              } catch {
                /* ignore */
              }
            } catch (error: unknown) {
              logError('rescanForms failed', error);
              sendResponse({ ok: false, formDetected: false });
            }
          })();
          return true;
        }

        if (runtimeMessage.type === 'autofillForm') {
          scheduleScan(0);
          return true;
        }

        if (runtimeMessage.type === 'refillSavedLogin') {
          (async () => {
            try {
              const cred = (
                runtimeMessage as { credential?: Record<string, string | null | undefined> }
              ).credential;
              if (!cred) {
                sendResponse({ success: false });
                return;
              }
              const form = await findSignupForm();
              if (!form) {
                sendResponse({ success: false, error: 'no form' });
                return;
              }
              const { fillSignupForm } = await import('./autofill/form-filler.js');
              await fillSignupForm(form, async () => {}, undefined, {
                email: String(cred.email || ''),
                password: String(cred.password || ''),
                username: (cred.username as string | null | undefined) ?? null,
                name: (cred.name as string | null | undefined) ?? null,
                phone: (cred.phone as string | null | undefined) ?? null,
                website: (cred.website as string | null | undefined) ?? null,
              });
              sendResponse({ success: true });
            } catch (e) {
              logError('refillSavedLogin error', e);
              sendResponse({ success: false });
            }
          })();
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

export function getDomainName(hostname: string): string {
  const parts = hostname.toLowerCase().split('.');
  const tldExclusions = new Set([
    'com',
    'co',
    'org',
    'net',
    'edu',
    'gov',
    'mil',
    'in',
    'uk',
    'us',
    'ca',
    'au',
    'jp',
    'cn',
    'br',
    'de',
    'fr',
    'ru',
    'ch',
    'it',
    'nl',
    'se',
    'no',
    'es',
    'mx',
    'tr',
    'sg',
    'hk',
    'tw',
    'pk',
    'pe',
  ]);

  for (let i = parts.length - 1; i >= 0; i--) {
    if (!tldExclusions.has(parts[i])) {
      return parts[i];
    }
  }
  return parts[0] || '';
}

export function isTabRelatedToOtp(
  currentDomain: string,
  senderEmail: string,
  senderName: string,
  subject: string
): boolean {
  const domainLower = currentDomain.toLowerCase();
  const domainName = getDomainName(domainLower);
  if (!domainName) return false;

  const senderEmailLower = senderEmail.toLowerCase();
  const senderNameLower = senderName.toLowerCase();
  const subjectLower = subject.toLowerCase();

  // Use word boundaries for domain name matching to avoid false positive matches on substrings.
  const escapedDomainName = domainName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const domainRegex = new RegExp(`\\b${escapedDomainName}\\b`, 'i');

  // 1. Exact registered-domain comparison (handles subdomains + multi-level TLDs).
  //    e.g. sub.github.com vs noreply@github.com -> both root to "github.com".
  const currentRoot = getRootDomain(domainLower);
  const emailDomainMatch = senderEmailLower.match(/@([^>\s]+)/);
  if (emailDomainMatch) {
    const emailRoot = getRootDomain(emailDomainMatch[1]);
    if (currentRoot && emailRoot && currentRoot === emailRoot) {
      return true;
    }
  }

  // 2. Brand-name word-boundary match against the sender email.
  //    Works for any brand length (e.g. "github" in noreply@github.com).
  if (domainRegex.test(senderEmailLower)) {
    return true;
  }

  // 3. Brand-name word-boundary match against sender name and subject -- but
  //    only for brand names longer than 2 characters, to prevent
  //    false-positives from short/common words (e.g. "it", "co", "in").
  if (domainName.length > 2) {
    if (domainRegex.test(senderNameLower)) {
      return true;
    }
    if (domainRegex.test(subjectLower)) {
      return true;
    }
  }

  // 4. Fallback: exact brand-name (getDomainName) equality between the
  //    current domain and the sender email's domain.
  if (emailDomainMatch) {
    const emailDomainName = getDomainName(emailDomainMatch[1]);
    if (emailDomainName && emailDomainName === domainName) {
      return true;
    }
  }

  return false;
}
