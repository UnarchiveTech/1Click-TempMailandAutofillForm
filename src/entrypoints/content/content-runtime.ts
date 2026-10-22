import { browser } from 'wxt/browser';
import { queryAllDeep } from '@/features/intelligence/dom-pierce.js';
import { resumeSignupOutcome } from '@/features/intelligence/submit-action.js';
import { isDomainBlocked } from '@/utils/content/autofill-blocklist.js';
import {
  advanceWizardStepViaBg,
  detectWizardStepFromPage,
  getSitePrivacySettingsViaBg,
  getStorageViaBg,
  getWizardSessionViaBg,
  invalidateSitePrivacySettingsCache,
  isExtensionContextInvalidated,
  loadSmartAutofillSettingsViaBg,
  sendMessageViaBg,
} from '@/utils/content/content-bg-bridge.js';
import { isTrustedContentScriptMessage } from '@/utils/content/content-message-guard.js';
import {
  cacheSitePrivacySettings,
  getCachedSitePrivacySettingsOrDisabled,
  invalidateCachedSitePrivacySettings,
  type SitePrivacySettings,
} from '@/utils/content/site-privacy-settings.js';
import { logError } from '@/utils/logger.js';
import { Mutex } from '@/utils/mutex.js';
import { perfEnd, perfStart } from '@/utils/perf/perf-marks.js';
import { CONTENT_Z } from '@/utils/ui/portal-layers.js';
import { hostMatchesDomainScope } from '@/utils/validation.js';
import { injectAutoFillButtons, removeInjectedButtons } from './autofill/autofill-buttons.js';
import { detectHumanVerification } from './autofill/challenge-detector.js';
import { watchSiteEmailDomainRejection } from './autofill/email-domain-recovery.js';
import { findSignupForm } from './autofill/form-detector.js';
import {
  fillInputValueForce,
  fillSignupForm,
  findUsernameField,
  showAutofillResultFeedback,
} from './autofill/form-filler.js';
import { clearUsernameRecoveries, resumeUsernameRecovery } from './autofill/username-recovery.js';
import {
  AUTH_PROBE_DEEP_SCAN_INTERVAL,
  hasAuthOrFormSurface,
  hasAuthOrFormSurfaceDeep,
  hasAuthSurface,
  isFormSurfaceAttributeChange,
  isTabRelatedToOtp,
  nodeHasFormSurface,
  restoreHistoryMethods,
} from './content-frame-gate.js';
import { attachDisposableHint } from './disposable/disposable-detector.js';
import { getOrCreateShadowRoot, protectShadowHost } from './dom/shadow-dom.js';
import { clearInjectedFeedback } from './dom/tooltip.js';
import { stopMultiStepOtpWatch } from './otp/multi-step-otp.js';
import { fillOtp } from './otp/otp-handler.js';
import {
  dismissWaitOtpPanel,
  getActiveWaitOtpPanel,
  showWaitOtpPanel,
} from './otp/wait-otp-panel.js';
import {
  mountSitePrivacyControls,
  sitePrivacyControlsMounted,
} from './privacy/site-privacy-controls.js';
import { readAutofillFeatureEnabled, readOtpOptInList } from './shared/storage-reads.js';

export function startContentRuntime(): void {
  // Frame triage: ad/analytics sub-frames (no form, no fillable field) must
  // not wake the service worker. The lightweight content gate owns top-frame
  // session-credential cleanup; a form-bearing child frame keeps its cleanup
  // path in case the user granted access to that origin without its parent.
  const isTopFrame = window.self === window.top;
  const surfaceAtStart = hasAuthOrFormSurfaceDeep();
  if (!isTopFrame && surfaceAtStart) {
    sendMessageViaBg({ type: 'clearSessionCredentials' }).catch((error: Error) =>
      logError('Could not send child-frame clear session message', error)
    );
  }

  const autoFillButtonsInjected = { value: false };
  const formScanMutex = new Mutex();
  let autofillRoot: HTMLElement | null = null;
  const injectedButtons: HTMLElement[] = [];
  const updatePositionListeners: Array<() => void> = [];
  const disposableTrackers = new Set<{ cleanup: () => void }>();
  let initialScanTimer: ReturnType<typeof setTimeout> | null = null;
  let rescanTimer: ReturnType<typeof setTimeout> | null = null;
  let spaNavigationTimer: ReturnType<typeof setTimeout> | null = null;
  let deferredFormTimer: ReturnType<typeof setTimeout> | null = null;
  let mutationTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingMutations: MutationRecord[] = [];
  let scanGeneration = 0;
  let currentUrl = window.location.href;
  let currentHost = window.location.hostname;
  // Set by the form-watch tick when its amortized deep scan finds a
  // shadow-hosted form the light-DOM probe cannot see - lets exactly one
  // scheduled scan past the idle gate to inject into it.
  let idleGateBypass = surfaceAtStart && !hasAuthOrFormSurface();
  let removeSitePrivacyControls: (() => void) | null = null;
  let reportedFormPresence: boolean | null = null;

  function reportFormPresence(detected: boolean): void {
    if (reportedFormPresence === detected) return;
    reportedFormPresence = detected;
    void sendMessageViaBg({ type: 'formPresence', formDetected: detected });
  }

  async function refreshSitePrivacySettings(): Promise<SitePrivacySettings> {
    const requestedHost = window.location.hostname;
    const latest = await getSitePrivacySettingsViaBg();
    if (latest && requestedHost === window.location.hostname) cacheSitePrivacySettings(latest);
    return getCachedSitePrivacySettingsOrDisabled();
  }

  // Multi-step wizard resume + post-submit verify (best-effort)
  void (async () => {
    try {
      // Same frame triage as the startup clear above: wizard sessions are
      // keyed by domain+tab and step detection needs page inputs, so
      // surface-less sub-frames skip the session round-trip entirely.
      if (!isTopFrame && !surfaceAtStart) return;
      const domain = window.location.hostname;
      const privacy = await refreshSitePrivacySettings();
      if (privacy.formScanning) await resumeSignupOutcome();
      if (!privacy.otpDetection) return;
      const session = (await getWizardSessionViaBg(domain)) as {
        email?: string | null;
      } | null;
      if (!session) return;
      const step = detectWizardStepFromPage();

      if (step === 'otp') {
        await advanceWizardStepViaBg(domain, 'otp', { paths: [location.pathname] });
        const smart = (await loadSmartAutofillSettingsViaBg()) as {
          smartOtpAttach: boolean;
        } | null;
        if (smart?.smartOtpAttach && session.email) {
          void showWaitOtpPanel({
            email: session.email,
            autoFill: true,
            skipIfNotVerificationPage: true,
          });
        }
      } else if (step === 'profile') {
        await advanceWizardStepViaBg(domain, 'profile', { paths: [location.pathname] });
      }
    } catch (error) {
      logError('Could not resume signup tracking', error);
    }
  })();

  async function updateAndCopyCredentials(
    credentialsToUpdate: Record<string, string>
  ): Promise<void> {
    try {
      await sendMessageViaBg({
        type: 'updateSessionCredentials',
        credentials: credentialsToUpdate,
      });
    } catch (error: unknown) {
      logError('Error sending update credentials message', error);
    }
  }

  async function scanForFormsAndInjectButtons(
    force = false,
    generation = scanGeneration
  ): Promise<void> {
    // Load, mutations and refresh requests can overlap while the background
    // lookup is pending. Serialize the complete injection, including forced
    // teardown, so two scans cannot append toolbars for the same form.
    try {
      await formScanMutex.runExclusive(() => scanAndInject(force, generation));
    } catch (error) {
      logError('Could not complete the queued form scan', error);
    }
  }

  async function scanAndInject(force: boolean, generation: number): Promise<void> {
    // Extension reloaded/updated while this tab stayed alive: every
    // background call is now a silent no-op, so stop doing scan work too.
    if (isExtensionContextInvalidated()) return;
    if (generation !== scanGeneration) return;
    // Frame triage: without a form or fillable field, the blocklist/feature
    // reads below cannot lead to an injection this pass - skip them (each
    // is a storage round-trip, and getStorageViaBg wakes the worker).
    // Shadow-hosted surfaces stay recoverable: the form-watch tick's
    // amortized deep scan sets idleGateBypass when it finds one, and
    // mutation-triggered rescans imply a real node arrived (probe passes).
    if (!hasAuthOrFormSurface() && !autoFillButtonsInjected.value && !idleGateBypass) {
      return;
    }
    if (isTopFrame && hasAuthOrFormSurface() && !sitePrivacyControlsMounted()) {
      removeSitePrivacyControls?.();
      removeSitePrivacyControls = mountSitePrivacyControls();
    }
    idleGateBypass = false;
    const scanStart = perfStart('content.scan');
    try {
      const currentDomain = window.location.hostname;
      const [sitePrivacy, autofillEnabled, domainBlocked] = await Promise.all([
        refreshSitePrivacySettings(),
        readAutofillFeatureEnabled(),
        isDomainBlocked(currentDomain),
      ]);
      if (generation !== scanGeneration) return;
      if (!sitePrivacy.formScanning) {
        clearInjectedUi();
        reportFormPresence(false);
        return;
      }
      // Guarded reader (shared/storage-reads.ts): only an explicit `false`
      // disables autofill, and it cannot throw (a dead bridge context resolves
      // to "unset"), so no try/catch is needed here.
      if (!autofillEnabled) {
        clearInjectedUi();
        reportFormPresence(false);
        return;
      }
      // Check if current domain is blocked from autofill
      if (domainBlocked) {
        if (generation !== scanGeneration) return;
        // A blocklist change can arrive after buttons were injected. Clear
        // stale controls before returning so a newly blocked SPA page never
        // keeps actionable autofill UI visible.
        clearInjectedUi();
        reportFormPresence(false);
        return;
      }

      // Keep shadow host alive against SPA DOM rewrites
      getOrCreateShadowRoot();
      protectShadowHost();

      // Field icons: lower bar; Autofill All uses score gate inside inject
      // Progressive SPA steps (email-only) need low minScore
      const form = await findSignupForm(30);
      if (generation !== scanGeneration) return;
      // The popup can react before replay lookup and control construction finish.
      reportFormPresence(!!form);
      if (form) {
        // Force re-inject when SPA replaced form or buttons were detached
        if (force || !autoFillButtonsInjected.value || autofillRoot !== form) {
          if (force || autofillRoot !== form) {
            clearInjectedUi();
          }
          autofillRoot = form;
          await resumeSignupOutcome(form);
          await injectAutoFillButtons(
            form,
            injectedButtons,
            updatePositionListeners,
            autoFillButtonsInjected,
            updateAndCopyCredentials
          );
          if (generation !== scanGeneration) {
            clearInjectedUi();
            return;
          }
          const username = await findUsernameField(form);
          if (generation !== scanGeneration) return;
          updatePositionListeners.push(watchSiteEmailDomainRejection(form));
          await resumeUsernameRecovery(form, username, fillInputValueForce);
        } else {
          // Buttons exist - re-assert host + visibility only
          try {
            protectShadowHost();
            for (const el of injectedButtons) {
              if (el?.style) {
                el.style.setProperty('opacity', '0.95', 'important');
                el.style.setProperty('visibility', 'visible', 'important');
                el.style.setProperty(
                  'display',
                  el.style.display === 'none' ? 'flex' : el.style.display || 'flex',
                  'important'
                );
                el.style.setProperty('pointer-events', 'auto', 'important');
                el.style.setProperty('z-index', String(CONTENT_Z.tooltip), 'important');
              }
            }
          } catch {
            /* ignore */
          }
        }
      } else if (autoFillButtonsInjected.value) {
        clearInjectedUi();
        void sendMessageViaBg({ type: 'formPresence', formDetected: false });
      }
    } catch (error: unknown) {
      logError('Error scanning for forms', error);
    } finally {
      perfEnd('content.scan', scanStart, { force });
    }
  }

  let idleCallbackId: number | null = null;
  let disposableIdleId: number | null = null;
  let disposableTimerId: ReturnType<typeof setTimeout> | null = null;

  function cancelSpaScheduledWork(): void {
    if (initialScanTimer) {
      clearTimeout(initialScanTimer);
      initialScanTimer = null;
    }
    if (rescanTimer) {
      clearTimeout(rescanTimer);
      rescanTimer = null;
    }
    if (spaNavigationTimer) {
      clearTimeout(spaNavigationTimer);
      spaNavigationTimer = null;
    }
    if (deferredFormTimer) {
      clearTimeout(deferredFormTimer);
      deferredFormTimer = null;
    }
    if (mutationTimer) {
      clearTimeout(mutationTimer);
      mutationTimer = null;
    }
    pendingMutations = [];
    clearInjectedFeedback();
  }

  function scheduleScan(delay = 0, priority = false): void {
    const generation = scanGeneration;
    if (rescanTimer) clearTimeout(rescanTimer);
    rescanTimer = null;
    if (idleCallbackId !== null) {
      if ('cancelIdleCallback' in window) {
        window.cancelIdleCallback(idleCallbackId);
      }
      idleCallbackId = null;
    }

    if (delay > 0) {
      rescanTimer = setTimeout(() => {
        rescanTimer = null;
        if (generation !== scanGeneration) return;
        triggerScan(generation, priority);
      }, delay);
    } else {
      triggerScan(generation, priority);
    }
  }

  function triggerScan(generation = scanGeneration, priority = false): void {
    if (generation !== scanGeneration) return;
    if (priority) {
      void scanForFormsAndInjectButtons(false, generation);
      return;
    }
    if ('requestIdleCallback' in window) {
      idleCallbackId = window.requestIdleCallback(
        () => {
          idleCallbackId = null;
          if (generation !== scanGeneration) return;
          void scanForFormsAndInjectButtons(false, generation);
        },
        { timeout: 500 }
      );
    } else {
      void scanForFormsAndInjectButtons(false, generation);
    }
  }

  function clearInjectedUi(): void {
    clearUsernameRecoveries();
    clearInjectedFeedback();
    removeInjectedButtons(injectedButtons, updatePositionListeners);
    autoFillButtonsInjected.value = false;
    autofillRoot = null;
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
    const generation = scanGeneration;
    if (disposableTimerId) clearTimeout(disposableTimerId);
    if (disposableIdleId !== null) {
      if ('cancelIdleCallback' in window) {
        window.cancelIdleCallback(disposableIdleId);
      }
      disposableIdleId = null;
    }

    disposableTimerId = setTimeout(() => {
      disposableTimerId = null;
      if (generation !== scanGeneration) return;
      if ('requestIdleCallback' in window) {
        disposableIdleId = window.requestIdleCallback(
          () => {
            disposableIdleId = null;
            if (generation !== scanGeneration) return;
            scanForDisposableHints(generation);
          },
          { timeout: 500 }
        );
      } else {
        scanForDisposableHints(generation);
      }
    }, 100);
  }

  function scanForDisposableHints(generation = scanGeneration): void {
    if (isExtensionContextInvalidated()) return;
    if (generation !== scanGeneration) return;
    void (async () => {
      if (generation !== scanGeneration) return;
      const privacy = await refreshSitePrivacySettings();
      if (!privacy.formScanning || generation !== scanGeneration) {
        disposableTrackers.forEach((tracker) => {
          tracker.cleanup();
        });
        disposableTrackers.clear();
        return;
      }
      const emailFields = queryAllDeep<HTMLInputElement>(
        document,
        'input[type="email"], input[name*="email" i], input[id*="email" i], input[autocomplete="email"]'
      );
      emailFields.forEach((field: HTMLInputElement) => {
        if (disposableTrackers.size >= 50) return;
        void (async () => {
          if (generation !== scanGeneration) return;
          const tracker = attachDisposableHint(field, updatePositionListeners);
          if (tracker) disposableTrackers.add(tracker);
        })();
      });
    })();
  }

  // Re-inject translated UI when user changes extension language;
  // also re-scan when addresses become available (create on another tab).

  function handlePageLoad(): void {
    scheduleScan(0, true);
  }

  function stopPageScopedFlows(): void {
    stopMultiStepOtpWatch();
    dismissWaitOtpPanel();
  }

  function handleSpaNavigation(): void {
    if (window.location.href === currentUrl) return;
    currentUrl = window.location.href;
    const hostChanged = window.location.hostname !== currentHost;
    if (hostChanged) {
      currentHost = window.location.hostname;
      invalidateSitePrivacySettingsCache();
      invalidateCachedSitePrivacySettings();
    }
    scanGeneration += 1;
    cancelSpaScheduledWork();
    stopPageScopedFlows();
    clearInjectedUi();
    removeSitePrivacyControls?.();
    removeSitePrivacyControls = null;
    if (hostChanged && isTopFrame && hasAuthOrFormSurface()) {
      removeSitePrivacyControls = mountSitePrivacyControls();
    }
    missingFormTicks = 0;
    missingSurfaceTicks = 0;
    scheduleScan(50, true);
    scheduleDisposableScan();
    // Tell extension UI the form may have gone. Best-effort ping -
    // sendMessageViaBg logs failures internally and never rejects, so no
    // local guard is needed. Surface-less frames (ads) never advertised
    // presence, so pinging them would only wake the worker.
    if (autoFillButtonsInjected.value || hasAuthOrFormSurface()) {
      void sendMessageViaBg({ type: 'formPresence', formDetected: false });
    }
  }

  let isExtensionActive = true;
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  history.pushState = function (...args) {
    const result = originalPushState.apply(this, args);
    if (isExtensionActive) handleSpaNavigation();
    return result;
  };
  history.replaceState = function (...args) {
    const result = originalReplaceState.apply(this, args);
    if (isExtensionActive) handleSpaNavigation();
    return result;
  };

  window.addEventListener('load', handlePageLoad);
  window.addEventListener('popstate', handleSpaNavigation);
  window.addEventListener('hashchange', handleSpaNavigation);

  const navListener = () => {
    if (spaNavigationTimer) clearTimeout(spaNavigationTimer);
    spaNavigationTimer = setTimeout(() => {
      spaNavigationTimer = null;
      handleSpaNavigation();
    }, 0);
  };
  try {
    const nav = (window as unknown as { navigation?: EventTarget }).navigation;
    nav?.addEventListener?.('navigate', navListener);
  } catch {
    /* Navigation API optional */
  }
  function handleVisibilityChange() {
    if (document.visibilityState === 'visible') scheduleScan(0, true);
  }
  document.addEventListener('visibilitychange', handleVisibilityChange);

  function handleFieldFocus(event: FocusEvent): void {
    if (autoFillButtonsInjected.value) return;
    if (
      !event
        .composedPath()
        .some((target) => target instanceof Element && target.matches('input, select, textarea'))
    )
      return;
    idleGateBypass = true;
    scheduleScan(0, true);
  }
  document.addEventListener('focusin', handleFieldFocus);

  scheduleScan(0, true);
  scheduleDisposableScan();
  const initialGeneration = scanGeneration;
  initialScanTimer = setTimeout(() => {
    initialScanTimer = null;
    if (initialGeneration !== scanGeneration) return;
    scheduleScan(0);
    scheduleDisposableScan();
  }, 1000);

  // Soft re-check: keep UI alive on SPA; only clear if no auth form for a while
  let missingFormTicks = 0;
  let missingSurfaceTicks = 0;
  let formWatchTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
    // Self-retire after extension-context invalidation: the bridge is
    // dead, so stop the periodic loop and the DOM observers that feed it
    // (they would otherwise keep scanning forever on long-lived tabs).
    if (isExtensionContextInvalidated()) {
      if (formWatchTimer) {
        clearInterval(formWatchTimer);
        formWatchTimer = null;
      }
      observer.disconnect();
      disposableObserver.disconnect();
      return;
    }
    const generation = scanGeneration;
    // Idle bail: with no form and no fillable field in the light DOM,
    // findSignupForm(30)'s input-based fallbacks cannot match, and any
    // real surface it could find is shadow-hosted - handled by the
    // amortized deep scan below. Injected-UI/OTP-keeper duties are
    // checked first so live flows are never starved by the bail.
    const surfacePresent = hasAuthOrFormSurface();
    if (
      !autoFillButtonsInjected.value &&
      !getActiveWaitOtpPanel() &&
      !surfacePresent &&
      ++missingSurfaceTicks < AUTH_PROBE_DEEP_SCAN_INTERVAL
    ) {
      return;
    }
    void (async () => {
      const tickStart = perfStart('content.formWatchTick');
      try {
        if (!surfacePresent) {
          // Amortized deep pass: shadow-hosted auth surfaces are invisible
          // to the light-DOM probe, so scan through shadow roots/frames at
          // the amortized cadence to stay recoverable.
          missingSurfaceTicks = 0;
        }
        getOrCreateShadowRoot();
        protectShadowHost();
        const form = await findSignupForm(30);
        if (generation !== scanGeneration) return;
        if (!form) {
          missingFormTicks += 1;
          // Multi-step SPA may briefly have no form between steps - wait ~12s
          if (autoFillButtonsInjected.value && missingFormTicks >= 3) {
            clearInjectedUi();
            missingFormTicks = 0;
            // Best-effort presence ping - the bridge logs and swallows failures.
            void sendMessageViaBg({ type: 'formPresence', formDetected: false });
          }
          return;
        }
        missingFormTicks = 0;
        missingSurfaceTicks = 0;
        // Form present but buttons lost (host removed) → force re-inject
        if (
          !autoFillButtonsInjected.value ||
          autofillRoot !== form ||
          injectedButtons.some((b) => !b.isConnected)
        ) {
          clearInjectedUi();
          // The form may be shadow-hosted (light probe false) - let the
          // scheduled scan past its idle gate.
          idleGateBypass = true;
          scheduleScan(50);
        }
      } finally {
        perfEnd('content.formWatchTick', tickStart);
      }
    })();
  }, 4000);

  const observer = new MutationObserver((mutations: MutationRecord[]) => {
    pendingMutations.push(...mutations);
    if (mutationTimer) return;
    const generation = scanGeneration;
    mutationTimer = setTimeout(() => {
      mutationTimer = null;
      if (generation !== scanGeneration) {
        pendingMutations = [];
        return;
      }
      const muts = pendingMutations;
      pendingMutations = [];
      let mightHaveAddedForm = false;
      let mightHaveRemovedForm = false;
      for (const mutation of muts) {
        // Once controls exist their position trackers handle visibility.
        // Framework validation classes during a fill must not rebuild the
        // toolbar and discard its Reset snapshot or open identity review.
        if (!autoFillButtonsInjected.value && isFormSurfaceAttributeChange(mutation)) {
          mightHaveAddedForm = true;
        }
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
            if (nodeHasFormSurface(el)) {
              mightHaveAddedForm = true;
            }
          }
        }
        if (mutation.removedNodes.length > 0 && autoFillButtonsInjected.value) {
          for (const node of Array.from(mutation.removedNodes)) {
            if (node.nodeType !== 1) continue;
            const el = node as Element;
            if (nodeHasFormSurface(el)) {
              mightHaveRemovedForm = true;
            }
          }
        }
      }
      if (mightHaveAddedForm) {
        idleGateBypass = true;
        // SPA step change (email → name → OTP): force re-inject on new fields
        if (autoFillButtonsInjected.value && mightHaveRemovedForm) {
          clearInjectedUi();
        }
        // Force scan so multi-step containers get Autofill All again
        if (rescanTimer) clearTimeout(rescanTimer);
        const generation = scanGeneration;
        rescanTimer = setTimeout(() => {
          rescanTimer = null;
          if (generation !== scanGeneration) return;
          void scanForFormsAndInjectButtons(true, generation);
        }, 0);
      } else if (mightHaveRemovedForm) {
        void (async () => {
          const form = await findSignupForm(30);
          if (generation !== scanGeneration) return;
          if (!form) {
            // Early disconnect to prevent event spam while waiting
            updatePositionListeners.forEach((fn) => {
              try {
                fn();
              } catch {
                /* intentional: position listener teardown */
              }
            });
            updatePositionListeners.length = 0;
            // Defer clear - multi-step transition may be mid-flight
            const generation = scanGeneration;
            if (deferredFormTimer) clearTimeout(deferredFormTimer);
            deferredFormTimer = setTimeout(() => {
              deferredFormTimer = null;
              if (generation !== scanGeneration) return;
              void (async () => {
                const f2 = await findSignupForm(30);
                if (generation !== scanGeneration) return;
                if (!f2) clearInjectedUi();
                else {
                  // Same as above: confirmed form may be shadow-hosted.
                  idleGateBypass = true;
                  clearInjectedUi();
                  void scanForFormsAndInjectButtons(true, generation);
                }
              })();
            }, 400);
          } else {
            if (generation !== scanGeneration) return;
            // findSignupForm just confirmed a form - possibly shadow-hosted,
            // hence invisible to the scan's light-DOM gate.
            idleGateBypass = true;
            clearInjectedUi();
            void scanForFormsAndInjectButtons(true, generation);
          }
        })();
      }
    }, 50);
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
  const observationRoot = document.body || document.documentElement || document;
  disposableObserver.observe(observationRoot, { childList: true, subtree: true });
  observer.observe(observationRoot, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: [
      'hidden',
      'inert',
      'disabled',
      'readonly',
      'type',
      'autocomplete',
      'style',
      'class',
    ],
  });

  function teardown(): void {
    scanGeneration += 1;
    cancelSpaScheduledWork();
    if (disposableTimerId) {
      clearTimeout(disposableTimerId);
      disposableTimerId = null;
    }
    if (formWatchTimer) {
      clearInterval(formWatchTimer);
      formWatchTimer = null;
    }

    if (idleCallbackId !== null && 'cancelIdleCallback' in window) {
      window.cancelIdleCallback(idleCallbackId);
      idleCallbackId = null;
    }
    if (disposableIdleId !== null && 'cancelIdleCallback' in window) {
      window.cancelIdleCallback(disposableIdleId);
      disposableIdleId = null;
    }

    observer.disconnect();
    disposableObserver.disconnect();
    stopPageScopedFlows();
    clearInjectedUi();
    removeSitePrivacyControls?.();
    removeSitePrivacyControls = null;
    window.removeEventListener('load', handlePageLoad);
    window.removeEventListener('popstate', handleSpaNavigation);
    window.removeEventListener('hashchange', handleSpaNavigation);
    try {
      const nav = (window as unknown as { navigation?: EventTarget }).navigation;
      nav?.removeEventListener?.('navigate', navListener);
    } catch {
      /* intentional: navigation API teardown */
    }

    restoreHistoryMethods(history, originalPushState, originalReplaceState);

    window.removeEventListener('pagehide', teardown);

    document.removeEventListener('visibilitychange', handleVisibilityChange);
    document.removeEventListener('focusin', handleFieldFocus);
    isExtensionActive = false;
  }

  window.addEventListener('pagehide', teardown);

  browser.runtime.onMessage.addListener(
    (
      message: unknown,
      // Only `id` is needed for the same-extension guard; the full wxt
      // MessageSender (with `tab`) is intentionally not referenced here.
      sender: { id?: string; url?: string },
      sendResponse: (r: unknown) => void
    ) => {
      // Content-script spoofing guard: same-extension sender check + an
      // allowlist of the message types this script actually handles. Other
      // extensions can message this content script directly (web pages
      // cannot); without both checks any of them could trigger the
      // signup/autofill flows here - or feed attacker-controlled
      // credentials / OTPs into forms - in every tab this script runs on.
      if (!isTrustedContentScriptMessage(message, sender.id, browser.runtime.id)) {
        return false;
      }
      const runtimeMessage = message as Record<string, unknown>;
      if (runtimeMessage.type === 'startSignup') {
        if (!hasAuthSurface()) return false;
        (async () => {
          try {
            // Check if current domain is blocked from autofill
            const currentDomain = window.location.hostname;
            const privacy = await refreshSitePrivacySettings();
            if (!privacy.formScanning || (await isDomainBlocked(currentDomain))) {
              const result = {
                success: false,
                filledFields: [],
                skippedFields: [],
                reason: 'blocked' as const,
              };
              await showAutofillResultFeedback(document.body, result);
              sendResponse({ ...result, error: 'autofill_blocked' });
              return;
            }

            const challenge = detectHumanVerification();
            if (challenge.detected) {
              const result = {
                success: false,
                filledFields: [],
                skippedFields: [],
                reason: 'verification_required' as const,
              };
              await showAutofillResultFeedback(document.body, result);
              sendResponse({ ...result, error: 'verification_required' });
              return;
            }

            // Same threshold as the injected field icons so the shortcut,
            // badge and on-page controls agree on autofillability.
            const form = await findSignupForm(30);
            if (!form) {
              const result = {
                success: false,
                filledFields: [],
                skippedFields: [],
                reason: 'no_form' as const,
              };
              await showAutofillResultFeedback(document.body, result);
              sendResponse({ ...result, error: 'no_form' });
              return;
            }

            // Load selected identity from storage
            const { identities = [], selectedIdentityId } = (await getStorageViaBg([
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

            // "Fill with this email" (extension UI) - when provided it takes
            // precedence over the identity profile's preferredEmail; without
            // it the fill falls back to the selected identity as before.
            const requestedEmail =
              typeof runtimeMessage.email === 'string' ? runtimeMessage.email.trim() : '';
            const result = await fillSignupForm(
              form,
              updateAndCopyCredentials,
              selectedIdentity,
              undefined,
              { email: requestedEmail || undefined }
            );
            await showAutofillResultFeedback(form, result);
            sendResponse({
              ...result,
              error: result.success ? undefined : result.reason || 'fill_failed',
            });
          } catch (error: unknown) {
            logError('Error during signup process', error);
            sendResponse({ success: false, error: 'fill_error' });
          }
        })();
        // The fill operation is asynchronous; keep the message channel open
        // until one of the branches above reports its actual result.
        return true;
      }

      if (runtimeMessage.type === 'fillOTP') {
        (async () => {
          try {
            const currentDomain = window.location.hostname;
            const privacy = await refreshSitePrivacySettings();
            if (!privacy.otpDetection) {
              sendResponse({ success: true, handled: false, reason: 'site_disabled' });
              return;
            }
            if (await isDomainBlocked(currentDomain)) {
              sendResponse({ success: true, handled: false, reason: 'blocked' });
              return;
            }

            const otp = typeof runtimeMessage.otp === 'string' ? runtimeMessage.otp : '';
            if (!otp) {
              sendResponse({ success: false, handled: false, reason: 'invalid_otp' });
              return;
            }
            const sender = typeof runtimeMessage.sender === 'string' ? runtimeMessage.sender : '';
            const subject =
              typeof runtimeMessage.subject === 'string' ? runtimeMessage.subject : '';
            const recipient =
              typeof runtimeMessage.recipient === 'string' ? runtimeMessage.recipient : '';

            // An open wait panel is a one-shot request, but its recipient check
            // alone cannot prove that the code belongs to this page's service.
            const waitPanel = getActiveWaitOtpPanel();
            const tabRelated = isTabRelatedToOtp(currentDomain, sender);
            if (waitPanel) {
              if (!tabRelated) {
                sendResponse({ success: true, handled: false, reason: 'unrelated_tab' });
                return;
              }
              const handled = await waitPanel.notifyOtp(otp, { sender, subject, recipient });
              sendResponse({
                success: true,
                handled,
                reason: handled ? undefined : 'panel_rejected',
              });
              return;
            }

            // Verify the current site is opted-in for OTP auto-fill (defaults to off).
            // Guarded reader: a corrupt list degrades to NOT opted in - the default
            // - rather than throwing inside the fillOTP handler (a throw here was
            // caught upstream and misreported as 'fill_error'), and non-string
            // entries never survive it.
            const optInEntries = await readOtpOptInList();
            // Same normalizer + directional suffix rule as the background
            // otpOptIn gate (message-handler isOtpOptedInForContentSender):
            // an opt-in for example.com covers its subdomains; a subdomain
            // never authorizes the parent. The old exact-equality compare
            // with a broken /^www\\./ literal never stripped www at all.
            const isOptedIn = optInEntries.some((entry) =>
              hostMatchesDomainScope(currentDomain, entry)
            );
            if (!isOptedIn) {
              sendResponse({ success: true, handled: false, reason: 'not_opted_in' });
              return;
            }

            if (!tabRelated) {
              sendResponse({ success: true, handled: false, reason: 'unrelated_tab' });
              return;
            }

            await fillOtp(otp);
            sendResponse({ success: true, handled: true });
          } catch (error: unknown) {
            logError('Error filling OTP', error);
            sendResponse({ success: false, handled: false, reason: 'fill_failed' });
          }
        })();
        return true;
      }

      if (runtimeMessage.type === 'ping') {
        sendResponse({ ok: true });
        return true;
      }

      // Diagnostics (dev builds): hand the tab's perf marks to the SW so the
      // report can merge every context into one view.
      if (runtimeMessage.type === 'collectPerfMarks') {
        void (async () => {
          try {
            const { getPerfReport, getMessageCountReport } = await import(
              '@/utils/perf/perf-marks.js'
            );
            sendResponse({ ok: true, marks: getPerfReport(), counts: getMessageCountReport() });
          } catch {
            sendResponse({ ok: false });
          }
        })();
        return true;
      }

      if (runtimeMessage.type === 'checkFormDetected') {
        if (!hasAuthSurface()) {
          sendResponse({
            formDetected: false,
            verificationRequired: detectHumanVerification().detected,
          });
          return false;
        }
        (async () => {
          try {
            const privacy = await refreshSitePrivacySettings();
            if (!privacy.formScanning) {
              sendResponse({ formDetected: false, disabled: true });
              void sendMessageViaBg({ type: 'formPresence', formDetected: false });
              return;
            }
            // A blocked site must not advertise autofill availability through
            // the background AF badge or diagnostics form check.
            if (await isDomainBlocked(window.location.hostname)) {
              sendResponse({ formDetected: false, blocked: true });
              return;
            }
            // Align with the injected controls (field icons use minScore 30).
            const form = await findSignupForm(30);
            const detected = !!form;
            sendResponse({
              formDetected: detected,
              verificationRequired: detectHumanVerification().detected,
            });
            // Best-effort presence ping - the bridge logs and swallows failures.
            void sendMessageViaBg({ type: 'formPresence', formDetected: detected });
          } catch (error: unknown) {
            logError('Error checking whether a signup form is present', error);
            sendResponse({ formDetected: false });
          }
        })();
        return true;
      }

      if (runtimeMessage.type === 'rescanForms') {
        if (!hasAuthSurface()) return false;
        (async () => {
          try {
            clearInjectedUi();
            const privacy = await refreshSitePrivacySettings();
            if (!privacy.formScanning) {
              sendResponse({ ok: true, formDetected: false, disabled: true });
              void sendMessageViaBg({ type: 'formPresence', formDetected: false });
              return;
            }
            if (await isDomainBlocked(window.location.hostname)) {
              sendResponse({ ok: true, formDetected: false, blocked: true });
              return;
            }
            await scanForFormsAndInjectButtons();
            const form = await findSignupForm(30);
            sendResponse({ ok: true, formDetected: !!form });
            // Best-effort presence ping - the bridge logs and swallows failures.
            void sendMessageViaBg({ type: 'formPresence', formDetected: !!form });
          } catch (error: unknown) {
            logError('rescanForms failed', error);
            sendResponse({ ok: false, formDetected: false });
          }
        })();
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
            if (
              typeof cred.domain !== 'string' ||
              !hostMatchesDomainScope(window.location.hostname, cred.domain)
            ) {
              sendResponse({ success: false, error: 'credential_domain_mismatch' });
              return;
            }
            const privacy = await refreshSitePrivacySettings();
            if (!privacy.formScanning || (await isDomainBlocked(window.location.hostname))) {
              sendResponse({ success: false, error: 'autofill_blocked' });
              return;
            }
            const form = await findSignupForm(30);
            if (!form) {
              sendResponse({ success: false, error: 'no_form' });
              return;
            }
            const result = await fillSignupForm(form, async () => {}, undefined, {
              email: String(cred.email || ''),
              password: String(cred.password || ''),
              username: (cred.username as string | null | undefined) ?? null,
              name: (cred.name as string | null | undefined) ?? null,
              phone: (cred.phone as string | null | undefined) ?? null,
              website: (cred.website as string | null | undefined) ?? null,
            });
            await showAutofillResultFeedback(form, result);
            sendResponse({
              ...result,
              error: result.success ? undefined : result.reason || 'fill_failed',
            });
          } catch (e) {
            logError('refillSavedLogin error', e);
            sendResponse({ success: false });
          }
        })();
        return true;
      }

      if (runtimeMessage.type === 'autofillBlocklistChanged') {
        window.dispatchEvent(new CustomEvent('autofill-blocklist-changed'));
        void (async () => {
          try {
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
          } catch (error: unknown) {
            logError('Failed to apply autofill blocklist update', error);
          }
        })();
        // Fire-and-forget: no response is produced, so do NOT return true
        // (keeps the channel open and hangs the background's awaited
        // tabs.sendMessage while the tab stays alive).
        return false;
      }

      if (runtimeMessage.type === 'sitePrivacySettingsChanged') {
        invalidateSitePrivacySettingsCache();
        invalidateCachedSitePrivacySettings();
        window.dispatchEvent(new CustomEvent('site-privacy-settings-changed'));
        void (async () => {
          const privacy = await refreshSitePrivacySettings();
          if (!privacy.otpDetection) {
            stopMultiStepOtpWatch();
            dismissWaitOtpPanel();
          }
          if (!privacy.formScanning) {
            clearInjectedUi();
            scanForDisposableHints();
            void sendMessageViaBg({ type: 'formPresence', formDetected: false });
          } else {
            scheduleScan(0);
            scheduleDisposableScan();
          }
        })();
        return false;
      }
    }
  );
}
