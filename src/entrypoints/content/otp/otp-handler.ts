/**
 * OTP input detection and autofill
 */

import { logDebug } from '@/utils/logger.js';
import { showTooltip } from '../dom/tooltip.js';

/** Zip / postal / address PIN fields must never receive OTP codes. */
function isZipOrPostalField(input: HTMLInputElement): boolean {
  const id = (input.id || '').toLowerCase();
  const name = (input.name || '').toLowerCase();
  const placeholder = (input.placeholder || '').toLowerCase();
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

function looksLikeOtpField(input: HTMLInputElement): boolean {
  if (isZipOrPostalField(input)) return false;
  const id = (input.id || '').toLowerCase();
  const name = (input.name || '').toLowerCase();
  const placeholder = (input.placeholder || '').toLowerCase();
  const ariaLabel = (input.getAttribute('aria-label') || '').toLowerCase();
  const autocomplete = (input.getAttribute('autocomplete') || '').toLowerCase();
  if (autocomplete === 'one-time-code') return true;
  // Prefer strong OTP keywords; treat bare "pin" only with 2fa/otp/security context
  const strong = ['otp', 'verification', '2fa', 'two-factor', 'totp', 'mfa', 'one-time', 'onetime'];
  const hay = `${id} ${name} ${placeholder} ${ariaLabel} ${autocomplete}`;
  for (const keyword of strong) {
    if (hay.includes(keyword)) return true;
  }
  // "code" alone is weak — require security-ish neighbours
  if (
    (hay.includes('code') || hay.includes('pin')) &&
    /(security|verify|login|auth|sms|email|confirm|enter)/.test(hay)
  ) {
    return true;
  }
  // inputmode numeric + maxlength 4–8 often OTP (not zip which is often 5–10 without code labels)
  const maxL = input.maxLength;
  if (
    (input.inputMode === 'numeric' || input.type === 'tel' || input.type === 'number') &&
    maxL >= 4 &&
    maxL <= 8 &&
    !isZipOrPostalField(input)
  ) {
    // Only if not labelled as address
    if (!/(address|street|city|state|country|zip|postal)/.test(hay)) return true;
  }
  return false;
}

export function findOtpInputs(): HTMLInputElement[] {
  const oneTimeCodeInput = document.querySelector<HTMLInputElement>(
    'input[autocomplete="one-time-code"]'
  );
  if (oneTimeCodeInput && !isZipOrPostalField(oneTimeCodeInput)) return [oneTimeCodeInput];

  const inputs = document.querySelectorAll<HTMLInputElement>(
    'input[type="text"], input[type="tel"], input[type="number"], input:not([type])'
  );

  const visibleInputs = Array.from(inputs).filter((input: HTMLInputElement) => {
    if (input.type === 'hidden' || input.disabled || input.readOnly) return false;
    if (isZipOrPostalField(input)) return false;
    const rect = input.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });

  const keywordMatched = visibleInputs.filter(looksLikeOtpField);

  if (keywordMatched.length > 0) return keywordMatched;

  const allInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input'));
  let potentialOtpGroup: HTMLInputElement[] = [];

  for (let i = 0; i < allInputs.length; i++) {
    const input = allInputs[i];
    if (isZipOrPostalField(input)) {
      if (potentialOtpGroup.length >= 4 && potentialOtpGroup.length <= 8) return potentialOtpGroup;
      potentialOtpGroup = [];
      continue;
    }
    if (input.type !== 'text' && input.type !== 'tel' && input.type !== 'number') {
      if (potentialOtpGroup.length >= 4 && potentialOtpGroup.length <= 8) return potentialOtpGroup;
      potentialOtpGroup = [];
      continue;
    }
    if (
      input.maxLength === 1 &&
      (input.nextElementSibling?.tagName === 'INPUT' ||
        input.previousElementSibling?.tagName === 'INPUT')
    ) {
      potentialOtpGroup.push(input);
    } else {
      if (potentialOtpGroup.length >= 4 && potentialOtpGroup.length <= 8) return potentialOtpGroup;
      potentialOtpGroup = [];
    }
  }

  if (potentialOtpGroup.length >= 4 && potentialOtpGroup.length <= 8) return potentialOtpGroup;

  return [];
}

export async function fillOtp(otp: string): Promise<void> {
  const inputs = findOtpInputs();
  if (inputs.length === 0) {
    logDebug('No OTP input field found.');
    return;
  }

  if (inputs.length === 1) {
    const input = inputs[0];
    input.value = otp;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const { t } = await import('@/utils/i18n-utils.js');
    await showTooltip(input, await t('contentAutofill.otpFilled'), false);
  } else if (inputs.length > 1 && inputs.length >= otp.length) {
    for (let i = 0; i < otp.length; i++) {
      const input = inputs[i];
      if (input) {
        input.value = otp[i];
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    const { t: t2 } = await import('@/utils/i18n-utils.js');
    await showTooltip(inputs[inputs.length - 1], await t2('contentAutofill.otpFilled'), false);
  } else {
    logDebug('Found OTP inputs, but could not decide how to fill.', {
      numInputs: inputs.length,
      otpLength: otp.length,
    });
  }
}
