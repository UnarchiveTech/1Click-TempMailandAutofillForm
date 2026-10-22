/**
 * Autofill button injection and removal.
 */

import { buildAutofillPlan } from '@/features/intelligence/autofill-plan.js';
import { createFreshAddress, watchEmailConflict } from '@/features/intelligence/conflict-watch.js';
import { type DryRunRow, showDryRunPreview } from '@/features/intelligence/dry-run.js';
import { maybeHumanDelay } from '@/features/intelligence/fill-timing.js';
import {
  armSignupOutcomeAfterSubmit,
  clickPrimaryAction,
  hasAutoSubmitConsent,
} from '@/features/intelligence/submit-action.js';
import { getFormUndoStack } from '@/features/intelligence/undo-stack.js';
import type { ReusableCredential } from '@/features/login-info/saved-login-credentials.js';
import {
  beginSignupAttemptViaBg,
  copySiteCredentialPasswordViaBg,
  detectWizardStepFromPage,
  generateIdentityViaBg,
  getActiveAddressMetaViaBg,
  getIconSvgViaBg,
  getStorageViaBg,
  isSiteEmailAllowedViaBg,
  loadSmartAutofillSettingsViaBg,
  pickFreshestIdentityViaBg,
  recordAutofillFailureViaBg,
  recordAutofillOutcomeViaBg,
  recordAutofillSuccessViaBg,
  routeIdentityForDomainViaBg,
  sendMessageViaBg,
  setFieldMapCorrectionViaBg,
  setStorageViaBg,
  upsertWizardSessionViaBg,
} from '@/utils/content/content-bg-bridge.js';
import { BUTTON_OPACITY_DEFAULT, BUTTON_OPACITY_HOVER } from '@/utils/content/content-constants.js';
import { getCachedSitePrivacySettingsOrDisabled } from '@/utils/content/site-privacy-settings.js';
import { t } from '@/utils/i18n/content-i18n.js';
import { logError, logWarn } from '@/utils/logger.js';
import { trustedClick } from '@/utils/security/dom-guard.js';
import {
  safeAccessibleName,
  safeId,
  safeName,
  safePlaceholder,
} from '@/utils/security/dom-safe.js';
import type { AddressStatus } from '@/utils/types.js';
import { CONTENT_Z } from '@/utils/ui/portal-layers.js';
import { responsiveButtonLayout } from '@/utils/ui/responsive-button-layout.js';
import {
  createToolbarPositioner,
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
import { startMultiStepOtpWatch } from '../otp/multi-step-otp.js';
import { showWaitOtpPanel } from '../otp/wait-otp-panel.js';
import {
  type AutofillAddressLike,
  arrayOrEmpty,
  isLiveMailboxAddress,
} from '../shared/address-liveness.js';
import { readLoginInfo, readSelectedProvider } from '../shared/storage-reads.js';
import {
  classifyFormIntent,
  isSigninForm,
  isSignupForm,
  scoreSignupForm,
} from './form-detector.js';
import {
  type AutofillBlockReason,
  type AutofillPreviewKind,
  fillAllEmailFields,
  fillInputValue,
  fillSignupForm,
  findAutofillAllAnchor,
  findUnusedLiveAddress,
  getAutofillBlockReason,
  getNamesToFill,
  getPasswordToFill,
  isEmailUsedInSavedLogins,
  resolveAutofillPreviewTargets,
  showAutofillResultFeedback,
} from './form-filler.js';
import { getExternalSubmitDestination } from './submit-destination.js';

type FieldSnapshot = {
  el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  value: string;
  checked?: boolean;
};

function snapshotFormFields(form: ParentNode): FieldSnapshot[] {
  const out: FieldSnapshot[] = [];
  try {
    const fields = form.querySelectorAll<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >('input, select, textarea');
    for (const el of Array.from(fields)) {
      if ((el as HTMLInputElement).type === 'password') {
        out.push({ el, value: (el as HTMLInputElement).value || '', checked: false });
        continue;
      }
      if (
        (el as HTMLInputElement).type === 'checkbox' ||
        (el as HTMLInputElement).type === 'radio'
      ) {
        out.push({ el, value: '', checked: !!(el as HTMLInputElement).checked });
        continue;
      }
      out.push({ el, value: el.value || '' });
    }
  } catch {
    /* ignore */
  }
  return out;
}

function restoreFormFields(snap: FieldSnapshot[]): void {
  for (const s of snap) {
    try {
      if (!s.el.isConnected) continue;
      if (s.checked !== undefined && 'checked' in s.el) {
        (s.el as HTMLInputElement).checked = !!s.checked;
      } else {
        s.el.value = s.value;
      }
      s.el.dispatchEvent(new Event('input', { bubbles: true }));
      s.el.dispatchEvent(new Event('change', { bubbles: true }));
    } catch {
      /* ignore */
    }
  }
}

/** Find an existing live mailbox that has not been consumed by a saved signup. */
async function findUnusedExistingAddress(
  addresses: Array<{
    id?: string;
    address: string;
    status?: string;
    accountStatus?: AddressStatus;
    expiresAt?: number;
  }>
): Promise<string | null> {
  return findUnusedLiveAddress(addresses, await readLoginInfo())?.address || null;
}

/** Create a new inbox via background and fill email + confirm fields. */
async function generateAndFillNewEmail(
  form: HTMLElement | null,
  inputField: HTMLInputElement | HTMLSelectElement,
  updateAndCopyCredentials: (creds: Record<string, string>) => Promise<void>
): Promise<boolean> {
  // '' when unset or garbage - the background then resolves its own default.
  const selectedProvider = await readSelectedProvider();
  const result = (await sendMessageViaBg({
    // createAddress is extension-page-only (blocked for content scripts by
    // CONTENT_SCRIPT_ALLOWED_HANDLERS); the gesture-gated variant lets the
    // background open the UI and issue a token for user-interaction flows.
    type: 'createAddressWithGesture',
    // No hardcoded provider: background resolves configured default when unset.
    provider: selectedProvider,
  })) as {
    success?: boolean;
    address?: string;
    inbox?: { address?: string };
    error?: string | { message?: string };
    needsUserInteraction?: boolean;
  };
  const address = result?.inbox?.address || result?.address;
  if (result?.success && address) {
    if (!(await isSiteEmailAllowedViaBg(address))) {
      await showTooltip(
        inputField as HTMLInputElement,
        await t('errors.siteEmailUnavailable'),
        true
      );
      return false;
    }
    fillAllEmailFields(form, address, inputField as HTMLInputElement);
    fillInputValue(inputField as HTMLInputElement, address);
    await updateAndCopyCredentials({ email: address });
    return true;
  }
  const errMsg = result?.needsUserInteraction
    ? await t('disposable.openExtensionToCreate')
    : await addressCreateErrorText(typeof result?.error === 'string' ? result.error : undefined);
  await showTooltip(inputField as HTMLInputElement, errMsg, true);
  return false;
}

/**
 * Localized tooltip copy for a `createAddressWithGesture` failure. The
 * background answers with a stable `errors.*` code, so the codes worth
 * explaining are mapped here and everything else falls back to the generic
 * "could not generate" copy.
 *
 * The keys are literal on purpose: `generate-background-locales` collects them
 * into the minimal background dictionaries that the content `translate`
 * handler reads, whereas a dynamic `t(result.error)` would render the raw key.
 */
async function addressCreateErrorText(code: string | undefined): Promise<string> {
  switch (code) {
    case 'errors.siteEmailUnavailable':
      return await t('errors.siteEmailUnavailable');
    case 'errors.demoAddressLimitReached':
      return await t('errors.demoAddressLimitReached');
    case 'errors.gestureTokenInvalid':
      return await t('errors.gestureTokenInvalid');
    case 'errors.addressCreationFailed':
      return await t('errors.addressCreationFailed');
    default:
      return await t('contentAutofill.generateFailed');
  }
}

/** Extension logo mark for in-field buttons (resolved via background to keep icon-svg.ts out of content bundle). */
let _extLogoSvg: Promise<string> | null = null;
function getExtLogoSvg(): Promise<string> {
  if (!_extLogoSvg) {
    _extLogoSvg = getIconSvgViaBg('logoMark', { size: 14, color: 'currentColor' });
  }
  return _extLogoSvg;
}

async function openExtensionForReason(
  reason: AutofillBlockReason | 'create-identity' | 'edit-identity' | string,
  hint: string,
  extra?: { identityId?: string }
): Promise<void> {
  try {
    await sendMessageViaBg({
      type: 'openExtensionUi',
      reason: reason || 'setup',
      hint,
      identityId: extra?.identityId || '',
    });
  } catch (e) {
    logError('Failed to open extension UI', e);
  }
}

async function ensureAutofillReady(inputField?: HTMLElement): Promise<boolean> {
  const block = await getAutofillBlockReason();
  if (!block) return true;
  const msg =
    block === 'setup'
      ? await t('contentAutofill.setupRequired')
      : block === 'expired'
        ? await t('contentAutofill.addressExpired')
        : await t('contentAutofill.noActiveAddress');
  if (inputField) {
    try {
      await showTooltip(inputField as HTMLInputElement, msg, true);
    } catch {
      /* ignore */
    }
  }
  await openExtensionForReason(block, msg);
  // Flag so the popup can show “return to form after setup” (best-effort;
  // losing the hint only means the popup opens without the return toast). The
  // background stores it in storage.session - content scripts cannot reach
  // session storage, and a local write would never reach the session-reading
  // popup.
  try {
    await sendMessageViaBg({
      type: 'flagReturnToForm',
      url: typeof location !== 'undefined' ? location.href : '',
    });
  } catch {
    /* ignore */
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

if (typeof document !== 'undefined') {
  document.addEventListener(
    'mousedown',
    (e: MouseEvent) => {
      if (!activePopupInfo) return;
      // Closed shadow DOM retargets e.target to the host. The internal popup
      // element is therefore absent from the document-level composedPath();
      // include its shadow host so a mousedown on the pencil / create item is
      // not treated as an outside click and removed before its click handler.
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [e.target];
      const popupRoot = activePopupInfo.element.getRootNode();
      // Use the fragment node type instead of `instanceof ShadowRoot`: content
      // scripts run in isolated worlds, and constructor identity can differ
      // across browser realms even when the node is a ShadowRoot.
      const popupShadowHost =
        popupRoot.nodeType === Node.DOCUMENT_FRAGMENT_NODE ? (popupRoot as ShadowRoot).host : null;
      const insidePopup =
        path.includes(activePopupInfo.element) ||
        (!!popupShadowHost && (path.includes(popupShadowHost) || e.target === popupShadowHost));
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
  form: HTMLElement,
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
  const reduceMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  popupDiv.style.cssText = `
    position: fixed;
    z-index: ${CONTENT_Z.popup};
    pointer-events: auto;
    opacity: 0;
    transform: scale(0.98) translateY(4px);
    transform-origin: top center;
    transition: ${reduceMotion ? 'none' : 'opacity 140ms cubic-bezier(0.2, 0, 0, 1), transform 140ms cubic-bezier(0.2, 0, 0, 1)'};
    background-color: var(--md-surface-container);
    border: 1px solid var(--md-outline-variant);
    border-radius: 12px;
    box-shadow: 0 4px 20px color-mix(in srgb, var(--md-shadow) 15%, transparent);
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
  const logoSvg = await getIconSvgViaBg('logoMark', {
    size: 16,
    color: 'var(--md-primary)',
  });
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

    item.addEventListener(
      'click',
      trustedClick(async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          await onClick();
        } catch (err) {
          logError('Popup item action error:', err);
        } finally {
          closeActivePopup();
        }
      })
    );

    popupDiv.appendChild(item);
    return item;
  };

  // Build options list
  if (isEmail) {
    const { activeAddressId, addresses = [] } = (await getStorageViaBg(
      ['activeAddressId', 'addresses'],
      true
    )) as {
      activeAddressId?: string;
      addresses?: Array<{
        id: string;
        address: string;
        status?: string;
        accountStatus?: AddressStatus;
        expiresAt?: number;
      }>;
    };

    const now = Date.now();
    // Shared garbage-tolerant liveness rule (see address-liveness.ts): corrupt
    // entries and corrupt expiry values degrade to not-live, never throw.
    const liveAddresses = arrayOrEmpty<AutofillAddressLike>(addresses).filter((i) =>
      isLiveMailboxAddress(i, now)
    );

    const activeAddress =
      liveAddresses.find((i) => i.id === activeAddressId) || liveAddresses[0] || null;

    if (activeAddress) {
      addItem(
        activeAddress.address,
        await getIconSvgViaBg('mailSolid', { size: 16 }),
        async () => {
          if (!(await isSiteEmailAllowedViaBg(activeAddress.address))) {
            await showTooltip(
              inputField as HTMLInputElement,
              await t('errors.siteEmailUnavailable'),
              true
            );
            return;
          }
          if (await isEmailUsedInSavedLogins(activeAddress.address)) {
            showConflictChip(
              inputField as HTMLInputElement,
              await t('contentAutofill.emailAlreadyUsedChip')
            );
            const unusedAddress = await findUnusedExistingAddress(liveAddresses);
            if (unusedAddress && (await isSiteEmailAllowedViaBg(unusedAddress))) {
              fillAllEmailFields(form, unusedAddress, inputField as HTMLInputElement);
              await updateAndCopyCredentials({ email: unusedAddress });
            } else {
              await generateAndFillNewEmail(form, inputField, updateAndCopyCredentials);
            }
            return;
          }
          // Always refresh email + confirm-email twins together
          fillAllEmailFields(form, activeAddress.address, inputField as HTMLInputElement);
          await updateAndCopyCredentials({ email: activeAddress.address });
        },
        true
      );
    }

    const otherAddresses = liveAddresses.filter((i) => i.id !== activeAddress?.id);
    for (const record of otherAddresses.slice(0, 3)) {
      addItem(record.address, await getIconSvgViaBg('mailSolid', { size: 16 }), async () => {
        if (!(await isSiteEmailAllowedViaBg(record.address))) {
          await showTooltip(
            inputField as HTMLInputElement,
            await t('errors.siteEmailUnavailable'),
            true
          );
          return;
        }
        if (await isEmailUsedInSavedLogins(record.address)) {
          showConflictChip(
            inputField as HTMLInputElement,
            await t('contentAutofill.emailAlreadyUsedChip')
          );
          const unusedAddress = await findUnusedExistingAddress(liveAddresses);
          if (unusedAddress && (await isSiteEmailAllowedViaBg(unusedAddress))) {
            fillAllEmailFields(form, unusedAddress, inputField as HTMLInputElement);
            await updateAndCopyCredentials({ email: unusedAddress });
          } else {
            await generateAndFillNewEmail(form, inputField, updateAndCopyCredentials);
          }
          return;
        }
        fillAllEmailFields(form, record.address, inputField as HTMLInputElement);
        await updateAndCopyCredentials({ email: record.address });
      });
    }

    const hr = document.createElement('div');
    hr.style.cssText = 'height: 1px; background-color: var(--md-outline-variant); margin: 4px 0;';
    popupDiv.appendChild(hr);

    addItem(
      await t('contentAutofill.generateNewEmail'),
      await getIconSvgViaBg('plus', { size: 16 }),
      async () => {
        await generateAndFillNewEmail(form, inputField, updateAndCopyCredentials);
      }
    );
  } else if (isPassword) {
    addItem(
      await t('contentAutofill.generatePassword'),
      await getIconSvgViaBg('lock', { size: 16 }),
      async () => {
        let password: string;
        try {
          password = await getPasswordToFill(inputField as HTMLInputElement, form);
        } catch {
          // Vault locked / the custom password can't be decrypted - never fill
          // the raw stored blob. Surface the locked state like the fill path.
          showConflictChip(inputField as HTMLInputElement, await t('contentAutofill.vaultLocked'));
          return;
        }
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
      await getIconSvgViaBg('phone', { size: 16 }),
      async () => {
        const phone = await generateIdentityViaBg('phoneNumber');
        fillInputValue(inputField as HTMLInputElement, phone);
        await updateAndCopyCredentials({ phone });
      },
      true
    );
  } else if (isUsername) {
    addItem(
      await t('contentAutofill.generateUsername'),
      await getIconSvgViaBg('user', { size: 16 }),
      async () => {
        const username = await generateIdentityViaBg('username');
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
      await getIconSvgViaBg('user', { size: 16 }),
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
      await getIconSvgViaBg('globe', { size: 16 }),
      async () => {
        const website = await generateIdentityViaBg('websiteUrl');
        fillInputValue(inputField as HTMLInputElement, website);
        await updateAndCopyCredentials({ website });
      },
      true
    );
  } else if (isSelect || isCheckbox) {
    // Generic fill via entire form for selects/checkboxes
    addItem(
      await t('contentAutofill.autofillEntireForm'),
      await getExtLogoSvg(),
      async () => {
        if (!(await ensureAutofillReady(inputField))) return;
        // Corrupt storage must not throw inside a click handler: a non-array
        // `identities` would kill the fill with an unhandled TypeError. The
        // guard lives in address-liveness.ts so tests can pin it.
        const { identities: selectIdentities, selectedIdentityId } = (await getStorageViaBg([
          'identities',
          'selectedIdentityId',
        ])) as { identities?: IdentityFill[]; selectedIdentityId?: string };
        const identities = arrayOrEmpty<IdentityFill>(selectIdentities);
        const selectedIdentity = identities.find((i) => i.id === selectedIdentityId);
        const result = await fillSignupForm(form, updateAndCopyCredentials, selectedIdentity);
        await showAutofillResultFeedback(inputField as HTMLElement, result);
      },
      true
    );
  }

  if (!isCheckbox && !isSelect) {
    addItem(
      await t('contentAutofill.autofillEntireForm'),
      await getIconSvgViaBg('autofillForm', { size: 16 }),
      async () => {
        if (!(await ensureAutofillReady(inputField))) return;
        // Same corrupt-storage guard (address-liveness.ts).
        const { identities: formIdentities, selectedIdentityId } = (await getStorageViaBg([
          'identities',
          'selectedIdentityId',
        ])) as { identities?: IdentityFill[]; selectedIdentityId?: string };
        const identities = arrayOrEmpty<IdentityFill>(formIdentities);
        const selectedIdentity = identities.find((i) => i.id === selectedIdentityId);
        const result = await fillSignupForm(form, updateAndCopyCredentials, selectedIdentity);
        await showAutofillResultFeedback(inputField as HTMLElement, result);
      }
    );
  }

  getOrCreateShadowRoot()?.appendChild(popupDiv);

  // Open ABOVE the field when there is no room below the viewport - otherwise
  // the menu renders (partly) off-screen for fields near the page bottom.
  const positionPopup = (rect: DOMRect) => {
    const menuHeight = popupDiv.offsetHeight || 240;
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const flipAbove = spaceBelow < menuHeight && rect.top - 8 >= menuHeight * 0.6;
    popupDiv.style.transformOrigin = flipAbove ? 'bottom center' : 'top center';
    return {
      top: flipAbove ? Math.max(8, rect.top - menuHeight - 4) : rect.bottom + 4,
      left: Math.max(8, rect.left),
      visible: true,
    };
  };

  const { cleanup } = trackElementPosition(popupDiv, inputField as HTMLElement, positionPopup, []);

  activePopupInfo = {
    element: popupDiv,
    cleanup,
  };
  if (!reduceMotion) {
    requestAnimationFrame(() => {
      if (!popupDiv.isConnected) return;
      popupDiv.style.opacity = '1';
      popupDiv.style.transform = 'scale(1) translateY(0)';
    });
  } else {
    popupDiv.style.opacity = '1';
    popupDiv.style.transform = 'none';
  }
}

export async function injectAutoFillButtons(
  form: HTMLFormElement | HTMLElement,
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
  let replayIdentityId = '';
  let replayAddressId = '';
  try {
    const { activeAddressId } = (await getStorageViaBg(['activeAddressId'])) as {
      activeAddressId?: string;
    };
    const response = (await sendMessageViaBg({
      type: 'findSiteReplay',
      domain: window.location.hostname,
      addressId: activeAddressId || '',
    })) as {
      found?: boolean;
      credential?: ReusableCredential;
      lastEmail?: string;
      lastAddressId?: string;
      lastIdentityId?: string;
      vaultLocked?: boolean;
      hasSavedLogin?: boolean;
    };
    if (response?.found && response.credential) {
      replayCredential = response.credential;
      replayIdentityId = response.lastIdentityId || '';
      replayAddressId = response.lastAddressId || '';
    } else if (response?.vaultLocked && response.hasSavedLogin) {
      // A saved login exists for this site but the vault is locked - surface
      // it instead of silently pretending there's no replay to offer.
      try {
        void showTooltip(form, await t('contentAutofill.vaultLockedReplayHint'), true).catch(() => {
          /* non-critical: async tooltip failure (page teardown etc.) */
        });
      } catch {
        /* non-critical: sync t()/tooltip failure */
      }
    }
    // If we have a known last inbox for this site, prefer it as active for OTP wait
    if (response?.lastAddressId && response.lastAddressId !== activeAddressId) {
      try {
        await setStorageViaBg({ activeAddressId: response.lastAddressId });
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
    const name = safeName(el).toLowerCase();
    const id = safeId(el).toLowerCase();
    const ph = safePlaceholder(el).toLowerCase();
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    const aria = safeAccessibleName(el).toLowerCase();
    const blob = `${name} ${id} ${ph} ${ac} ${aria}`;

    const isEmail =
      isInput &&
      el.type !== 'password' &&
      (el.type === 'email' ||
        ac === 'email' ||
        ac === 'username email' ||
        /email|e-mail|correo|courriel|メール|邮箱/.test(blob));

    // Password ONLY when type/autocomplete/name clearly say password - never username/handle
    const isPassword =
      isInput &&
      !/user\s*name|username|userid|user_id|handle|nickname/.test(blob) &&
      (el.type === 'password' ||
        ac === 'new-password' ||
        ac === 'current-password' ||
        (/password|passwd|\bpwd\b|passcode|new-password|current-password/.test(blob) &&
          el.type !== 'email' &&
          el.type !== 'tel'));

    const isPhone =
      isInput &&
      !isEmail &&
      !isPassword &&
      (el.type === 'tel' ||
        ac === 'tel' ||
        ac.startsWith('tel-') ||
        /phone|mobile|cellphone|cell/.test(blob));

    // Real username/handle only - autocomplete=username alone is often login EMAIL
    const isUsername =
      isInput &&
      !isEmail &&
      !isPassword &&
      el.type !== 'password' &&
      el.type !== 'email' &&
      (/user\s*name|username|userid|user_id|user-name|nickname|handle|login\s*name|account\s*name/.test(
        blob
      ) ||
        (ac === 'username' &&
          /user|handle|nick|login/.test(`${name} ${id} ${ph} ${aria}`) &&
          !/email|mail|phone|mobile/.test(blob)));

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
      z-index: ${CONTENT_Z.button};
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

    // Compact in-field extension icon (transparent bg - logo only, not a solid color chip)
    const autoFillButton = document.createElement('button');
    autoFillButton.className = BUTTON_CLASS;
    autoFillButton.type = 'button';
    autoFillButton.title = fieldButtonTitle;
    autoFillButton.setAttribute('aria-label', fieldButtonTitle);
    autoFillButton.style.cssText = `
      background: transparent;
      color: var(--md-primary);
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
      autoFillButton.style.background = 'var(--md-primary-container)';
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
    appendSvgIcon(autoFillButton, await getExtLogoSvg());

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
          const phone = await generateIdentityViaBg('phoneNumber');
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
          const username = await generateIdentityViaBg('username');
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
          const website = await generateIdentityViaBg('websiteUrl');
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
    replayCredential,
    replayIdentityId,
    replayAddressId
  );
  autoFillButtonsInjected.value = true;
}

type IdentityFill = {
  id: string;
  name?: string;
  username?: string;
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
  form: HTMLFormElement | HTMLElement,
  updateAndCopyCredentials: (creds: Record<string, string>) => Promise<void>,
  identityForFill: IdentityFill | undefined,
  replayCredential: ReusableCredential | null,
  anchorEl: HTMLElement,
  onSuccessLabel: ((label: string) => void) | undefined,
  updatePositionListeners: Array<() => void>
): Promise<'fill' | 'cancel' | 'change-identity' | undefined> {
  if (!(await ensureAutofillReady(form))) return;

  const planDomain = typeof location !== 'undefined' ? location.hostname : '';
  let usedReplay = !!replayCredential;
  let planIdentityId: string | null = identityForFill?.id || null;
  let identity = identityForFill;
  let formScore: import('@/features/intelligence/types.js').FormScore | null = null;
  let fieldSelectors: Partial<Record<string, string>> | undefined;
  let reviewedEmail: string | undefined;

  // Smart settings + multi-level undo
  try {
    const smart = (await loadSmartAutofillSettingsViaBg()) as { undoStackDepth: number };
    const stack = getFormUndoStack(form, smart.undoStackDepth);
    stack.push(form, 'pre-autofill');
  } catch {
    /* optional */
  }

  // Freshness: prefer unused identity+email for generate path
  if (!replayCredential && !identity) {
    try {
      const { identities = [], addresses = [] } = (await getStorageViaBg(
        ['identities', 'addresses'],
        true
      )) as {
        identities?: IdentityFill[];
        addresses?: Array<{
          address?: string;
          accountStatus?: AddressStatus;
          expiresAt?: number;
        }>;
      };
      // Same shared liveness rule as the liveAddresses filter above.
      const live = arrayOrEmpty<AutofillAddressLike>(addresses)
        .filter((i) => isLiveMailboxAddress(i))
        .map((i) => i.address as string);
      const pick = (await pickFreshestIdentityViaBg(
        planDomain,
        identities as unknown as import('@/utils/types.js').Identity[],
        live
      )) as { identity: import('@/utils/types.js').Identity; identityId: string } | null;
      if (pick) {
        identity = pick.identity as unknown as IdentityFill;
        planIdentityId = pick.identityId;
      }
    } catch {
      /* optional */
    }
  }

  try {
    const plan = await buildAutofillPlan(form, {
      domain: planDomain,
      replayCredential,
      selectedIdentityId: identityForFill?.id || identity?.id,
    });
    formScore = plan.formScore;
    usedReplay = plan.useReplay && !!replayCredential;
    if (!identity && plan.identityId) {
      const { identities = [] } = (await getStorageViaBg(['identities'])) as {
        identities?: IdentityFill[];
      };
      identity = identities.find((i) => i.id === plan.identityId);
      planIdentityId = plan.identityId;
    }
  } catch {
    /* intelligence optional */
  }

  let submitDestination: ReturnType<typeof getExternalSubmitDestination> = null;
  try {
    if (form instanceof HTMLFormElement) submitDestination = getExternalSubmitDestination(form);
  } catch (error) {
    logWarn('Could not inspect autofill submit destination', error);
  }

  let previewEnabled = false;
  try {
    const smart = (await loadSmartAutofillSettingsViaBg()) as { dryRunPreview?: boolean } | null;
    previewEnabled = smart?.dryRunPreview === true;
  } catch {
    /* Routine preview preference is optional; destination warnings remain mandatory. */
  }

  if (previewEnabled || submitDestination) {
    try {
      const targets = await resolveAutofillPreviewTargets(form);
      const detectedTarget = (kind: AutofillPreviewKind): string =>
        (targets[kind] || [])
          .map(
            (control) =>
              safeAccessibleName(control) ||
              control.getAttribute('autocomplete') ||
              safeName(control) ||
              safeId(control) ||
              safePlaceholder(control)
          )
          .filter(Boolean)
          .join(', ');
      const meta = await getActiveAddressMetaViaBg(!usedReplay);
      const replayIdentityId = (replayCredential as { identityId?: string } | null)?.identityId;
      const requestedEmail = identity?.preferredEmail?.trim();
      const permittedPreferredEmail =
        requestedEmail &&
        requestedEmail !== '__random_active__' &&
        (await isSiteEmailAllowedViaBg(requestedEmail))
          ? requestedEmail
          : '';
      const isBuiltInDefault =
        (identity as { isDefault?: boolean } | undefined)?.isDefault === true &&
        !!identity?.id?.startsWith('default_');
      const usesRandomMailbox = requestedEmail === '__random_active__' && !isBuiltInDefault;
      const previewCredential = usedReplay ? replayCredential : null;
      const email =
        previewCredential?.email ||
        permittedPreferredEmail ||
        (usesRandomMailbox ? '' : meta?.address) ||
        (await t(
          usesRandomMailbox ? 'contentAutofill.dryRunAutoMode' : 'contentAutofill.dryRunEmpty'
        ));
      const candidates: DryRunRow[] = [
        {
          label: await t('savedLoginInfo.identity'),
          value: identity?.name || replayIdentityId || (await t('contentAutofill.dryRunEmpty')),
        },
        {
          label: await t('savedLoginInfo.email'),
          value: email,
          kind: 'email',
          target: detectedTarget('email')
            ? await t('contentAutofill.dryRunTarget', { field: detectedTarget('email') })
            : '',
        },
        {
          label: await t('savedLoginInfo.name'),
          value:
            previewCredential?.name ||
            `${identity?.firstNames || ''} ${identity?.lastNames || ''}`.trim() ||
            (await t('contentAutofill.dryRunEmpty')),
          kind: 'fullName',
          target: detectedTarget('fullName')
            ? await t('contentAutofill.dryRunTarget', { field: detectedTarget('fullName') })
            : '',
        },
        {
          label: await t('contentAutofill.generateUsername'),
          value:
            previewCredential?.username ||
            identity?.username ||
            (await t('contentAutofill.dryRunAutoMode')),
          kind: 'username',
          target: detectedTarget('username')
            ? await t('contentAutofill.dryRunTarget', { field: detectedTarget('username') })
            : '',
        },
        {
          label: await t('savedLoginInfo.phone'),
          value:
            previewCredential?.phone ||
            identity?.phone ||
            (await t('contentAutofill.dryRunAutoMode')),
          kind: 'phone',
          target: detectedTarget('phone')
            ? await t('contentAutofill.dryRunTarget', { field: detectedTarget('phone') })
            : '',
        },
        {
          label: await t('savedLoginInfo.password'),
          value: '••••••••',
          kind: 'password',
          target: detectedTarget('password')
            ? await t('contentAutofill.dryRunTarget', { field: detectedTarget('password') })
            : '',
        },
      ];
      const rows = candidates.filter(
        (row) => !row.kind || targets[row.kind as AutofillPreviewKind]?.length
      );
      if (submitDestination) {
        rows.push(
          {
            label: await t('contentAutofill.destinationWarningCurrentSite'),
            value: submitDestination.currentSite,
          },
          {
            label: await t('contentAutofill.destinationWarningDestination'),
            value: submitDestination.destinationSites.join(', '),
          }
        );
      }
      const action = await showDryRunPreview({
        title: submitDestination
          ? await t('contentAutofill.destinationWarningTitle')
          : await t('contentAutofill.dryRunTitle'),
        confirmLabel: submitDestination
          ? await t('contentAutofill.destinationWarningContinue')
          : await t('contentAutofill.dryRunConfirm'),
        cancelLabel: await t('common.cancel'),
        changeIdentityLabel: usedReplay ? undefined : await t('contentAutofill.chooseIdentity'),
        correctLabel:
          previewEnabled && !usedReplay ? await t('contentAutofill.correctField') : undefined,
        selectionPrompt:
          previewEnabled && !usedReplay ? await t('contentAutofill.selectCorrectField') : undefined,
        form: previewEnabled && !usedReplay ? form : undefined,
        failIfUnavailable: !!submitDestination,
        rows,
      });
      if (action === 'change-identity') return action;
      if (action === 'cancel') return 'cancel';
      // An explicit reviewed mailbox must not be replaced by the unused-mailbox
      // preference after confirmation. Random/automatic review stays automatic.
      if (!usedReplay && !usesRandomMailbox && targets.email?.length) {
        reviewedEmail = permittedPreferredEmail || meta?.address || undefined;
      }
      if (action !== 'fill') {
        fieldSelectors = action;
        const saved = await Promise.allSettled(
          Object.entries(action).map(([kind, selector]) =>
            selector
              ? setFieldMapCorrectionViaBg(
                  planDomain,
                  kind as import('@/features/intelligence/types.js').FormFieldKind,
                  selector
                )
              : Promise.resolve()
          )
        );
        if (saved.some((result) => result.status === 'rejected')) {
          logWarn('A corrected field mapping could not be saved for this site');
        }
      }
    } catch (error) {
      if (submitDestination) {
        logWarn(
          'Could not show autofill destination warning; saved credentials were not filled',
          error
        );
        return 'cancel';
      }
      /* Routine preview is optional. */
    }
  }

  let fillSucceeded = false;
  try {
    // Human-like pause before fill starts
    try {
      await maybeHumanDelay();
    } catch {
      /* ignore */
    }

    const fillResult = await fillSignupForm(
      form,
      updateAndCopyCredentials,
      usedReplay ? undefined : identity,
      usedReplay ? (replayCredential ?? undefined) : undefined,
      { fieldSelectors, email: reviewedEmail }
    );

    const success = fillResult.success;
    fillSucceeded = success;
    if (success && !usedReplay && fillResult.credentialId) {
      try {
        const attempt = await beginSignupAttemptViaBg(fillResult.credentialId);
        if (attempt) armSignupOutcomeAfterSubmit(attempt, form, { autoClick: true });
      } catch (error) {
        logError('Could not begin signup tracking', error);
      }
    }
    if (success && usedReplay) {
      // Saved-login replay keeps optional automatic submission, without
      // creating a signup attempt or changing the saved account's status.
      const replaySubmitTimer = setTimeout(() => {
        void hasAutoSubmitConsent()
          .then((consent) => {
            if (consent) clickPrimaryAction(form);
          })
          .catch((error) => logError('Could not submit saved-login replay', error));
      }, 280);
      updatePositionListeners.push(() => clearTimeout(replaySubmitTimer));
    }
    await showAutofillResultFeedback(anchorEl, fillResult);

    try {
      const meta = await getActiveAddressMetaViaBg(!usedReplay);
      if (meta) {
        void recordAutofillOutcomeViaBg({
          domain: planDomain,
          success,
          identityId: planIdentityId || identity?.id,
          addressId: fillResult.addressId || meta?.addressId,
          email: fillResult.email || meta.address,
          formScore: formScore as unknown,
          usedReplay,
        });
      }
      if (success) {
        void recordAutofillSuccessViaBg(planDomain);
        // detectWizardStepFromPage is inlined in content-bg-bridge (DOM access needed)
        void upsertWizardSessionViaBg({
          domain: planDomain,
          step: detectWizardStepFromPage() === 'otp' ? 'otp' : 'form',
          email: fillResult.email || meta?.address || null,
          identityId: planIdentityId || identity?.id,
          addressId: fillResult.addressId || meta?.addressId || null,
          paths: [location.pathname],
          filled: { email: fillResult.email || meta?.address || '' },
        });
      } else {
        const fail = await recordAutofillFailureViaBg(planDomain);
        if (fail?.shouldSuggestBlock) {
          void showTooltip(
            anchorEl,
            await t('contentAutofill.suggestBlockSite', { domain: planDomain }),
            true
          );
        }
      }
    } catch {
      /* ignore memory write */
    }

    if (success && onSuccessLabel) {
      onSuccessLabel(await t('contentAutofill.reuseIdentity'));
    }
    if (success) {
      try {
        const meta = await getActiveAddressMetaViaBg(!usedReplay);
        const email =
          fillResult.email ||
          meta?.address ||
          (usedReplay ? replayCredential?.email : null) ||
          identity?.preferredEmail ||
          '';
        const idName = identity?.name || '';
        const provider = meta?.providerDisplay || meta?.provider || '';
        const statusText = await t('contentAutofill.fillMicroStatus', {
          identity: idName || '-',
          email: email || '-',
          provider: provider || '-',
        });
        showFillMicroStatus(anchorEl, statusText);

        // Respect the current site's OTP setting before opening an automatic panel.
        if (getCachedSitePrivacySettingsOrDisabled().otpDetection) {
          try {
            const smart = (await loadSmartAutofillSettingsViaBg()) as {
              smartOtpAttach: boolean;
            } | null;
            if (smart?.smartOtpAttach) {
              void showWaitOtpPanel({
                email: email || null,
                autoFill: true,
                skipIfNotVerificationPage: true,
              });
            }
          } catch (error: unknown) {
            logWarn('Could not load the Smart OTP attach setting', error);
          }
        }

        // Conflict watch → auto new inbox
        try {
          const stopConflictWatch = watchEmailConflict(form, () => {
            void (async () => {
              const fresh = await createFreshAddress();
              if (fresh && (await isSiteEmailAllowedViaBg(fresh))) {
                fillAllEmailFields(form, fresh);
                await updateAndCopyCredentials({ email: fresh });
                await showTooltip(
                  anchorEl,
                  await t('contentAutofill.conflictNewEmail', { email: fresh }),
                  false
                );
              }
            })();
          });
          updatePositionListeners.push(stopConflictWatch);
        } catch {
          /* optional */
        }

        // Multi-step SPA: email → name → OTP (generic - no site hardcoding)
        try {
          void startMultiStepOtpWatch({ email: email || null });
        } catch {
          /* optional */
        }
      } catch {
        // The specific localized result was already shown before optional
        // post-fill integrations (OTP/watchers) ran.
      }
    }
  } catch {
    try {
      void recordAutofillOutcomeViaBg({
        domain: planDomain,
        success: false,
        identityId: planIdentityId || identity?.id,
        formScore: formScore as unknown,
        usedReplay,
      });
    } catch {
      /* ignore */
    }
    await showAutofillResultFeedback(anchorEl, {
      success: false,
      filledFields: [],
      skippedFields: [],
      reason: 'fill_error',
    });
    fillSucceeded = false;
  }
  return fillSucceeded ? 'fill' : undefined;
}

async function addFillAllButton(
  form: HTMLFormElement | HTMLElement,
  injectedButtons: HTMLElement[],
  updatePositionListeners: Array<() => void>,
  updateAndCopyCredentials: (creds: Record<string, string>) => Promise<void>,
  replayCredential: ReusableCredential | null,
  replayIdentityId: string,
  replayAddressId: string
): Promise<void> {
  // Autofill All: high-confidence signup OR progressive multi-step OR sign-in
  let formIntent: ReturnType<typeof classifyFormIntent> = 'unknown';
  try {
    if (form instanceof HTMLFormElement) {
      formIntent = classifyFormIntent(form);
    } else {
      // Non-form progressive containers (email → continue) count as signup path
      formIntent = 'signup';
    }
    const score = scoreSignupForm(form);
    // Progressive SPA / social signup steps often score 30-54
    if (score < 32 && formIntent !== 'signin' && formIntent !== 'signup') return;
    // Explicit signup intent or progressive container always show Autofill All
    if (score < 28 && formIntent === 'unknown') return;
  } catch {
    /* ignore */
    return;
  }

  const isSignin =
    form instanceof HTMLFormElement && (formIntent === 'signin' || isSigninForm(form));
  const isSignup =
    !isSignin &&
    (formIntent === 'signup' || (form instanceof HTMLFormElement && isSignupForm(form)));
  // Reuse identity ONLY on sign-in pages - never on signup
  const isReplay = !!(replayCredential && isSignin);
  // Signup + existing site credential → suggest a different / new identity
  const hasExistingCredsOnSignup = !!(replayCredential && isSignup && !isSignin);

  // A sign-in form without a saved credential: filling it with a freshly
  // generated identity cannot log the user in. Keep the in-field icons but
  // drop the fill-all pill (it would silently create a throwaway account).
  if (isSignin && !isReplay) return;

  // Independent UI resources should not add one background round trip per
  // label/icon before the login action can appear.
  const [
    fillTitle,
    fillLabel,
    logoSvg,
    chooseIdentityLabel,
    chevronSvg,
    waitOtpTitle,
    waitOtpLabel,
    thisSiteLabel,
    siteSvg,
  ] = await Promise.all([
    isReplay
      ? t('contentAutofill.reuseTitle')
      : hasExistingCredsOnSignup
        ? t('contentAutofill.existingCredsSignupTitle')
        : t('contentAutofill.fillAllTitle'),
    isReplay
      ? t('contentAutofill.reuseIdentity')
      : hasExistingCredsOnSignup
        ? t('contentAutofill.newIdentityFill')
        : t('contentAutofill.autofillAll'),
    getExtLogoSvg(),
    t('contentAutofill.chooseIdentity'),
    getIconSvgViaBg('chevronDown', { size: 14, color: 'currentColor' }),
    t('contentAutofill.waitForOtpTitle'),
    t('contentAutofill.waitForOtpShort'),
    replayCredential ? t('contentAutofill.thisSite') : Promise.resolve(''),
    replayCredential
      ? getIconSvgViaBg('user', { size: 14, color: 'currentColor' })
      : Promise.resolve(''),
  ]);

  const buttonContainer = document.createElement('div');
  buttonContainer.className = `${CONTAINER_CLASS} fill-all-container`;
  buttonContainer.style.cssText = `
    position: fixed !important;
    z-index: ${CONTENT_Z.tooltip} !important;
    pointer-events: auto !important;
    display: inline-flex !important;
    height: 32px;
    align-items: stretch;
    opacity: 0.95 !important;
    visibility: visible !important;
    transition: opacity 0.2s;
    border-radius: 20px;
    overflow: hidden;
    box-shadow: 0 2px 8px color-mix(in srgb, var(--md-shadow) 18%, transparent);
    white-space: nowrap;
    flex-shrink: 0;
    min-width: 0;
    max-width: calc(100vw - 24px);
    flex-wrap: nowrap;
  `;

  const fillAllButton = document.createElement('button');
  fillAllButton.type = 'button';
  fillAllButton.className = `${BUTTON_CLASS} fill-all-button`;
  fillAllButton.title = fillTitle;
  fillAllButton.style.cssText = `
    /* height:100% is mandatory - it makes the segment span the full pill on
       any DPI/zoom (plain stretch proved unreliable on fractional scaling) */
    background-color: var(--md-primary);
    color: var(--md-on-primary);
    border: none;
    border-radius: 0;
    height: 100%;
    padding: 7px 12px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 600;
    font-family: system-ui, sans-serif;
    white-space: nowrap;
    flex-shrink: 0;
  `;
  appendSvgIcon(fillAllButton, logoSvg);
  const labelSpan = document.createElement('span');
  labelSpan.textContent = fillLabel;
  fillAllButton.appendChild(labelSpan);

  const siteButton = replayCredential ? document.createElement('button') : null;
  if (siteButton) {
    siteButton.type = 'button';
    siteButton.className = `${BUTTON_CLASS} site-quick-view-button`;
    siteButton.title = thisSiteLabel;
    siteButton.setAttribute('aria-label', siteButton.title);
    siteButton.style.cssText = `
      background-color: var(--md-secondary-container);
      color: var(--md-on-secondary-container);
      border: none;
      border-inline-start: 1px solid color-mix(in srgb, var(--md-on-primary) 25%, transparent);
      height: 100%;
      padding: 0 10px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      font-weight: 600;
      font-family: system-ui, sans-serif;
      white-space: nowrap;
      flex-shrink: 0;
    `;
    siteButton.innerHTML = siteSvg;
    const siteLabel = document.createElement('span');
    siteLabel.textContent = thisSiteLabel;
    siteButton.appendChild(siteLabel);
  }

  // Pre-fill snapshot for Reset after Autofill All
  let preFillSnapshot: FieldSnapshot[] | null = null;

  // Chevron opens identity picker
  const menuBtn = document.createElement('button');
  menuBtn.type = 'button';
  menuBtn.className = BUTTON_CLASS;
  menuBtn.title = chooseIdentityLabel;
  menuBtn.setAttribute('aria-label', chooseIdentityLabel);
  menuBtn.style.cssText = `
    /* height:100% is mandatory - it makes the segment span the full pill on
       any DPI/zoom (plain stretch proved unreliable on fractional scaling) */
    background-color: var(--md-primary);
    color: var(--md-on-primary);
    border: none;
    border-inline-start: 1px solid color-mix(in srgb, var(--md-on-primary) 25%, transparent);
    height: 100%;
    padding: 0 8px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    font-size: 12px;
    flex-shrink: 0;
  `;
  menuBtn.innerHTML = chevronSvg;
  const chevronIconSpan = menuBtn.querySelector('span');
  if (chevronIconSpan) {
    chevronIconSpan.style.flexShrink = '0';
  }

  const setFillLabel = (text: string) => {
    labelSpan.textContent = text;
    fillAllButton.title = text;
  };

  // Wait for OTP chip - revealed after successful fill or matching manual email entry
  const waitOtpBtn = document.createElement('button');
  waitOtpBtn.type = 'button';
  waitOtpBtn.className = BUTTON_CLASS;
  waitOtpBtn.title = waitOtpTitle;
  waitOtpBtn.style.cssText = `
    background-color: var(--md-secondary-container);
    color: var(--md-on-secondary-container);
    border: none;
    border-inline-start: 1px solid color-mix(in srgb, var(--md-on-secondary-container) 12%, transparent);
    height: 100%;
    padding: 7px 10px;
    cursor: pointer;
    display: none;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    font-weight: 600;
    font-family: system-ui, sans-serif;
    white-space: nowrap;
  `;
  waitOtpBtn.textContent = waitOtpLabel;
  waitOtpBtn.addEventListener('click', async (event: MouseEvent) => {
    if (!event.isTrusted) return;
    event.preventDefault();
    event.stopPropagation();
    if (!getCachedSitePrivacySettingsOrDisabled().otpDetection) return;
    try {
      const meta = await getActiveAddressMetaViaBg();
      await showWaitOtpPanel({
        email: meta?.address || replayCredential?.email || null,
        autoFill: true,
        focusOnOpen: true,
      });
    } catch {
      /* ignore */
    }
  });

  let refreshActionLayout = (): void => {};
  const showWaitOtpButton = () => {
    waitOtpBtn.style.display = 'flex';
    refreshActionLayout();
  };

  const showResetButton = () => {
    resetBtn.style.display = 'flex';
    refreshActionLayout();
  };

  const runWithIdentity = async (id?: IdentityFill, forceGenerate = false) => {
    // Snapshot once before first fill so Reset can undo incomplete signups
    if (!preFillSnapshot) preFillSnapshot = snapshotFormFields(form);
    // Reuse only on sign-in; signup always generates (even if site has saved creds)
    const replay =
      isReplay && !forceGenerate && !hasExistingCredsOnSignup ? replayCredential : null;
    const result = await runFillAll(
      form,
      updateAndCopyCredentials,
      id,
      replay,
      fillAllButton,
      setFillLabel,
      updatePositionListeners
    );
    if (result === 'change-identity') {
      await openIdentityPicker();
      return;
    }
    if (result !== 'fill') return;
    showResetButton();
    // After Autofill All, reveal Wait-for-OTP if form now has a known extension email
    try {
      if (await formEmailMatchesExtensionAddress(form)) showWaitOtpButton();
    } catch {
      /* ignore */
    }
  };

  const openSiteQuickView = async () => {
    if (!siteButton || !replayCredential) return;
    closeActivePopup();
    const [storage, labels] = await Promise.all([
      getStorageViaBg(['identities', 'addresses']),
      Promise.all([
        t('contentAutofill.thisSite'),
        t('contentAutofill.loginEmail'),
        t('contentAutofill.inboxAddress'),
        t('savedLoginInfo.identity'),
        t('contentAutofill.waitForOtpFill'),
        t('savedLoginInfo.copyPassword'),
        t('omnibox.openMailbox'),
        t('contentAutofill.waitForOtpCopied'),
        t('contentAutofill.copyPasswordFailed'),
        t('common.unknown'),
      ]),
    ]);
    const [
      title,
      loginLabel,
      addressLabel,
      identityLabel,
      fillLabel,
      copyLabel,
      inboxLabel,
      copiedLabel,
      copyFailedLabel,
      unknownLabel,
    ] = labels;
    const identities = arrayOrEmpty<IdentityFill>(storage.identities);
    const addresses = arrayOrEmpty<{ id?: string; address?: string }>(storage.addresses);
    const identityName =
      identities.find((identity) => identity.id === replayIdentityId)?.name || '';
    const mailboxAddress = addresses.find((item) => item.id === replayAddressId)?.address || '';

    const popup = document.createElement('div');
    popup.className = POPUP_CLASS;
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', title);
    popup.style.cssText = `
      position: fixed; z-index: ${CONTENT_Z.popup}; width: min(300px, calc(100vw - 24px));
      box-sizing: border-box; padding: 14px; border: 1px solid var(--md-outline-variant);
      border-radius: 14px; background: var(--md-surface-container); color: var(--md-on-surface);
      box-shadow: 0 8px 28px color-mix(in srgb, var(--md-shadow) 24%, transparent);
      font: var(--md-type-body-medium-size, 14px)/var(--md-type-body-medium-line, 20px) system-ui, sans-serif; pointer-events: auto;
    `;
    const heading = document.createElement('div');
    heading.textContent = title;
    heading.style.cssText =
      'font-weight:500;font-size:var(--md-type-title-medium-size,16px);line-height:var(--md-type-title-medium-line,24px);margin-bottom:10px;';
    popup.appendChild(heading);
    const siteName = document.createElement('div');
    siteName.textContent = window.location.hostname;
    siteName.style.cssText =
      'color:var(--md-on-surface-variant);font-size:var(--md-type-body-small-size,12px);line-height:var(--md-type-body-small-line,16px);margin-bottom:10px;';
    popup.appendChild(siteName);
    const addDetail = (label: string, value: string) => {
      if (!value) return;
      const row = document.createElement('div');
      row.style.cssText = 'margin:7px 0;min-width:0;';
      const name = document.createElement('div');
      name.textContent = label;
      name.style.cssText =
        'color:var(--md-on-surface-variant);font-size:var(--md-type-body-small-size,12px);line-height:var(--md-type-body-small-line,16px);';
      const detail = document.createElement('div');
      detail.textContent = value;
      detail.title = value;
      detail.style.cssText =
        'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;';
      row.append(name, detail);
      popup.appendChild(row);
    };
    addDetail(loginLabel, replayCredential.email);
    addDetail(addressLabel, mailboxAddress);
    addDetail(identityLabel, identityName || unknownLabel);

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:6px;margin-top:12px;';
    const addAction = (
      text: string,
      handler: (button: HTMLButtonElement) => Promise<void>,
      primary = false
    ) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = text;
      button.style.cssText = `flex:1;min-width:0;min-height:40px;padding:8px 6px;border:0;border-radius:8px;cursor:pointer;font:500 var(--md-type-label-large-size,14px)/var(--md-type-label-large-line,20px) system-ui,sans-serif;overflow-wrap:anywhere;background:${primary ? 'var(--md-primary)' : 'var(--md-surface-variant)'};color:${primary ? 'var(--md-on-primary)' : 'var(--md-on-surface-variant)'};`;
      button.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
      });
      button.addEventListener(
        'click',
        trustedClick(async (event) => {
          event.preventDefault();
          event.stopPropagation();
          await handler(button);
        })
      );
      actions.appendChild(button);
    };
    if (isReplay) {
      addAction(
        fillLabel,
        async () => {
          closeActivePopup();
          await runWithIdentity();
        },
        true
      );
    }
    if (replayCredential.password) {
      addAction(copyLabel, async (button) => {
        try {
          const copied = await copySiteCredentialPasswordViaBg(
            window.location.hostname,
            replayCredential?.email || '',
            replayAddressId || undefined
          );
          button.textContent = copied ? copiedLabel : copyFailedLabel;
        } catch {
          button.textContent = copyFailedLabel;
        }
      });
    }
    addAction(inboxLabel, async () => {
      closeActivePopup();
      if (replayAddressId) await setStorageViaBg({ activeAddressId: replayAddressId });
      await openExtensionForReason('open-inbox', 'open-inbox');
    });
    popup.appendChild(actions);
    popup.addEventListener('pointerdown', (event) => event.stopPropagation(), true);
    popup.addEventListener('mousedown', (event) => event.stopPropagation(), true);
    getOrCreateShadowRoot()?.appendChild(popup);
    const { cleanup } = trackElementPosition(
      popup,
      siteButton,
      (rect) => {
        const width = Math.min(300, window.innerWidth - 24);
        const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
        const opensAbove = rect.bottom + 240 > window.innerHeight;
        const top = opensAbove ? Math.max(12, rect.top - popup.offsetHeight - 6) : rect.bottom + 6;
        return { left, top, visible: true };
      },
      updatePositionListeners
    );
    const actionsLayout = responsiveButtonLayout(actions, { tier: 'XS' });
    activePopupInfo = {
      element: popup,
      cleanup: () => {
        cleanup();
        actionsLayout.destroy();
      },
    };
  };
  siteButton?.addEventListener(
    'click',
    trustedClick(async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await openSiteQuickView();
    })
  );

  fillAllButton.addEventListener('click', async (event: MouseEvent) => {
    if (!event.isTrusted) {
      logWarn('Blocked synthetic click event on fill all button');
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    // Signup already has credentials for this site → open identity menu path
    if (hasExistingCredsOnSignup) {
      try {
        await showTooltip(fillAllButton, await t('contentAutofill.existingCredsSignupHint'), false);
      } catch {
        /* ignore */
      }
    }
    // Identity routing (sticky / domain hints / selected / default)
    try {
      const { identities = [], selectedIdentityId } = (await getStorageViaBg([
        'identities',
        'selectedIdentityId',
      ])) as { identities?: IdentityFill[]; selectedIdentityId?: string };
      let selected: IdentityFill | undefined;
      if (hasExistingCredsOnSignup && identities.length > 1) {
        // Prefer a different identity than the one last used for this domain
        const lastId = (replayCredential as { identityId?: string } | null)?.identityId;
        selected =
          identities.find((i) => i.id !== lastId && i.id !== selectedIdentityId) ||
          identities.find((i) => i.id !== lastId) ||
          identities.find((i) => i.id !== selectedIdentityId) ||
          identities[0];
      } else {
        const routed = (await routeIdentityForDomainViaBg(
          window.location.hostname,
          identities as unknown as import('@/utils/types.js').Identity[],
          selectedIdentityId
        )) as { identity: IdentityFill | null; identityId: string | null } | null;
        selected =
          routed?.identity || identities.find((i) => i.id === selectedIdentityId) || identities[0];
      }
      // Reuse only on sign-in; signup always generate
      await runWithIdentity(isReplay ? undefined : selected, hasExistingCredsOnSignup);
    } catch {
      /* ignore */
      const { identities = [], selectedIdentityId } = (await getStorageViaBg([
        'identities',
        'selectedIdentityId',
      ])) as { identities?: IdentityFill[]; selectedIdentityId?: string };
      const selected = identities.find((i) => i.id === selectedIdentityId) || identities[0];
      await runWithIdentity(isReplay ? undefined : selected, hasExistingCredsOnSignup);
    }
  });

  const openIdentityPicker = async () => {
    closeActivePopup();

    const { identities = [], selectedIdentityId } = (await getStorageViaBg([
      'identities',
      'selectedIdentityId',
    ])) as { identities?: IdentityFill[]; selectedIdentityId?: string };

    const menu = document.createElement('div');
    const reduceMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    menu.className = POPUP_CLASS;
    menu.style.cssText = `
      position: fixed;
      z-index: ${CONTENT_Z.popup};
      opacity: 0;
      transform: scale(0.98) translateY(4px);
      transform-origin: top center;
      transition: ${reduceMotion ? 'none' : 'opacity 140ms cubic-bezier(0.2, 0, 0, 1), transform 140ms cubic-bezier(0.2, 0, 0, 1)'};
      min-width: 220px;
      max-width: 300px;
      max-height: min(70vh, 360px);
      overflow-y: auto;
      pointer-events: auto;
      background: var(--md-surface-container);
      color: var(--md-on-surface);
      border: 1px solid var(--md-outline-variant);
      border-radius: 12px;
      box-shadow: 0 4px 20px color-mix(in srgb, var(--md-shadow) 18%, transparent);
      padding: 6px 0;
      font-family: system-ui, sans-serif;
      font-size: 13px;
    `;

    const identityFallback = await t('savedLoginInfo.identity');
    const editLabel = await t('common.edit');
    const editIdentityLabel = await t('contentAutofill.editIdentity');

    const addIdentityRow = (id: IdentityFill, selected: boolean) => {
      const row = document.createElement('div');
      row.style.cssText =
        'display:flex;align-items:center;gap:4px;padding:2px 6px 2px 0;width:100%;box-sizing:border-box;';
      const pick = document.createElement('button');
      pick.type = 'button';
      pick.textContent = `${selected ? '✓ ' : ''}${id.name || identityFallback}`;
      pick.style.cssText = `
        flex:1;min-width:0;text-align:start;padding:8px 10px 8px 14px;border:0;background:transparent;
        cursor:pointer;font:inherit;color:inherit;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
      `;
      pick.onmouseover = () => {
        pick.style.background = 'var(--md-surface-variant)';
      };
      pick.onmouseout = () => {
        pick.style.background = 'transparent';
      };
      const runPick = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        closeActivePopup();
        void setStorageViaBg({ selectedIdentityId: id.id });
        // Always generate with chosen identity on signup (never silent reuse)
        void runWithIdentity(id, hasExistingCredsOnSignup || !isReplay);
      };
      pick.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
      });
      pick.addEventListener('click', trustedClick(runPick));

      const edit = document.createElement('button');
      edit.type = 'button';
      edit.title = editLabel;
      edit.setAttribute('aria-label', editIdentityLabel);
      edit.textContent = '✎';
      edit.style.cssText = `
        flex-shrink:0;width:32px;height:32px;border:0;border-radius:8px;background:transparent;
        cursor:pointer;font-size:14px;color:inherit;display:flex;align-items:center;justify-content:center;
      `;
      edit.onmouseover = () => {
        edit.style.background = 'var(--md-surface-variant)';
      };
      edit.onmouseout = () => {
        edit.style.background = 'transparent';
      };
      edit.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
      });
      edit.addEventListener(
        'click',
        trustedClick((e) => {
          e.preventDefault();
          e.stopPropagation();
          closeActivePopup();
          // Background owns storage + open (app tab with query + navigateView).
          // Do not pre-write storage here - it races with open UIs that clear flags.
          void openExtensionForReason('edit-identity', 'edit-identity', { identityId: id.id });
        })
      );

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
        b.style.background = 'var(--md-surface-variant)';
      };
      b.onmouseout = () => {
        b.style.background = 'transparent';
      };
      b.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
      });
      b.addEventListener(
        'click',
        trustedClick((e) => {
          e.preventDefault();
          e.stopPropagation();
          closeActivePopup();
          onClick();
        })
      );
      menu.appendChild(b);
    };

    if (hasExistingCredsOnSignup) {
      const hint = document.createElement('div');
      hint.style.cssText =
        'padding:8px 14px;font-size:11px;line-height:1.35;color:var(--md-on-surface-variant);opacity:0.95;';
      hint.textContent = await t('contentAutofill.existingCredsSignupMenuHint');
      menu.appendChild(hint);
    }

    addRow(
      isReplay ? await t('contentAutofill.reuseIdentity') : await t('contentAutofill.autofillAll'),
      () => {
        const selected = identities.find((i) => i.id === selectedIdentityId) || identities[0];
        void runWithIdentity(selected, hasExistingCredsOnSignup);
      },
      true
    );

    for (const id of identities.slice(0, 12)) {
      addIdentityRow(id, id.id === selectedIdentityId);
    }

    addRow(await t('contentAutofill.createIdentity'), () => {
      void openExtensionForReason('create-identity', 'create-identity');
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

    const { cleanup } = trackElementPosition(
      menu,
      menuBtn,
      (btnRect) => {
        const menuH = Math.min(360, window.innerHeight * 0.7);
        const opensAbove = btnRect.bottom + 120 > window.innerHeight;
        let top = btnRect.bottom + 4;
        if (opensAbove) top = Math.max(8, btnRect.top - menuH - 4);
        menu.style.transformOrigin = opensAbove ? 'bottom center' : 'top center';
        return {
          top,
          left: Math.max(8, Math.min(btnRect.left, window.innerWidth - 240)),
          visible: true,
        };
      },
      updatePositionListeners
    );

    activePopupInfo = {
      element: menu,
      cleanup,
    };
    if (reduceMotion) {
      menu.style.opacity = '1';
      menu.style.transform = 'none';
    } else {
      requestAnimationFrame(() => {
        if (!menu.isConnected) return;
        menu.style.opacity = '1';
        menu.style.transform = 'scale(1) translateY(0)';
      });
    }
  };

  menuBtn.addEventListener(
    'click',
    async (event: MouseEvent) => {
      if (!event.isTrusted) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      await openIdentityPicker();
    },
    true
  );

  // Reset - undo Autofill All when signup was not completed
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = BUTTON_CLASS;
  resetBtn.title = await t('contentAutofill.resetFillTitle');
  resetBtn.style.cssText = `
    background-color: var(--md-surface-variant);
    color: var(--md-on-surface-variant);
    border: none;
    border-inline-start: 1px solid color-mix(in srgb, var(--md-on-surface-variant) 12%, transparent);
    height: 100%;
    padding: 7px 10px;
    cursor: pointer;
    display: none;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    font-weight: 600;
    font-family: system-ui, sans-serif;
    white-space: nowrap;
  `;
  resetBtn.textContent = await t('common.reset');
  resetBtn.addEventListener('click', async (event: MouseEvent) => {
    if (!event.isTrusted) return;
    event.preventDefault();
    event.stopPropagation();
    // Multi-level undo stack first; fall back to single pre-fill snapshot
    let undid = false;
    try {
      const stack = getFormUndoStack(form);
      undid = stack.undo();
      if (stack.canUndo()) {
        // Keep reset visible for further undos
        resetBtn.style.display = 'flex';
      } else {
        resetBtn.style.display = 'none';
        preFillSnapshot = null;
      }
    } catch {
      /* fall through */
    }
    if (!undid && preFillSnapshot) {
      restoreFormFields(preFillSnapshot);
      preFillSnapshot = null;
      resetBtn.style.display = 'none';
      undid = true;
    }
    if (undid) {
      refreshActionLayout();
      setFillLabel(
        isReplay
          ? await t('contentAutofill.reuseIdentity')
          : hasExistingCredsOnSignup
            ? await t('contentAutofill.newIdentityFill')
            : await t('contentAutofill.autofillAll')
      );
      try {
        await showTooltip(fillAllButton, await t('contentAutofill.resetFillDone'), false);
      } catch {
        /* ignore */
      }
    }
  });

  // Scan email inputs: show OTP when user manually types a known extension email
  const emailInputs = Array.from(
    form.querySelectorAll<HTMLInputElement>(
      'input[type="email"], input[name*="email" i], input[id*="email" i], input[autocomplete="email"]'
    )
  );
  const onEmailInputScan = () => {
    void formEmailMatchesExtensionAddress(form).then((ok) => {
      if (ok) showWaitOtpButton();
    });
  };
  for (const input of emailInputs) {
    input.addEventListener('input', onEmailInputScan);
    input.addEventListener('change', onEmailInputScan);
    input.addEventListener('blur', onEmailInputScan);
  }
  onEmailInputScan();
  // Sites sometimes set the email programmatically (no input/change/blur) -
  // poll briefly so the Wait-for-OTP chip still appears after such fills.
  const otpScanTimer = setInterval(onEmailInputScan, 300);
  setTimeout(() => clearInterval(otpScanTimer), 8_000);

  buttonContainer.appendChild(fillAllButton);
  if (siteButton) buttonContainer.appendChild(siteButton);
  buttonContainer.appendChild(menuBtn);
  buttonContainer.appendChild(waitOtpBtn);
  buttonContainer.appendChild(resetBtn);

  // Place after create-account heading / first field (not floating at random form coords)
  const anchor = findAutofillAllAnchor(form);
  const layoutRoot =
    form.closest<HTMLElement>('[role="dialog"],dialog') || form.parentElement || form;
  trackElementPosition(
    buttonContainer,
    anchor,
    createToolbarPositioner(buttonContainer, form, layoutRoot),
    updatePositionListeners,
    layoutRoot
  );

  const shadowRoot = getOrCreateShadowRoot();
  shadowRoot?.appendChild(buttonContainer);
  injectedButtons.push(buttonContainer);

  if (shadowRoot) {
    const buttonLayout = responsiveButtonLayout(buttonContainer, { tier: 'XS' });
    refreshActionLayout = buttonLayout.update;
    updatePositionListeners.push(() => buttonLayout.destroy());
  }

  updatePositionListeners.push(() => {
    clearInterval(otpScanTimer);
    for (const input of emailInputs) {
      input.removeEventListener('input', onEmailInputScan);
      input.removeEventListener('change', onEmailInputScan);
      input.removeEventListener('blur', onEmailInputScan);
    }
  });
}

/** True when any email-like field in the form holds a live extension inbox address */
async function formEmailMatchesExtensionAddress(form: ParentNode): Promise<boolean> {
  try {
    const { addresses = [] } = (await getStorageViaBg(['addresses'])) as {
      addresses?: Array<{ address?: string }>;
    };
    const known = new Set(
      arrayOrEmpty<AutofillAddressLike>(addresses)
        .map((i) => (i.address || '').trim().toLowerCase())
        .filter(Boolean)
    );
    if (known.size === 0) return false;
    const fields = form.querySelectorAll<HTMLInputElement>(
      'input[type="email"], input[name*="email" i], input[id*="email" i], input[autocomplete="email"], input[type="text"]'
    );
    for (const el of Array.from(fields)) {
      const v = (el.value || '').trim().toLowerCase();
      if (v && known.has(v)) return true;
    }
  } catch {
    /* ignore */
  }
  return false;
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
