import { randomToken } from '@/utils/security/secure-random.js';

export type UsernameRejection = 'taken' | 'invalid';

// These phrases describe host-page errors, not extension UI copy.
const TAKEN =
  /(?:already\s+(?:exists|taken|used|in\s+use|registered)|(?:user\s*name|login|handle|account).{0,60}(?:taken|unavailable|not\s+available|in\s+use)|(?:bereits\s+(?:vergeben|verwendet)|déjà\s+(?:utilisé|pris)|ya\s+(?:existe|está\s+en\s+uso)|既に.{0,12}(?:存在|使用)|すでに.{0,12}使用|已.{0,12}(?:存在|使用|占用)|ถูกใช้แล้ว|مستخدم\s+بالفعل|موجود\s+بالفعل))/i;
const INVALID =
  /(?:invalid|not\s+allowed|not\s+valid|must|too\s+(?:short|long)|ungültig|nicht\s+erlaubt|invalide|non\s+autorisé|no\s+válido|inválido|無効|使用でき|不合法|无效|無效|ไม่ถูกต้อง|غير\s+صالح)/i;

export function classifyUsernameRejection(text: string): UsernameRejection | null {
  if (TAKEN.test(text)) return 'taken';
  return INVALID.test(text) ? 'invalid' : null;
}

function visible(element: Element): boolean {
  if (element.closest('[hidden], [aria-hidden="true"]')) return false;
  const style = getComputedStyle(element);
  return (
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    element.getBoundingClientRect().height > 0
  );
}

/** Only inspect errors associated with this username, never another field's error. */
export function findUsernameRejection(input: HTMLInputElement): UsernameRejection | null {
  const root = input.getRootNode() as Document | ShadowRoot;
  const ids =
    `${input.getAttribute('aria-errormessage') || ''} ${input.getAttribute('aria-describedby') || ''}`
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 16);
  for (const id of ids) {
    const error = root.getElementById?.(id);
    if (!error || !visible(error)) continue;
    const kind = classifyUsernameRejection((error.textContent || '').slice(0, 512));
    if (kind === 'taken' || (kind === 'invalid' && input.getAttribute('aria-invalid') === 'true'))
      return kind;
  }
  // Native validity supplies format feedback even without an error element.
  if (input.validity.patternMismatch || input.validity.tooShort || input.validity.tooLong)
    return 'invalid';
  const container = input.parentElement;
  if (!container) return null;
  const errors = container.querySelectorAll(
    '[role="alert"], [aria-live], .error, .invalid, .field-error, .error-message'
  );
  for (const error of Array.from(errors).slice(0, 16)) {
    // A shared form container can contain unrelated email/password errors.
    const fields = container.querySelectorAll('input:not([type="hidden"]), select, textarea');
    if (fields.length > 1 || !visible(error)) continue;
    const kind = classifyUsernameRejection((error.textContent || '').slice(0, 512));
    if (kind) return kind;
  }
  if (input.getAttribute('aria-invalid') === 'true' && input.validationMessage) {
    return classifyUsernameRejection(input.validationMessage);
  }
  return null;
}

/** Validate a detached clone, excluding the server's stale customValidity error. */
export function acceptsUsername(input: HTMLInputElement, value: string): boolean {
  const min = Math.max(1, input.minLength);
  const max = input.maxLength < 0 ? 512 : Math.min(512, input.maxLength);
  if (!value.trim() || value.length < min || value.length > max) return false;
  const probe = input.cloneNode(false) as HTMLInputElement;
  probe.removeAttribute('disabled');
  probe.removeAttribute('readonly');
  probe.value = value;
  return (
    !probe.validity.patternMismatch && !probe.validity.typeMismatch && !probe.validity.badInput
  );
}

/** Bounded local proposals; complex/unsatisfiable patterns fall back to editing. */
export function proposeUsername(
  input: HTMLInputElement,
  generated: string,
  rejected: ReadonlySet<string>
): string | null {
  const max = input.maxLength < 0 ? 512 : Math.min(512, input.maxLength);
  const min = Math.max(1, input.minLength);
  if (min > max) return null;
  const base = generated.replace(/[^a-z0-9_]/gi, '').slice(0, max);
  const fit = (prefix: string, suffix: string) =>
    `${prefix.slice(0, Math.max(0, max - suffix.length))}${suffix.slice(0, max)}`;
  for (let attempt = 0; attempt < 16; attempt++) {
    const token = randomToken(Math.max(min, Math.min(max, 6)));
    const letters = token.replace(/[0-9]/g, 'a');
    const digits = Array.from(token, (char) => String(char.charCodeAt(0) % 10)).join('');
    const candidates = [
      fit(base, digits),
      fit(base.toLowerCase().replace(/[^a-z]/g, ''), letters),
      fit(base.toUpperCase().replace(/[^A-Z]/g, ''), letters.toUpperCase()),
      digits,
      token,
    ];
    for (const candidate of candidates) {
      if (!rejected.has(candidate.toLowerCase()) && acceptsUsername(input, candidate))
        return candidate;
    }
  }
  return null;
}
