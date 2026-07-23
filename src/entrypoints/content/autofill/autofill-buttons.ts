/**
 * Autofill button injection and removal.
 */

import { browser } from 'wxt/browser';
import type { ReusableCredential } from '@/features/login-info/login-crypto.js';
import { BUTTON_OPACITY_DEFAULT, BUTTON_OPACITY_HOVER } from '@/utils/constants.js';
import { t } from '@/utils/i18n-utils.js';
import { logError, logWarn } from '@/utils/logger.js';
import {
  positionAfterElement,
  positionAtEndOfField,
  trackElementPosition,
} from '../dom/positioning.js';
import {
  BUTTON_CLASS,
  CONTAINER_CLASS,
  getOrCreateShadowRoot,
  POPUP_CLASS,
} from '../dom/shadow-dom.js';
import { showConflictChip, showFillMicroStatus, showTooltip } from '../dom/tooltip.js';
import { scoreSignupForm } from './form-detector.js';
import {
  type AutofillBlockReason,
  fillAllEmailFields,
  fillInputValue,
  fillSignupForm,
  findAutofillAllAnchor,
  getAutofillBlockReason,
  getNamesToFill,
  getPasswordToFill,
  isEmailUsedInSavedLogins,
} from './form-filler.js';
import { generatePhoneNumber, generateUsername, generateWebsiteUrl } from './generators.js';

/** Create a new inbox via background and fill email + confirm fields. */
async function generateAndFillNewEmail(
  form: HTMLFormElement | null,
  inputField: HTMLInputElement | HTMLSelectElement,
  updateAndCopyCredentials: (creds: Record<string, string>) => Promise<void>
): Promise<boolean> {
  const { selectedProvider } = (await browser.storage.local.get('selectedProvider')) as {
    selectedProvider?: string;
  };
  const provider = selectedProvider || 'guerrilla';
  const result = (await browser.runtime.sendMessage({
    type: 'createInbox',
    provider,
  })) as {
    success?: boolean;
    address?: string;
    inbox?: { address?: string };
    error?: string | { message?: string };
  };
  const address = result?.inbox?.address || result?.address;
  if (result?.success && address) {
    fillAllEmailFields(form, address, inputField as HTMLInputElement);
    fillInputValue(inputField as HTMLInputElement, address);
    await updateAndCopyCredentials({ email: address });
    return true;
  }
  const errMsg =
    typeof result?.error === 'string'
      ? result.error
      : result?.error?.message || (await t('contentAutofill.generateFailed'));
  await showTooltip(inputField as HTMLInputElement, errMsg, true);
  return false;
}

/** Extension logo mark for in-field buttons */
const EXT_LOGO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style="pointer-events:none"><path d="M12.01 21.49L2.39 9.75C2.14 9.45 2 9.07 2 8.67V3.5c0-.83.67-1.5 1.5-1.5h17c.83 0 1.5.67 1.5 1.5v5.17c0 .4-.14.78-.39 1.08l-9.6 11.74zm-8.01-18v5.06l8 9.77 8-9.77V3.49H4zm8 11.06l-4.89-5.97h9.78L12 14.55z"/></svg>';

async function openExtensionForReason(reason: AutofillBlockReason, hint: string): Promise<void> {
  try {
    await browser.runtime.sendMessage({
      type: 'openExtensionUi',
      reason: reason || 'setup',
      hint,
    });
  } catch (e) {
    logError('Failed to open extension UI', e);
  }
}

async function ensureAutofillReady(inputField?: HTMLElement): Promise<boolean> {
  const block = await getAutofillBlockReason();
  if (!block) return true;
  const key =
    block === 'setup'
      ? 'contentAutofill.setupRequired'
      : block === 'expired'
        ? 'contentAutofill.addressExpired'
        : 'contentAutofill.noActiveAddress';
  const msg = await t(key);
  if (inputField) {
    try {
      await showTooltip(inputField as HTMLInputElement, msg, true);
    } catch {
      /* ignore */
    }
  }
  await openExtensionForReason(block, msg);
  // Flag so UI can show “return to form after setup”
  try {
    await browser.storage.session.set({
      pendingAutofillReturn: true,
      pendingAutofillUrl: typeof location !== 'undefined' ? location.href : '',
      pendingAutofillAt: Date.now(),
    });
  } catch {
    try {
      await browser.storage.local.set({
        pendingAutofillReturn: true,
        pendingAutofillUrl: typeof location !== 'undefined' ? location.href : '',
        pendingAutofillAt: Date.now(),
      });
    } catch {
      /* ignore */
    }
  }
  return false;
}

function appendSvgIcon(target: HTMLElement | null, svgMarkup: string): void {
  if (!target || !(target instanceof Element) || !target.isConnected) return;
  const voidElements = new Set(['input', 'img', 'br', 'hr', 'meta', 'link', 'embed', 'area']);
  if (voidElements.has(target.tagName.toLowerCase())) return;

  try {
    // innerHTML is more reliable across CSPs than DOMParser for tiny SVGs
    const wrap = document.createElement('span');
    wrap.style.cssText = 'display:flex;align-items:center;justify-content:center;line-height:0;';
    wrap.innerHTML = svgMarkup;
    if (wrap.firstChild) {
      target.appendChild(wrap);
      return;
    }
  } catch {
    /* fall through */
  }
  try {
    const doc = new DOMParser().parseFromString(svgMarkup, 'image/svg+xml');
    const svg = doc.documentElement;
    if (svg && svg.nodeName.toLowerCase() === 'svg' && !(svg instanceof HTMLUnknownElement)) {
      target.appendChild(document.importNode(svg, true));
      return;
    }
  } catch {
    /* ignore */
  }
  // Last resort glyph so the control is never empty
  target.textContent = '1C';
}

let activePopupInfo: {
  element: HTMLDivElement;
  cleanup: () => void;
} | null = null;

function closeActivePopup(): void {
  if (activePopupInfo) {
    if (activePopupInfo.element.parentNode) {
      activePopupInfo.element.parentNode.removeChild(activePopupInfo.element);
    }
    activePopupInfo.cleanup();
    activePopupInfo = null;
  }
}

function positionPopupBelowField(rect: DOMRect): { top: number; left: number; visible: boolean } {
  return {
    top: rect.bottom + 4,
    left: Math.max(8, rect.left),
    visible: true,
  };
}

if (typeof document !== 'undefined') {
  document.addEventListener(
    'mousedown',
    (e: MouseEvent) => {
      if (!activePopupInfo) return;
      // Closed shadow DOM retargets e.target to the host — use composedPath()
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [e.target];
      const insidePopup = path.includes(activePopupInfo.element);
      const onFieldBtn = path.some(
        (n) =>
          n instanceof Element &&
          (n.classList?.contains(BUTTON_CLASS) || n.classList?.contains(CONTAINER_CLASS))
      );
      if (insidePopup || onFieldBtn) return;
      closeActivePopup();
    },
    true
  );
}

async function showAutofillPopup(
  inputField: HTMLInputElement | HTMLSelectElement,
  form: HTMLFormElement,
  isEmail: boolean,
  isPassword: boolean,
  isPhone: boolean,
  isUsername: boolean,
  isFirstName: boolean,
  isLastName: boolean,
  isFullName: boolean,
  isWebsite: boolean,
  isCheckbox: boolean,
  isSelect: boolean,
  updateAndCopyCredentials: (creds: Record<string, string>) => Promise<void>
): Promise<void> {
  closeActivePopup();

  // Setup / live-address gate before building menu
  if (!(await ensureAutofillReady(inputField))) {
    return;
  }

  const popupDiv = document.createElement('div');
  popupDiv.className = POPUP_CLASS;
  popupDiv.style.cssText = `
    position: fixed;
    z-index: 2147483647;
    pointer-events: auto;
    background-color: var(--md-surface-container);
    border: 1px solid var(--md-outline-variant);
    border-radius: 12px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
    padding: 8px 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 13px;
    min-width: 240px;
    max-width: 320px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
  `;

  const header = document.createElement('div');
  header.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    font-weight: 600;
    color: var(--md-on-surface);
    border-bottom: 1px solid var(--md-outline-variant);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  `;
  const logoSvg =
    '<svg style="pointer-events: none; color: var(--md-primary); fill: currentColor;" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16"><path d="M12.01 21.49L2.39 9.75C2.14 9.45 2 9.07 2 8.67V3.5c0-.83.67-1.5 1.5-1.5h17c.83 0 1.5.67 1.5 1.5v5.17c0 .4-.14.78-.39 1.08l-9.6 11.74zm-8.01-18v5.06l8 9.77 8-9.77V3.49H4zm8 11.06l-4.89-5.97h9.78L12 14.55z"/></svg>';
  const headerTitle = await t('contentAutofill.popupTitle');
  header.innerHTML = `${logoSvg}<span></span>`;
  const titleSpan = header.querySelector('span');
  if (titleSpan) titleSpan.textContent = headerTitle;
  popupDiv.appendChild(header);

  const addItem = (
    label: string,
    iconSvg: string,
    onClick: () => Promise<void>,
    isHighlighted = false
  ) => {
    const item = document.createElement('button');
    item.style.cssText = `
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 16px;
      width: 100%;
      background: none;
      border: none;
      cursor: pointer;
      text-align: left;
      font-size: 13px;
      font-family: inherit;
      color: ${isHighlighted ? 'var(--md-primary)' : 'var(--md-on-surface-variant)'};
      font-weight: ${isHighlighted ? '500' : 'normal'};
      box-sizing: border-box;
      transition: background-color 0.15s;
    `;
    item.onmouseover = () => {
      item.style.backgroundColor = 'var(--md-surface-variant)';
    };
    item.onmouseout = () => {
      item.style.backgroundColor = 'transparent';
    };

    const iconSpan = document.createElement('span');
    iconSpan.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      color: ${isHighlighted ? 'var(--md-primary)' : 'var(--md-on-surface-variant)'};
      fill: currentColor;
    `;
    iconSpan.innerHTML = iconSvg;
    item.appendChild(iconSpan);

    const labelSpan = document.createElement('span');
    labelSpan.style.cssText = `
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    `;
    labelSpan.innerText = label;
    item.appendChild(labelSpan);

    item.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        await onClick();
      } catch (err) {
        logError('Popup item action error:', err);
      } finally {
        closeActivePopup();
      }
    });

    popupDiv.appendChild(item);
    return item;
  };

  // Build options list
  if (isEmail) {
    const { activeInboxId, inboxes = [] } = (await browser.storage.local.get([
      'activeInboxId',
      'inboxes',
    ])) as {
      activeInboxId?: string;
      inboxes?: Array<{
        id: string;
        address: string;
        status?: string;
        accountStatus?: string;
        expiresAt?: number;
      }>;
    };

    const now = Date.now();
    const liveInboxes = inboxes.filter((i) => {
      if (i.accountStatus === 'archived' || i.accountStatus === 'deleted') return false;
      if (i.status === 'archived' || i.status === 'deleted' || i.status === 'expired') return false;
      if (i.expiresAt && i.expiresAt > 0 && i.expiresAt <= now) return false;
      return !!i.address;
    });

    const activeInbox = liveInboxes.find((i) => i.id === activeInboxId) || liveInboxes[0] || null;

    if (activeInbox) {
      addItem(
        activeInbox.address,
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>`,
        async () => {
          if (await isEmailUsedInSavedLogins(activeInbox.address)) {
            showConflictChip(
              inputField as HTMLInputElement,
              await t('contentAutofill.emailAlreadyUsedChip')
            );
            await generateAndFillNewEmail(form, inputField, updateAndCopyCredentials);
            return;
          }
          // Always refresh email + confirm-email twins together
          fillAllEmailFields(form, activeInbox.address, inputField as HTMLInputElement);
          await updateAndCopyCredentials({ email: activeInbox.address });
        },
        true
      );
    }

    const otherInboxes = liveInboxes.filter((i) => i.id !== activeInbox?.id);
    for (const inbox of otherInboxes.slice(0, 3)) {
      addItem(
        inbox.address,
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>`,
        async () => {
          if (await isEmailUsedInSavedLogins(inbox.address)) {
            showConflictChip(
              inputField as HTMLInputElement,
              await t('contentAutofill.emailAlreadyUsedChip')
            );
            await generateAndFillNewEmail(form, inputField, updateAndCopyCredentials);
            return;
          }
          fillAllEmailFields(form, inbox.address, inputField as HTMLInputElement);
          await updateAndCopyCredentials({ email: inbox.address });
        }
      );
    }

    const hr = document.createElement('div');
    hr.style.cssText = 'height: 1px; background-color: var(--md-outline-variant); margin: 4px 0;';
    popupDiv.appendChild(hr);

    addItem(
      await t('contentAutofill.generateNewEmail'),
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>`,
      async () => {
        await generateAndFillNewEmail(form, inputField, updateAndCopyCredentials);
      }
    );
  } else if (isPassword) {
    addItem(
      await t('contentAutofill.generatePassword'),
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/></svg>`,
      async () => {
        const password = await getPasswordToFill(inputField as HTMLInputElement, form);
        fillInputValue(inputField as HTMLInputElement, password);
        // Confirm password twin fields
        try {
          const twins = form.querySelectorAll<HTMLInputElement>(
            'input[type="password"], input[name*="password" i], input[id*="password" i]'
          );
          for (const el of Array.from(twins)) fillInputValue(el, password);
        } catch {
          /* ignore */
        }
        await updateAndCopyCredentials({ password });
      },
      true
    );
  } else if (isPhone) {
    addItem(
      await t('contentAutofill.generatePhone'),
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M17 1.01L7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14z"/></svg>`,
      async () => {
        const phone = generatePhoneNumber();
        fillInputValue(inputField as HTMLInputElement, phone);
        await updateAndCopyCredentials({ phone });
      },
      true
    );
  } else if (isUsername) {
    addItem(
      await t('contentAutofill.generateUsername'),
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`,
      async () => {
        const username = generateUsername();
        fillInputValue(inputField as HTMLInputElement, username);
        await updateAndCopyCredentials({ username });
      },
      true
    );
  } else if (isFirstName || isLastName || isFullName) {
    const label = isFirstName
      ? await t('contentAutofill.fillFirstName')
      : isLastName
        ? await t('contentAutofill.fillLastName')
        : await t('contentAutofill.fillFullName');
    addItem(
      label,
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`,
      async () => {
        const names = await getNamesToFill();
        const value = isFirstName ? names.firstName : isLastName ? names.lastName : names.fullName;
        fillInputValue(inputField as HTMLInputElement, value);
        await updateAndCopyCredentials({ name: names.fullName });
      },
      true
    );
  } else if (isWebsite) {
    addItem(
      await t('contentAutofill.generateWebsite'),
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>`,
      async () => {
        const website = generateWebsiteUrl();
        fillInputValue(inputField as HTMLInputElement, website);
        await updateAndCopyCredentials({ website });
      },
      true
    );
  } else if (isSelect || isCheckbox) {
    // Generic fill via entire form for selects/checkboxes
    addItem(
      await t('contentAutofill.autofillEntireForm'),
      EXT_LOGO_SVG,
      async () => {
        if (!(await ensureAutofillReady(inputField))) return;
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
        await fillSignupForm(form, updateAndCopyCredentials, selectedIdentity);
      },
      true
    );
  }

  if (!isCheckbox && !isSelect) {
    addItem(
      await t('contentAutofill.autofillEntireForm'),
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" style="fill: currentColor;"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 8h-3v3c0 .55-.45 1-1 1s-1-.45-1-1v-3H9c-.55 0-1-.45-1-1s.45-1 1-1h3V7c0-.55.45-1 1-1s1 .45 1 1v3h3c.55 0 1 .45 1 1s-.45 1-1 1z"/></svg>`,
      async () => {
        if (!(await ensureAutofillReady(inputField))) return;
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
        const ok = await fillSignupForm(form, updateAndCopyCredentials, selectedIdentity);
        if (!ok) {
          await showTooltip(
            inputField as HTMLInputElement,
            await t('contentAutofill.generateFailed'),
            true
          );
        }
      }
    );
  }

  getOrCreateShadowRoot()?.appendChild(popupDiv);

  const { cleanup } = trackElementPosition(
    popupDiv,
    inputField as HTMLElement,
    positionPopupBelowField,
    []
  );

  activePopupInfo = {
    element: popupDiv,
    cleanup,
  };
}

export async function injectAutoFillButtons(
  form: HTMLFormElement,
  injectedButtons: HTMLElement[],
  updatePositionListeners: Array<() => void>,
  autoFillButtonsInjected: { value: boolean },
  updateAndCopyCredentials: (creds: Record<string, string>) => Promise<void>
): Promise<void> {
  if (autoFillButtonsInjected.value) return;
  removeInjectedButtons(injectedButtons, updatePositionListeners);

  // ── Disposable-identity replay for this site ────────────────────────
  // Site profile + saved logins for domain (any inbox). Best-effort.
  let replayCredential: ReusableCredential | null = null;
  try {
    const { activeInboxId } = (await browser.storage.local.get(['activeInboxId'])) as {
      activeInboxId?: string;
    };
    const response = (await browser.runtime.sendMessage({
      action: 'findSiteReplay',
      domain: window.location.hostname,
      inboxId: activeInboxId || '',
    })) as {
      found?: boolean;
      credential?: ReusableCredential;
      lastEmail?: string;
      lastInboxId?: string;
    };
    if (response?.found && response.credential) {
      replayCredential = response.credential;
    }
    // If we have a known last inbox for this site, prefer it as active for OTP wait
    if (response?.lastInboxId && response.lastInboxId !== activeInboxId) {
      try {
        await browser.storage.local.set({ activeInboxId: response.lastInboxId });
      } catch {
        /* ignore */
      }
    }
  } catch {
    // Background may not be ready, or message failed - silently fall back
  }

  const inputFields = form.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]):not([type="file"]), select, textarea, ' +
      '[name*="email" i], [id*="email" i], [name*="username" i], [id*="username" i], ' +
      '[name*="name" i], [id*="name" i], [name*="phone" i], [id*="phone" i], [name*="mobile" i], [id*="mobile" i], ' +
      '[autocomplete="email"], [autocomplete="username"], [autocomplete="tel"], [autocomplete="name"], ' +
      '[autocomplete="given-name"], [autocomplete="family-name"], [autocomplete="new-password"], [autocomplete="current-password"]'
  );

  const fieldButtonTitle = await t('contentAutofill.fieldButtonTitle');

  for (const inputField of Array.from(inputFields)) {
    const isSelect = inputField.tagName.toLowerCase() === 'select';
    const isCheckbox = !isSelect && (inputField as HTMLInputElement).type === 'checkbox';
    const isInput = !isSelect;
    const el = inputField as HTMLInputElement;
    const name = (el.name || '').toLowerCase();
    const id = (el.id || '').toLowerCase();
    const ph = (el.placeholder || '').toLowerCase();
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    const aria = (el.getAttribute('aria-label') || '').toLowerCase();
    const blob = `${name} ${id} ${ph} ${ac} ${aria}`;

    const isEmail =
      isInput &&
      (el.type === 'email' ||
        ac === 'email' ||
        ac === 'username email' ||
        /email|e-mail|mail/.test(blob));

    const isPassword =
      isInput &&
      (el.type === 'password' ||
        ac === 'new-password' ||
        ac === 'current-password' ||
        /password|passwd|pwd/.test(blob));

    const isPhone =
      isInput &&
      (el.type === 'tel' ||
        ac === 'tel' ||
        ac.startsWith('tel-') ||
        /phone|mobile|cellphone|cell/.test(blob));

    const isUsername =
      isInput &&
      !isEmail &&
      (ac === 'username' || /username|userid|user_id|login|nickname|handle/.test(blob));

    const isFirstName =
      isInput &&
      (ac === 'given-name' ||
        /firstname|first_name|fname|givenname|given-name|first name/.test(blob));

    const isLastName =
      isInput &&
      (ac === 'family-name' ||
        /lastname|last_name|lname|surname|familyname|family-name|last name/.test(blob));

    const isFullName =
      isInput &&
      !isFirstName &&
      !isLastName &&
      !isUsername &&
      (ac === 'name' ||
        /fullname|full_name|full-name|display.?name/.test(blob) ||
        (/\bname\b/.test(blob) && !/user|file|company|org|brand/.test(blob)));

    const isWebsite =
      isInput &&
      (el.type === 'url' || ac === 'url' || /website|homepage|web.?site|\burl\b/.test(blob));

    // Reserve space inside the field so the icon sits in-field (cleaner UI)
    try {
      if (isInput && !isCheckbox) {
        const el = inputField as HTMLInputElement;
        const prevPad = el.style.paddingInlineEnd || '';
        el.dataset.ocPadEnd = prevPad;
        const computed = Number.parseFloat(getComputedStyle(el).paddingInlineEnd || '0') || 0;
        el.style.paddingInlineEnd = `${Math.max(computed, 28)}px`;
      }
    } catch {
      /* ignore */
    }

    const buttonContainer = document.createElement('div');
    buttonContainer.className = CONTAINER_CLASS;
    buttonContainer.style.cssText = `
      position: fixed;
      z-index: 10000;
      pointer-events: auto;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: ${BUTTON_OPACITY_DEFAULT};
      transition: opacity 0.2s;
    `;
    buttonContainer.onmouseover = () => {
      buttonContainer.style.opacity = String(BUTTON_OPACITY_HOVER);
    };
    buttonContainer.onmouseout = () => {
      buttonContainer.style.opacity = String(BUTTON_OPACITY_DEFAULT);
    };

    // Compact in-field extension icon (transparent bg — logo only, not a solid color chip)
    const autoFillButton = document.createElement('button');
    autoFillButton.className = BUTTON_CLASS;
    autoFillButton.type = 'button';
    autoFillButton.title = fieldButtonTitle;
    autoFillButton.setAttribute('aria-label', fieldButtonTitle);
    autoFillButton.style.cssText = `
      background: transparent;
      color: var(--md-primary, #4c662b);
      border: none;
      border-radius: 4px;
      width: 22px;
      height: 22px;
      min-width: 22px;
      min-height: 22px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      padding: 0;
      box-shadow: none;
      opacity: 0.92;
    `;
    autoFillButton.onmouseover = () => {
      autoFillButton.style.opacity = '1';
      autoFillButton.style.background = 'var(--md-primary-container, rgba(76,102,43,0.12))';
    };
    autoFillButton.onmouseout = () => {
      autoFillButton.style.opacity = '0.92';
      autoFillButton.style.background = 'transparent';
    };
    autoFillButton.onmousedown = () => {
      autoFillButton.style.transform = 'scale(0.94)';
    };
    autoFillButton.onmouseup = () => {
      autoFillButton.style.transform = 'scale(1)';
    };
    appendSvgIcon(autoFillButton, EXT_LOGO_SVG);

    autoFillButton.addEventListener('click', async (event: MouseEvent) => {
      if (!event.isTrusted) {
        logWarn('Blocked synthetic click event on autofill button');
        return;
      }
      event.preventDefault();
      event.stopPropagation();

      // Toggle popup if already open for this field
      if (activePopupInfo?.element.parentNode) {
        closeActivePopup();
        return;
      }

      // Known single-value fields: fill immediately (more reliable than menu-only)
      try {
        if (isPassword) {
          const password = await getPasswordToFill(inputField as HTMLInputElement, form);
          fillInputValue(inputField as HTMLInputElement, password);
          try {
            const twins = form.querySelectorAll<HTMLInputElement>(
              'input[type="password"], input[name*="password" i], input[id*="password" i]'
            );
            for (const el of Array.from(twins)) fillInputValue(el, password);
          } catch {
            /* ignore */
          }
          await updateAndCopyCredentials({ password });
          await showTooltip(
            inputField as HTMLElement,
            await t('contentAutofill.fillSuccess'),
            false
          );
          return;
        }
        if (isPhone) {
          const phone = generatePhoneNumber();
          fillInputValue(inputField as HTMLInputElement, phone);
          await updateAndCopyCredentials({ phone });
          await showTooltip(
            inputField as HTMLElement,
            await t('contentAutofill.fillSuccess'),
            false
          );
          return;
        }
        if (isUsername) {
          const username = generateUsername();
          fillInputValue(inputField as HTMLInputElement, username);
          await updateAndCopyCredentials({ username });
          await showTooltip(
            inputField as HTMLElement,
            await t('contentAutofill.fillSuccess'),
            false
          );
          return;
        }
        if (isFirstName || isLastName || isFullName) {
          const names = await getNamesToFill();
          const value = isFirstName
            ? names.firstName
            : isLastName
              ? names.lastName
              : names.fullName;
          fillInputValue(inputField as HTMLInputElement, value);
          await updateAndCopyCredentials({ name: names.fullName });
          await showTooltip(
            inputField as HTMLElement,
            await t('contentAutofill.fillSuccess'),
            false
          );
          return;
        }
        if (isWebsite) {
          const website = generateWebsiteUrl();
          fillInputValue(inputField as HTMLInputElement, website);
          await updateAndCopyCredentials({ website });
          await showTooltip(
            inputField as HTMLElement,
            await t('contentAutofill.fillSuccess'),
            false
          );
          return;
        }
      } catch (err) {
        logError('Direct field fill failed', err);
      }

      // Email (multi-choice) / unknown / select / checkbox → menu
      await showAutofillPopup(
        inputField,
        form,
        isEmail,
        isPassword,
        isPhone,
        isUsername,
        isFirstName,
        isLastName,
        isFullName,
        isWebsite,
        isCheckbox,
        isSelect,
        updateAndCopyCredentials
      );
    });

    buttonContainer.appendChild(autoFillButton);
    trackElementPosition(
      buttonContainer,
      inputField as HTMLElement,
      positionAtEndOfField,
      updatePositionListeners
    );
    getOrCreateShadowRoot()?.appendChild(buttonContainer);
    injectedButtons.push(buttonContainer);
  }

  await addFillAllButton(
    form,
    injectedButtons,
    updatePositionListeners,
    updateAndCopyCredentials,
    replayCredential
  );
  autoFillButtonsInjected.value = true;
}

type IdentityFill = {
  id: string;
  name?: string;
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
  city?: string | null;
  state?: string | null;
  address?: string | null;
};

async function runFillAll(
  form: HTMLFormElement,
  updateAndCopyCredentials: (creds: Record<string, string>) => Promise<void>,
  identityForFill: IdentityFill | undefined,
  replayCredential: ReusableCredential | null,
  anchorEl: HTMLElement,
  onSuccessLabel?: (label: string) => void
): Promise<void> {
  if (!(await ensureAutofillReady(form))) return;

  const planDomain = typeof location !== 'undefined' ? location.hostname : '';
  let usedReplay = !!replayCredential;
  let planIdentityId: string | null = identityForFill?.id || null;
  let identity = identityForFill;
  let formScore: import('@/features/intelligence/types.js').FormScore | null = null;

  try {
    const { buildAutofillPlan } = await import('@/features/intelligence/autofill-plan.js');
    const plan = await buildAutofillPlan(form, {
      domain: planDomain,
      replayCredential,
      selectedIdentityId: identityForFill?.id,
    });
    formScore = plan.formScore;
    usedReplay = plan.useReplay && !!replayCredential;
    if (!identity && plan.identityId) {
      const { identities = [] } = (await browser.storage.local.get(['identities'])) as {
        identities?: IdentityFill[];
      };
      identity = identities.find((i) => i.id === plan.identityId);
      planIdentityId = plan.identityId;
    }
  } catch {
    /* intelligence optional */
  }

  try {
    const success = await fillSignupForm(
      form,
      updateAndCopyCredentials,
      usedReplay ? undefined : identity,
      usedReplay ? (replayCredential ?? undefined) : undefined
    );

    try {
      const { getActiveInboxMeta } = await import('@/features/intelligence/autofill-plan.js');
      const { recordAutofillOutcome } = await import('@/features/intelligence/site-memory.js');
      const meta = await getActiveInboxMeta();
      void recordAutofillOutcome({
        domain: planDomain,
        success,
        identityId: planIdentityId || identity?.id,
        inboxId: meta.inboxId,
        email: meta.address,
        formScore,
        usedReplay,
      });
    } catch {
      /* ignore memory write */
    }

    if (success && onSuccessLabel) {
      onSuccessLabel(await t('contentAutofill.reuseIdentity'));
    }
    if (success) {
      try {
        const { getActiveInboxMeta } = await import('@/features/intelligence/autofill-plan.js');
        const meta = await getActiveInboxMeta();
        const email =
          meta.address ||
          (usedReplay ? replayCredential?.email : null) ||
          identity?.preferredEmail ||
          '';
        const idName = identity?.name || '';
        const provider = meta.providerDisplay || meta.provider || '';
        const statusText = await t('contentAutofill.fillMicroStatus', {
          identity: idName || '—',
          email: email || '—',
          provider: provider || '—',
        });
        showFillMicroStatus(anchorEl, statusText);
        const { showWaitOtpPanel } = await import('../otp/wait-otp-panel.js');
        void showWaitOtpPanel({
          email: email || null,
          autoFill: true,
        });
      } catch {
        await showTooltip(anchorEl, await t('contentAutofill.fillSuccess'), false);
      }
    } else {
      await showTooltip(anchorEl, await t('contentAutofill.generateFailed'), true);
    }
  } catch (error: unknown) {
    try {
      const { recordAutofillOutcome } = await import('@/features/intelligence/site-memory.js');
      void recordAutofillOutcome({
        domain: planDomain,
        success: false,
        identityId: planIdentityId || identity?.id,
        formScore,
        usedReplay,
      });
    } catch {
      /* ignore */
    }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await showTooltip(anchorEl, errorMessage, true);
  }
}

async function addFillAllButton(
  form: HTMLFormElement,
  injectedButtons: HTMLElement[],
  updatePositionListeners: Array<() => void>,
  updateAndCopyCredentials: (creds: Record<string, string>) => Promise<void>,
  replayCredential: ReusableCredential | null
): Promise<void> {
  // Only show Autofill All on high-confidence signup forms (not every page)
  try {
    if (scoreSignupForm(form) < 55) return;
  } catch {
    return;
  }

  const buttonContainer = document.createElement('div');
  buttonContainer.className = `${CONTAINER_CLASS} fill-all-container`;
  buttonContainer.style.cssText = `
    position: fixed;
    z-index: 10000;
    pointer-events: auto;
    display: inline-flex;
    align-items: stretch;
    opacity: 0.95;
    transition: opacity 0.2s;
    border-radius: 20px;
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(0,0,0,0.18);
  `;

  const isReplay = !!replayCredential;
  const fillAllButton = document.createElement('button');
  fillAllButton.type = 'button';
  fillAllButton.className = `${BUTTON_CLASS} fill-all-button`;
  fillAllButton.title = isReplay
    ? await t('contentAutofill.reuseTitle')
    : await t('contentAutofill.fillAllTitle');
  fillAllButton.style.cssText = `
    background-color: var(--md-primary, #4c662b);
    color: var(--md-on-primary, #fff);
    border: none;
    border-radius: 0;
    padding: 7px 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 600;
    font-family: system-ui, sans-serif;
  `;
  appendSvgIcon(fillAllButton, EXT_LOGO_SVG);
  const labelSpan = document.createElement('span');
  labelSpan.textContent = isReplay
    ? await t('contentAutofill.reuseIdentity')
    : await t('contentAutofill.autofillAll');
  fillAllButton.appendChild(labelSpan);

  // Chevron opens identity picker
  const menuBtn = document.createElement('button');
  menuBtn.type = 'button';
  menuBtn.className = BUTTON_CLASS;
  menuBtn.title = await t('contentAutofill.chooseIdentity');
  menuBtn.setAttribute('aria-label', await t('contentAutofill.chooseIdentity'));
  menuBtn.style.cssText = `
    background-color: var(--md-primary, #4c662b);
    color: var(--md-on-primary, #fff);
    border: none;
    border-inline-start: 1px solid rgba(255,255,255,0.25);
    padding: 0 8px;
    cursor: pointer;
    display: flex;
    align-items: center;
    font-size: 12px;
  `;
  menuBtn.textContent = '▾';

  const setFillLabel = (text: string) => {
    labelSpan.textContent = text;
    fillAllButton.title = text;
  };

  const runWithIdentity = async (id?: IdentityFill) => {
    await runFillAll(
      form,
      updateAndCopyCredentials,
      id,
      replayCredential,
      fillAllButton,
      setFillLabel
    );
  };

  fillAllButton.addEventListener('click', async (event: MouseEvent) => {
    if (!event.isTrusted) {
      logWarn('Blocked synthetic click event on fill all button');
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    // Identity routing (sticky / domain hints / selected / default)
    try {
      const { routeIdentityForDomain } = await import('@/features/intelligence/identity-router.js');
      const { identities = [], selectedIdentityId } = (await browser.storage.local.get([
        'identities',
        'selectedIdentityId',
      ])) as { identities?: IdentityFill[]; selectedIdentityId?: string };
      const routed = await routeIdentityForDomain(
        window.location.hostname,
        identities as unknown as import('@/utils/types.js').Identity[],
        selectedIdentityId
      );
      const selected =
        (routed.identity as IdentityFill | null) ||
        identities.find((i) => i.id === selectedIdentityId) ||
        identities[0];
      // Prefer replay when available; otherwise generate with routed identity
      await runWithIdentity(replayCredential ? undefined : selected);
    } catch {
      const { identities = [], selectedIdentityId } = (await browser.storage.local.get([
        'identities',
        'selectedIdentityId',
      ])) as { identities?: IdentityFill[]; selectedIdentityId?: string };
      const selected = identities.find((i) => i.id === selectedIdentityId) || identities[0];
      await runWithIdentity(replayCredential ? undefined : selected);
    }
  });

  menuBtn.addEventListener(
    'click',
    async (event: MouseEvent) => {
      if (!event.isTrusted) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      closeActivePopup();

      const { identities = [], selectedIdentityId } = (await browser.storage.local.get([
        'identities',
        'selectedIdentityId',
      ])) as { identities?: IdentityFill[]; selectedIdentityId?: string };

      const menu = document.createElement('div');
      menu.className = POPUP_CLASS;
      menu.style.cssText = `
      position: fixed;
      z-index: 2147483647;
      min-width: 220px;
      max-width: 300px;
      max-height: min(70vh, 360px);
      overflow-y: auto;
      pointer-events: auto;
      background: var(--md-surface-container, #eeefe3);
      color: var(--md-on-surface, #1a1c16);
      border: 1px solid var(--md-outline-variant, #c5c8ba);
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.18);
      padding: 6px 0;
      font-family: system-ui, sans-serif;
      font-size: 13px;
    `;

      const addIdentityRow = (id: IdentityFill, selected: boolean) => {
        const row = document.createElement('div');
        row.style.cssText =
          'display:flex;align-items:center;gap:4px;padding:2px 6px 2px 0;width:100%;box-sizing:border-box;';
        const pick = document.createElement('button');
        pick.type = 'button';
        pick.textContent = `${selected ? '✓ ' : ''}${id.name || 'Identity'}`;
        pick.style.cssText = `
        flex:1;min-width:0;text-align:start;padding:8px 10px 8px 14px;border:0;background:transparent;
        cursor:pointer;font:inherit;color:inherit;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
      `;
        pick.onmouseover = () => {
          pick.style.background = 'var(--md-surface-variant, #e1e4d5)';
        };
        pick.onmouseout = () => {
          pick.style.background = 'transparent';
        };
        const runPick = (e: Event) => {
          e.preventDefault();
          e.stopPropagation();
          closeActivePopup();
          void browser.storage.local.set({ selectedIdentityId: id.id });
          void runWithIdentity(id);
        };
        pick.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
        pick.addEventListener('click', runPick);

        const edit = document.createElement('button');
        edit.type = 'button';
        edit.title = 'Edit';
        edit.setAttribute('aria-label', 'Edit identity');
        edit.textContent = '✎';
        edit.style.cssText = `
        flex-shrink:0;width:32px;height:32px;border:0;border-radius:8px;background:transparent;
        cursor:pointer;font-size:14px;color:inherit;display:flex;align-items:center;justify-content:center;
      `;
        edit.onmouseover = () => {
          edit.style.background = 'var(--md-surface-variant, #e1e4d5)';
        };
        edit.onmouseout = () => {
          edit.style.background = 'transparent';
        };
        edit.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
        edit.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          closeActivePopup();
          const payload = {
            openView: 'autofill',
            autofillTab: 'profiles',
            openIdentityEditId: id.id,
            openIdentityCreate: false,
          };
          void browser.storage.session.set(payload).catch(() => browser.storage.local.set(payload));
          void browser.storage.local.set(payload).catch(() => {});
          void openExtensionForReason('setup', 'edit-identity');
        });

        row.appendChild(pick);
        row.appendChild(edit);
        menu.appendChild(row);
      };

      const addRow = (text: string, onClick: () => void, bold = false) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = text;
        b.style.cssText = `
        display:block;width:100%;text-align:start;padding:10px 14px;border:0;background:transparent;
        cursor:pointer;font:inherit;color:inherit;font-weight:${bold ? '600' : '400'};
        pointer-events:auto;
      `;
        b.onmouseover = () => {
          b.style.background = 'var(--md-surface-variant, #e1e4d5)';
        };
        b.onmouseout = () => {
          b.style.background = 'transparent';
        };
        b.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
        b.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          closeActivePopup();
          onClick();
        });
        menu.appendChild(b);
      };

      addRow(
        await t('contentAutofill.autofillAll'),
        () => {
          const selected = identities.find((i) => i.id === selectedIdentityId) || identities[0];
          void runWithIdentity(selected);
        },
        true
      );

      for (const id of identities.slice(0, 12)) {
        addIdentityRow(id, id.id === selectedIdentityId);
      }

      addRow(await t('contentAutofill.createIdentity'), () => {
        const payload = {
          openView: 'autofill',
          autofillTab: 'profiles',
          openIdentityCreate: true,
          openIdentityEditId: '',
        };
        void browser.storage.session.set(payload).catch(() => browser.storage.local.set(payload));
        void browser.storage.local.set(payload).catch(() => {});
        void openExtensionForReason('setup', 'create-identity');
      });

      // Prevent document capture handler from treating menu as outside
      menu.addEventListener(
        'mousedown',
        (e) => {
          e.stopPropagation();
        },
        true
      );
      menu.addEventListener(
        'pointerdown',
        (e) => {
          e.stopPropagation();
        },
        true
      );

      getOrCreateShadowRoot()?.appendChild(menu);
      const rect = menuBtn.getBoundingClientRect();
      const menuH = Math.min(360, window.innerHeight * 0.7);
      let top = rect.bottom + 4;
      if (top + 120 > window.innerHeight) top = Math.max(8, rect.top - menuH - 4);
      menu.style.top = `${top}px`;
      menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 240))}px`;
      activePopupInfo = {
        element: menu,
        cleanup: () => {},
      };
    },
    true
  );

  // Wait for OTP — one-click panel (also auto-opens after successful fill)
  const waitOtpBtn = document.createElement('button');
  waitOtpBtn.type = 'button';
  waitOtpBtn.className = BUTTON_CLASS;
  waitOtpBtn.title = await t('contentAutofill.waitForOtpTitle');
  waitOtpBtn.style.cssText = `
    background-color: var(--md-secondary-container, #dce7c8);
    color: var(--md-on-secondary-container, #404a33);
    border: none;
    border-inline-start: 1px solid rgba(0,0,0,0.08);
    padding: 7px 10px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    font-weight: 600;
    font-family: system-ui, sans-serif;
    white-space: nowrap;
  `;
  waitOtpBtn.textContent = await t('contentAutofill.waitForOtpShort');
  waitOtpBtn.addEventListener('click', async (event: MouseEvent) => {
    if (!event.isTrusted) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      const { showWaitOtpPanel } = await import('../otp/wait-otp-panel.js');
      const { getActiveInboxMeta } = await import('@/features/intelligence/autofill-plan.js');
      const meta = await getActiveInboxMeta();
      await showWaitOtpPanel({
        email: meta.address || replayCredential?.email || null,
        autoFill: true,
      });
    } catch {
      /* ignore */
    }
  });

  buttonContainer.appendChild(fillAllButton);
  buttonContainer.appendChild(menuBtn);
  buttonContainer.appendChild(waitOtpBtn);

  // Place after create-account heading / first field (not floating at random form coords)
  const anchor = findAutofillAllAnchor(form);
  trackElementPosition(buttonContainer, anchor, positionAfterElement, updatePositionListeners);

  getOrCreateShadowRoot()?.appendChild(buttonContainer);
  injectedButtons.push(buttonContainer);
}

export function removeInjectedButtons(
  injectedButtons: HTMLElement[],
  updatePositionListeners: Array<() => void>
): void {
  closeActivePopup();
  updatePositionListeners.forEach((cleanup) => {
    void cleanup();
  });
  updatePositionListeners.length = 0;

  injectedButtons.forEach((button: HTMLElement) => {
    if (button.parentNode) button.parentNode.removeChild(button);
  });
  injectedButtons.length = 0;
}
