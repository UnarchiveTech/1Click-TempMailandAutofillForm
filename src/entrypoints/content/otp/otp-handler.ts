/**
 * OTP input detection and autofill
 */

import { t } from '@/utils/i18n/content-i18n.js';
import { logDebug } from '@/utils/logger.js';
import { safeId, safeName, safePlaceholder } from '@/utils/security/dom-safe.js';
import { isFillableField } from '../autofill/fillable.js';
import { showTooltip } from '../dom/tooltip.js';
import { normalizeOtpCode } from './otp-code.js';

/** Zip / postal / address PIN fields must never receive OTP codes. */
function isZipOrPostalField(input: HTMLInputElement): boolean {
  const id = safeId(input).toLowerCase();
  const name = safeName(input).toLowerCase();
  const placeholder = safePlaceholder(input).toLowerCase();
  const ariaLabel = (input.getAttribute('aria-label') || '').toLowerCase();
  const autocomplete = (input.getAttribute('autocomplete') || '').toLowerCase();
  const hay = `${id} ${name} ${placeholder} ${ariaLabel} ${autocomplete}`;
  // Explicit postal autocomplete
  if (
    autocomplete === 'postal-code' ||
    autocomplete.includes('postal') ||
    autocomplete.includes('zip')
  ) {
    return true;
  }
  // Zip / postcode variants (avoid bare "pin" which is also OTP)
  if (
    /\b(zip|zipcode|zip-code|postal|postcode|post-code|pincode|pin-code|pin_code)\b/.test(
      hay.replace(/[_-]/g, ' ')
    )
  ) {
    return true;
  }
  // "pin code" / "pincode" as whole phrases but not "pin" alone for 2FA
  if (/(pin\s*code|pincode)/.test(hay)) return true;
  return false;
}

/** Page-level signals that we are on a verification / OTP step (email already asked). */
function pageLooksLikeOtpStep(): boolean {
  try {
    const path = `${location.pathname} ${location.search} ${location.hash}`.toLowerCase();
    if (/(otp|2fa|mfa|verify|verification|confirm.?email|enter.?code|security.?code)/.test(path)) {
      return true;
    }
    const title = (document.title || '').toLowerCase();
    if (/(verify|verification|code|otp|2fa|security)/.test(title)) return true;
    // Short page headings
    for (const el of Array.from(document.querySelectorAll('h1, h2, h3, [role="heading"]')).slice(
      0,
      12
    )) {
      const t = (el.textContent || '').toLowerCase();
      if (
        /(enter (the )?(code|otp)|verification code|one.?time|check your (email|phone)|we sent|confirm (your )?email)/.test(
          t
        )
      ) {
        return true;
      }
    }
  } catch {
    /* ignore */
  }
  return false;
}

function looksLikeOtpField(input: HTMLInputElement): boolean {
  if (isZipOrPostalField(input)) return false;
  const id = safeId(input).toLowerCase();
  const name = safeName(input).toLowerCase();
  const placeholder = safePlaceholder(input).toLowerCase();
  const ariaLabel = (input.getAttribute('aria-label') || '').toLowerCase();
  const autocomplete = (input.getAttribute('autocomplete') || '').toLowerCase();
  if (autocomplete === 'one-time-code') return true;
  // Prefer strong OTP keywords; treat bare "pin" only with 2fa/otp/security context
  const strong = [
    'otp',
    'verification',
    '2fa',
    'two-factor',
    'totp',
    'mfa',
    'one-time',
    'onetime',
    'security code',
    'auth code',
    'passcode',
    'sms code',
  ];
  const hay = `${id} ${name} ${placeholder} ${ariaLabel} ${autocomplete}`;
  for (const keyword of strong) {
    if (hay.includes(keyword)) return true;
  }
  // "code" alone is weak - require security-ish neighbours
  if (
    (hay.includes('code') || hay.includes('pin')) &&
    /(security|verify|login|auth|sms|email|confirm|enter|digit)/.test(hay)
  ) {
    return true;
  }
  // Numeric 4-8 character fields are ambiguous: phone extensions, PINs, and
  // short product codes also use them. Require an OTP/security hint or a
  // page-level verification-step signal instead of classifying every such
  // field as an OTP input.
  const maxL = input.maxLength;
  if (
    (input.inputMode === 'numeric' || input.type === 'tel' || input.type === 'number') &&
    maxL >= 4 &&
    maxL <= 8 &&
    !isZipOrPostalField(input) &&
    !/(address|street|city|state|country|zip|postal|phone|mobile|tel)/.test(hay)
  ) {
    if (/(otp|verification|code|pin|security|auth|token|one-time|passcode|confirm)/.test(hay)) {
      return true;
    }
    if (pageLooksLikeOtpStep()) return true;
  }

  // Email already submitted → standalone short code field on verify step
  // (page only asks for code, not email again)
  if (pageLooksLikeOtpStep() && !isZipOrPostalField(input)) {
    if (input.type === 'email') return false;
    const maxOk = maxL === -1 || maxL === 0 || (maxL >= 4 && maxL <= 10);
    if (
      maxOk &&
      (input.inputMode === 'numeric' ||
        input.type === 'tel' ||
        input.type === 'number' ||
        input.type === 'text' ||
        !input.type)
    ) {
      // Prefer fields without long free-text labels (username, address)
      if (!/(user|name|address|street|password|search)/.test(hay)) {
        // Single visible short field is common for “enter the code we emailed”
        return true;
      }
    }
  }
  return false;
}

/** Collect inputs from light DOM + open shadow roots (generic SPA OTP). */
function queryAllInputsDeep(root: ParentNode = document): HTMLInputElement[] {
  const out: HTMLInputElement[] = [];
  const walk = (node: ParentNode) => {
    try {
      const list = node.querySelectorAll('input');
      for (const el of Array.from(list)) {
        if (el instanceof HTMLInputElement) out.push(el);
      }
      // Open shadow roots only (closed ones are inaccessible)
      const all = node.querySelectorAll('*');
      for (const el of Array.from(all)) {
        const sr = (el as HTMLElement).shadowRoot;
        if (sr) walk(sr);
      }
    } catch {
      /* ignore */
    }
  };
  walk(root);
  return out;
}

function isVisibleInput(input: HTMLInputElement): boolean {
  if (input.type === 'hidden' || input.disabled) return false;
  try {
    const rect = input.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const st = getComputedStyle(input);
    if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
  } catch {
    /* ignore */
    return false;
  }
  return true;
}

function isSingleDigitOtpInput(input: HTMLInputElement): boolean {
  return (
    input.maxLength === 1 ||
    (input.inputMode === 'numeric' &&
      input.maxLength === -1 &&
      (!input.hasAttribute('size') || input.size <= 2))
  );
}

/** Find clustered single-digit OTP boxes in a shared parent (not only siblings). */
function findDigitOtpGroup(allInputs: HTMLInputElement[]): HTMLInputElement[] {
  // Group by parentElement
  const byParent = new Map<Element, HTMLInputElement[]>();
  for (const input of allInputs) {
    if (!isVisibleInput(input)) continue;
    if (isZipOrPostalField(input)) continue;
    // size defaults to 20 even when no size attribute was authored.
    if (!isSingleDigitOtpInput(input)) continue;
    if (input.type === 'password' || input.type === 'email') continue;
    const parent = input.parentElement;
    if (!parent) continue;
    const arr = byParent.get(parent) || [];
    arr.push(input);
    byParent.set(parent, arr);
    // Also grandparent (wrappers around each digit)
    const gp = parent.parentElement;
    if (gp) {
      const arr2 = byParent.get(gp) || [];
      if (!arr2.includes(input)) arr2.push(input);
      byParent.set(gp, arr2);
    }
  }
  let best: HTMLInputElement[] = [];
  for (const group of byParent.values()) {
    const sorted = [...group].sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return ra.left - rb.left || ra.top - rb.top;
    });
    // Dedupe
    const uniq = Array.from(new Set(sorted));
    if (uniq.length >= 4 && uniq.length <= 8 && uniq.length > best.length) {
      best = uniq;
    }
  }
  return best;
}

export function findOtpInputs(): HTMLInputElement[] {
  const allDeep = queryAllInputsDeep(document);

  const oneTime = allDeep.find(
    (el) =>
      (el.getAttribute('autocomplete') || '').toLowerCase() === 'one-time-code' &&
      !isZipOrPostalField(el) &&
      isVisibleInput(el)
  );
  if (oneTime) {
    // An explicitly single-digit field may mark only the first box. An
    // unbounded autocomplete field remains authoritative for a whole code.
    if (oneTime.maxLength === 1) {
      const group = findDigitOtpGroup(allDeep);
      if (group.includes(oneTime)) return group;
    }
    return [oneTime];
  }

  const visibleInputs = allDeep.filter(
    (input) =>
      isVisibleInput(input) &&
      !isZipOrPostalField(input) &&
      (input.type === 'text' ||
        input.type === 'tel' ||
        input.type === 'number' ||
        !input.type ||
        input.type === 'password')
  );

  // Password-type OTP boxes are rare but used by some sites
  const keywordMatched = visibleInputs.filter(
    (el) => el.type !== 'password' && looksLikeOtpField(el)
  );
  if (keywordMatched.length > 0) {
    if (keywordMatched.length < 4 && keywordMatched.every(isSingleDigitOtpInput)) {
      const group = findDigitOtpGroup(allDeep);
      if (group.length >= 4 && keywordMatched.every((input) => group.includes(input))) return group;
    }
    return keywordMatched;
  }

  // Digit groups (Canva / bank-style 6-box codes)
  const digitGroup = findDigitOtpGroup(allDeep);
  if (digitGroup.length >= 4 && pageLooksLikeOtpStep()) return digitGroup;

  // Sibling-chain fallback is ambiguous (many forms use one-character fields),
  // so only enable it when the page itself signals an OTP/verification step.
  if (pageLooksLikeOtpStep()) {
    let potentialOtpGroup: HTMLInputElement[] = [];
    for (let i = 0; i < allDeep.length; i++) {
      const input = allDeep[i];
      if (!input || isZipOrPostalField(input) || !isVisibleInput(input)) {
        if (potentialOtpGroup.length >= 4 && potentialOtpGroup.length <= 8)
          return potentialOtpGroup;
        potentialOtpGroup = [];
        continue;
      }
      if (input.type !== 'text' && input.type !== 'tel' && input.type !== 'number' && input.type) {
        if (potentialOtpGroup.length >= 4 && potentialOtpGroup.length <= 8)
          return potentialOtpGroup;
        potentialOtpGroup = [];
        continue;
      }
      if (input.maxLength === 1) {
        potentialOtpGroup.push(input);
      } else {
        if (potentialOtpGroup.length >= 4 && potentialOtpGroup.length <= 8)
          return potentialOtpGroup;
        potentialOtpGroup = [];
      }
    }
    if (potentialOtpGroup.length >= 4 && potentialOtpGroup.length <= 8) return potentialOtpGroup;
  }

  // Page is clearly OTP step: take first short numeric-ish field
  if (pageLooksLikeOtpStep()) {
    const short = visibleInputs.find((el) => {
      if (el.type === 'password' || el.type === 'email') return false;
      const maxL = el.maxLength;
      return maxL === -1 || maxL === 0 || (maxL >= 4 && maxL <= 10);
    });
    if (short) return [short];
  }

  return [];
}

function setNativeValue(input: HTMLInputElement, value: string): void {
  try {
    const proto = Object.getPrototypeOf(input) as HTMLInputElement;
    const desc =
      Object.getOwnPropertyDescriptor(proto, 'value') ||
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (desc?.set) desc.set.call(input, value);
    else input.value = value;
  } catch {
    /* ignore */
    input.value = value;
  }
  try {
    input.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: value }));
  } catch {
    /* ignore */
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  input.dispatchEvent(new Event('change', { bubbles: true }));
  try {
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
  } catch {
    /* ignore */
  }
}

export async function fillOtp(otp: string): Promise<void> {
  const code = normalizeOtpCode(otp);
  if (!code) return;
  const inputs = findOtpInputs();
  if (inputs.length === 0) {
    logDebug('No OTP input field found.');
    return;
  }

  if (inputs.length === 1) {
    const input = inputs[0];
    if (!input) return;
    if (!isFillableField(input)) return;
    input.focus();
    setNativeValue(input, code);

    await showTooltip(input, await t('contentAutofill.otpFilled'), false);
  } else if (inputs.length > 1) {
    const last = inputs[inputs.length - 1];
    const remainder = code.slice(inputs.length - 1);
    // Validate before clearing anything. Never bypass the form's maxlength
    // or report success after putting a partial code into a digit group.
    if (
      code.length < inputs.length ||
      (inputs.every(isSingleDigitOtpInput) && code.length !== inputs.length) ||
      (last && last.maxLength >= 0 && remainder.length > last.maxLength)
    ) {
      logDebug('OTP length does not match the detected input group.');
      if (last) await showTooltip(last, await t('contentAutofill.otpLengthMismatch'), true);
      return;
    }
    // Clear every recognized box first so old trailing characters cannot remain.
    for (const input of inputs) {
      if (input && isFillableField(input)) setNativeValue(input, '');
    }
    const n = Math.min(inputs.length, code.length);
    for (let i = 0; i < n; i++) {
      const input = inputs[i];
      if (input && isFillableField(input)) {
        input.focus();
        setNativeValue(input, code[i] || '');
      }
    }
    // A wider final segment may accept the remaining characters. Its value
    // replaces the digit already filled there, so the slice starts at n - 1.
    if (code.length > inputs.length && last && isFillableField(last)) {
      setNativeValue(last, remainder);
    }

    if (last) await showTooltip(last, await t('contentAutofill.otpFilled'), false);
  }
}
