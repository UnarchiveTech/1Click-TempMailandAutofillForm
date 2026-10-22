import {
  generateIdentityViaBg,
  getStorageViaBg,
  sendMessageViaBg,
} from '@/utils/content/content-bg-bridge.js';
import { getCachedSitePrivacySettingsOrDisabled } from '@/utils/content/site-privacy-settings.js';
import { t } from '@/utils/i18n/content-i18n.js';
import { logError } from '@/utils/logger.js';
import { trustedClick } from '@/utils/security/dom-guard.js';
import type { CredentialsHistoryItem } from '@/utils/types.js';
import { CONTENT_Z } from '@/utils/ui/portal-layers.js';
import { responsiveButtonLayout } from '@/utils/ui/responsive-button-layout.js';
import { trackElementPosition } from '../dom/positioning.js';
import { getOrCreateShadowRoot } from '../dom/shadow-dom.js';
import { showTooltip } from '../dom/tooltip.js';
import { isFillableField } from './fillable.js';
import {
  acceptsUsername,
  findUsernameRejection,
  proposeUsername,
  type UsernameRejection,
} from './username-recovery-model.js';

// One recovery per filled form. Cleared on runtime teardown, pagehide, detach,
// replacement fill or after five minutes; no observers survive their owner.
const recoveries = new Map<ParentNode, () => void>();
export function clearUsernameRecoveries(): void {
  for (const stop of recoveries.values()) stop();
  recoveries.clear();
}

interface UsernameRecoveryOptions {
  root: ParentNode;
  input: HTMLInputElement;
  credentialId: string;
  domain: string;
  savedUsername: string;
  fill: (input: HTMLInputElement, value: string) => boolean;
}

/** A server-rendered rejection can reload the document. Resume only a matching
 * recent pending signup, with its existing ID; never regenerate on load. */
export async function resumeUsernameRecovery(
  root: ParentNode,
  input: HTMLInputElement | null,
  fill: UsernameRecoveryOptions['fill']
): Promise<boolean> {
  if (
    !input ||
    recoveries.has(root) ||
    !getCachedSitePrivacySettingsOrDisabled().formScanning ||
    !findUsernameRejection(input)
  )
    return false;
  const value = input.value;
  const domain = location.hostname;
  const data = await getStorageViaBg(['loginInfo']);
  const records: CredentialsHistoryItem[] = Array.isArray(data?.loginInfo) ? data.loginInfo : [];
  const now = Date.now();
  const matching = records
    .filter(
      (record) =>
        record &&
        typeof record.id === 'string' &&
        record.id &&
        record.domain === domain &&
        record.username === value &&
        !record.verified &&
        ['pending_submit', 'submitted', 'failed', 'undetected'].includes(
          record.signupStatus || ''
        ) &&
        Number.isFinite(record.timestamp) &&
        now - record.timestamp >= 0 &&
        now - record.timestamp < 5 * 60_000
    )
    .sort((a, b) => b.timestamp - a.timestamp)[0];
  if (
    !matching?.id ||
    recoveries.has(root) ||
    !input.isConnected ||
    !root.contains(input) ||
    input.value !== value ||
    !getCachedSitePrivacySettingsOrDisabled().formScanning ||
    !findUsernameRejection(input)
  )
    return false;
  startUsernameRecovery({
    root,
    input,
    fill,
    credentialId: matching.id,
    domain,
    savedUsername: value,
  });
  return true;
}

/** User-controlled recovery: never submit, replace email/password, or retry a site request. */
export function startUsernameRecovery(options: UsernameRecoveryOptions): () => void {
  recoveries.get(options.root)?.();
  const { root, credentialId, domain, fill } = options;
  let input = options.input;
  const fieldId = input.id;
  const fieldName = input.name;
  let savedUsername = options.savedUsername;
  let stopped = false;
  let generation = 0;
  let internalFill = false;
  let panel: HTMLDivElement | null = null;
  let panelReason: UsernameRejection | null = null;
  let panelValue = '';
  let panelCleanup: (() => void) | null = null;
  let suppressedValue: string | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let checkTimer: ReturnType<typeof setTimeout> | undefined;
  let saveQueue = Promise.resolve();
  const rejected = new Set<string>();
  const expiresAt = Date.now() + 5 * 60_000;

  function resolveInput(): boolean {
    if (!getCachedSitePrivacySettingsOrDisabled().formScanning) return false;
    if (!input.isConnected || !root.contains(input)) {
      if (!fieldId && !fieldName) return false;
      const replacement = Array.from(root.querySelectorAll<HTMLInputElement>('input')).find(
        (field) =>
          (fieldId ? field.id === fieldId : field.name === fieldName) &&
          ['text', 'search', ''].includes(field.type) &&
          !field.disabled &&
          !field.readOnly
      );
      if (!replacement) return false;
      dismiss();
      input = replacement;
    }
    return ['text', 'search', ''].includes(input.type) && isFillableField(input);
  }

  function dismiss(): void {
    generation++;
    panelCleanup?.();
    panelCleanup = null;
    panel?.remove();
    panel = null;
    panelReason = null;
  }

  async function warnSavingFailed(): Promise<void> {
    if (!stopped && input.isConnected) {
      await showTooltip(input, await t('contentAutofill.usernameUpdateFailed'), true);
    }
  }

  function persist(): void {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = undefined;
    if (stopped || !resolveInput() || !acceptsUsername(input, input.value)) return;
    const value = input.value;
    // Serialize compare-and-set writes so late keystrokes cannot overwrite a
    // newer value, and a concurrent delete/edit never restores an old snapshot.
    saveQueue = saveQueue
      .then(async () => {
        if (value === savedUsername) return;
        const response = await sendMessageViaBg<{ success?: boolean }>({
          type: 'updatePendingSignupUsername',
          credentialId,
          domain,
          expectedUsername: savedUsername,
          username: value,
        });
        if (!response?.success) {
          await warnSavingFailed();
          return;
        }
        savedUsername = value;
      })
      .catch(async (error: unknown) => {
        logError('Failed to update pending signup username', error);
        await warnSavingFailed().catch((feedbackError: unknown) => {
          logError('Could not show username recovery save error', feedbackError);
        });
      });
  }

  async function showPrompt(): Promise<void> {
    if (stopped || !resolveInput()) return;
    const value = input.value;
    const reason = findUsernameRejection(input);
    if (!reason || suppressedValue === value) {
      if (!reason) dismiss();
      return;
    }
    if (panel && panelReason === reason && panelValue === value) return;
    dismiss();
    const ticket = ++generation;
    const [takenText, invalidText, editText, generateText, closeText, unavailableText] =
      await Promise.all([
        t('contentAutofill.usernameTaken'),
        t('contentAutofill.usernameInvalid'),
        t('contentAutofill.editUsername'),
        t('contentAutofill.generateAnotherUsername'),
        t('common.close'),
        t('contentAutofill.usernameGenerationUnavailable'),
      ]);
    if (
      stopped ||
      ticket !== generation ||
      !resolveInput() ||
      input.value !== value ||
      findUsernameRejection(input) !== reason
    )
      return;
    const shadow = getOrCreateShadowRoot();
    if (!shadow) return;
    const surface = document.createElement('div');
    surface.style.cssText = `position:fixed;z-index:${CONTENT_Z.popup};pointer-events:auto;width:min(360px,calc(100vw - 24px));box-sizing:border-box;padding:16px;border:1px solid var(--md-outline-variant);border-radius:16px;background:var(--md-surface-container);color:var(--md-on-surface);box-shadow:0 4px 16px #0003;font:400 14px/20px sans-serif;`;
    surface.setAttribute('role', 'region');
    surface.setAttribute('aria-label', reason === 'taken' ? takenText : invalidText);
    const style = document.createElement('style');
    style.textContent = `
      .username-recovery-actions {display:flex;gap:12px;margin-top:12px;}
      .username-recovery-actions button {position:relative;display:inline-flex;align-items:center;justify-content:center;min-width:0;height:40px;padding:0 16px;border:0;border-radius:20px;cursor:pointer;font:500 14px/20px sans-serif;color:var(--md-on-secondary-container);background:var(--md-secondary-container);}
      .username-recovery-actions button::after {content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:currentColor;opacity:0;}
      .username-recovery-actions button:hover::after {opacity:.08;}
      .username-recovery-actions button:active::after {opacity:.12;}
      .username-recovery-actions button:focus-visible {outline:2px solid var(--md-primary);outline-offset:2px;}
      .username-recovery-actions button:disabled {opacity:.38;cursor:default;}
      .username-recovery-actions button[data-primary] {color:var(--md-on-primary);background:var(--md-primary);}
    `;
    surface.appendChild(style);
    const message = document.createElement('p');
    message.style.cssText = 'margin:0;padding-inline-end:28px;';
    message.setAttribute('role', 'status');
    message.textContent = reason === 'taken' ? takenText : invalidText;
    surface.appendChild(message);
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', closeText);
    close.style.cssText =
      'position:absolute;top:4px;inset-inline-end:4px;width:40px;height:40px;border:0;border-radius:50%;background:transparent;color:inherit;font-size:24px;cursor:pointer;';
    close.addEventListener(
      'click',
      trustedClick((event) => {
        event.preventDefault();
        event.stopPropagation();
        suppressedValue = value;
        dismiss();
      })
    );
    surface.appendChild(close);
    const row = document.createElement('div');
    row.className = 'username-recovery-actions';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.textContent = editText;
    edit.addEventListener(
      'click',
      trustedClick((event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!resolveInput()) return;
        suppressedValue = input.value;
        dismiss();
        input.focus();
        input.select();
      })
    );
    row.appendChild(edit);
    if (reason === 'taken') {
      rejected.add(value.toLowerCase());
      const generate = document.createElement('button');
      generate.type = 'button';
      generate.textContent = generateText;
      generate.dataset.primary = '';
      generate.addEventListener(
        'click',
        trustedClick(async (event) => {
          event.preventDefault();
          event.stopPropagation();
          const target = input;
          const before = input.value;
          const actionTicket = generation;
          generate.disabled = true;
          try {
            const base = await generateIdentityViaBg('username');
            if (
              stopped ||
              actionTicket !== generation ||
              !resolveInput() ||
              input !== target ||
              input.value !== before
            )
              return;
            const candidate = proposeUsername(input, base, rejected);
            if (!candidate) {
              message.textContent = unavailableText;
              return;
            }
            internalFill = true;
            try {
              if (!fill(input, candidate) || input.value !== candidate) {
                message.textContent = unavailableText;
                return;
              }
            } finally {
              internalFill = false;
            }
            suppressedValue = candidate;
            dismiss();
            persist();
            input.focus();
          } catch (error: unknown) {
            logError('Failed to generate replacement username', error);
            message.textContent = unavailableText;
          } finally {
            generate.disabled = false;
          }
        })
      );
      row.appendChild(generate);
    }
    surface.appendChild(row);
    shadow.appendChild(surface);
    panel = surface;
    panelReason = reason;
    panelValue = value;
    const fit = responsiveButtonLayout(row, { tier: 'S' });
    const tracker = trackElementPosition(
      surface,
      input,
      (rect) => ({
        top:
          rect.bottom + surface.offsetHeight + 8 <= window.innerHeight
            ? rect.bottom + 8
            : Math.max(8, rect.top - surface.offsetHeight - 8),
        left: Math.max(12, Math.min(rect.left, window.innerWidth - surface.offsetWidth - 12)),
        visible: true,
      }),
      []
    );
    panelCleanup = () => {
      tracker.cleanup();
      fit.destroy();
    };
  }

  function scheduleCheck(): void {
    if (checkTimer || stopped) return;
    checkTimer = setTimeout(() => {
      checkTimer = undefined;
      void showPrompt().catch((error: unknown) =>
        logError('Username recovery prompt failed', error)
      );
    }, 80);
  }
  function onInput(event: Event): void {
    if ((!event.isTrusted && !internalFill) || event.target !== input) return;
    suppressedValue = input.value;
    dismiss();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 250);
  }
  function onChange(event: Event): void {
    if (event.isTrusted && event.target === input) persist();
  }
  function onSubmit(event: Event): void {
    if (event.isTrusted) persist();
  }
  function onEscape(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !panel) return;
    event.preventDefault();
    event.stopPropagation();
    suppressedValue = input.value;
    dismiss();
    input.focus();
  }
  const observer = new MutationObserver((records) => {
    // Frameworks may replace the field and its error in one DOM batch. Resolve
    // the live input before checking its associated error IDs; a detached
    // input's root cannot find the new error and would retain dismissal state.
    resolveInput();
    // A fresh server error after editing can refer to the new value again.
    const relatedIds =
      `${input.getAttribute('aria-errormessage') || ''} ${input.getAttribute('aria-describedby') || ''}`
        .split(/\s+/)
        .filter(Boolean);
    const inputRoot = input.getRootNode() as Document | ShadowRoot;
    const container = input.parentElement;
    const localContainer =
      container &&
      container.querySelectorAll('input:not([type="hidden"]),select,textarea').length === 1
        ? container
        : null;
    if (
      records.some(
        (record) =>
          record.target === input ||
          localContainer?.contains(record.target) ||
          relatedIds.some((id) => inputRoot.getElementById?.(id)?.contains(record.target))
      )
    ) {
      suppressedValue = null;
    }
    scheduleCheck();
  });
  observer.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['aria-invalid', 'aria-describedby', 'aria-errormessage', 'hidden'],
  });
  root.addEventListener('input', onInput, true);
  root.addEventListener('change', onChange, true);
  root.addEventListener('submit', onSubmit, true);
  document.addEventListener('keydown', onEscape, true);
  const interval = setInterval(() => {
    if (Date.now() >= expiresAt || !resolveInput()) stop();
    else scheduleCheck();
  }, 1000);
  function stop(): void {
    if (stopped) return;
    // Flush the last edit before a normal navigation/teardown loses the field.
    if (saveTimer) persist();
    stopped = true;
    dismiss();
    observer.disconnect();
    clearInterval(interval);
    if (saveTimer) clearTimeout(saveTimer);
    if (checkTimer) clearTimeout(checkTimer);
    root.removeEventListener('input', onInput, true);
    root.removeEventListener('change', onChange, true);
    root.removeEventListener('submit', onSubmit, true);
    document.removeEventListener('keydown', onEscape, true);
    window.removeEventListener('pagehide', stop);
    if (recoveries.get(root) === stop) recoveries.delete(root);
  }
  window.addEventListener('pagehide', stop);
  recoveries.set(root, stop);
  scheduleCheck();
  return stop;
}
