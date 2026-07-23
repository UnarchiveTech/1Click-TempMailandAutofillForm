import { browser } from 'wxt/browser';

/**
 * Form filling logic: fills signup form fields with generated / stored data
 */

import { decrypt, encrypt } from '@/utils/crypto.js';
import { NoActiveInboxError } from '@/utils/errors.js';
import { logError } from '@/utils/logger.js';
import { randomItem } from '@/utils/secure-random.js';
import type { CredentialsHistoryItem } from '@/utils/types.js';
import {
  generatePhoneNumber,
  generateRandomName,
  generateSmartPassword,
  generateUsername,
  generateWebsiteUrl,
} from './generators.js';

export interface FilledNames {
  firstName: string;
  lastName: string;
  fullName: string;
}

export async function getPasswordToFill(
  field?: HTMLInputElement | null,
  form?: HTMLFormElement | Document | null
): Promise<string> {
  const { passwordSettings = {} } = (await browser.storage.local.get(['passwordSettings'])) as {
    passwordSettings?: { useCustom?: boolean; customPassword?: string };
  };
  if (passwordSettings.useCustom && passwordSettings.customPassword) {
    try {
      return await decrypt(passwordSettings.customPassword);
    } catch {
      // Legacy plaintext custom password
      return passwordSettings.customPassword;
    }
  }
  return generateSmartPassword(field, form || field?.form || document);
}

/** Whether autofill can run: setup done + at least one live address. */
export type AutofillBlockReason = 'setup' | 'no_active' | 'expired' | null;

export async function getAutofillBlockReason(): Promise<AutofillBlockReason> {
  const {
    inboxes = [],
    activeInboxId,
    onboardingComplete,
  } = (await browser.storage.local.get(['inboxes', 'activeInboxId', 'onboardingComplete'])) as {
    inboxes?: Array<{
      id: string;
      address: string;
      status?: string;
      accountStatus?: string;
      expiresAt?: number;
    }>;
    activeInboxId?: string;
    onboardingComplete?: boolean;
  };

  const now = Date.now();
  const isLive = (i: { status?: string; accountStatus?: string; expiresAt?: number }) => {
    if (i.accountStatus === 'archived' || i.accountStatus === 'deleted') return false;
    if (i.status === 'archived' || i.status === 'deleted' || i.status === 'expired') return false;
    if (i.expiresAt && i.expiresAt > 0 && i.expiresAt <= now) return false;
    return true;
  };

  if (!Array.isArray(inboxes) || inboxes.length === 0) {
    // Brand-new install / hard reset — need setup
    return onboardingComplete === false || inboxes.length === 0 ? 'setup' : 'no_active';
  }

  const live = inboxes.filter(isLive);
  if (live.length === 0) return 'no_active';

  const active = activeInboxId ? inboxes.find((i) => i.id === activeInboxId) : null;
  if (active && !isLive(active)) return 'expired';
  // Prefer having some live inbox even if active pointer is stale
  if (!active && live.length > 0) return null;
  return null;
}

function fieldMeta(el: HTMLInputElement): string {
  const labelText = (() => {
    try {
      if (el.labels && el.labels.length > 0) {
        return Array.from(el.labels)
          .map((l) => l.textContent || '')
          .join(' ');
      }
      const id = el.id;
      if (id) {
        const lab = el.ownerDocument?.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (lab?.textContent) return lab.textContent;
      }
    } catch {
      /* ignore */
    }
    return '';
  })();
  return `${el.name} ${el.id} ${el.placeholder} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('autocomplete') || ''} ${labelText}`.toLowerCase();
}

function isPasswordish(meta: string, el: HTMLInputElement): boolean {
  if (el.type === 'password') return true;
  return /password|passwd|pwd|secret|passcode/.test(meta);
}

function looksLikeEmailField(el: HTMLInputElement): boolean {
  if (el.type === 'hidden' || el.disabled || el.readOnly) return false;
  const meta = fieldMeta(el);
  if (isPasswordish(meta, el)) return false;
  if (el.type === 'email') return true;
  if (el.autocomplete === 'email') return true;
  // Explicit email / confirm-email patterns (including type=text)
  if (
    /e-?mail|mail|confirm\s*e-?mail|re-?enter\s*e-?mail|repeat\s*e-?mail|verify\s*e-?mail|email2|email_confirm|confirm_email|emailconfirmation|email-confirm|user_email/.test(
      meta
    )
  ) {
    return true;
  }
  // Confirm-only fields that aren't password
  if (/confirm|reenter|re-enter|repeat|verify/.test(meta) && /mail|email/.test(meta)) {
    return true;
  }
  return false;
}

/** All email / confirm-email inputs in a form (same address goes into each). */
export function queryEmailInputs(root: ParentNode = document): HTMLInputElement[] {
  const nodes = root.querySelectorAll<HTMLInputElement>(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="password"])'
  );
  const result: HTMLInputElement[] = [];
  const seen = new Set<HTMLInputElement>();
  for (const el of Array.from(nodes)) {
    if (seen.has(el)) continue;
    if (!looksLikeEmailField(el)) continue;
    seen.add(el);
    result.push(el);
  }
  return result;
}

/** Set value in a way React/Vue/Angular controlled inputs accept. */
export function fillInputValue(
  input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null,
  value: string | null
): void {
  if (!input || value === null || value === undefined) return;
  try {
    input.focus?.();
  } catch {
    /* ignore */
  }
  const tag = input.tagName.toLowerCase();
  try {
    if (tag === 'select') {
      const sel = input as HTMLSelectElement;
      // Prefer exact option match, else partial
      const opts = Array.from(sel.options);
      const exact =
        opts.find((o) => o.value === value) ||
        opts.find((o) => (o.textContent || '').trim() === value);
      const partial = opts.find(
        (o) =>
          o.value.toLowerCase().includes(value.toLowerCase()) ||
          (o.textContent || '').toLowerCase().includes(value.toLowerCase())
      );
      const pick = exact || partial;
      if (pick) {
        sel.value = pick.value;
        sel.dispatchEvent(new Event('input', { bubbles: true }));
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return;
    }
    const proto =
      tag === 'textarea' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc?.set) {
      desc.set.call(input, value);
    } else {
      (input as HTMLInputElement).value = value;
    }
  } catch {
    try {
      (input as HTMLInputElement).value = value;
    } catch {
      /* ignore */
    }
  }
  // React 16+/17 tracker + Vue/Svelte-friendly events
  try {
    const tracker = (input as unknown as { _valueTracker?: { setValue: (v: string) => void } })
      ._valueTracker;
    tracker?.setValue?.('');
  } catch {
    /* ignore */
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  try {
    input.dispatchEvent(
      new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' })
    );
  } catch {
    /* older engines */
  }
  try {
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Unidentified' }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Unidentified' }));
  } catch {
    /* ignore */
  }
  try {
    input.blur?.();
    input.focus?.();
  } catch {
    /* ignore */
  }
}

/** Fill every email / confirm-email field in the form (or just the given field). */
export function fillAllEmailFields(
  form: HTMLFormElement | null,
  address: string,
  fallbackField?: HTMLInputElement | HTMLSelectElement | null
): void {
  const root: ParentNode = form ?? document;
  const fields = queryEmailInputs(root);
  // Also include fields outside the form but on the page when form is provided
  // (some sites put confirm-email in a sibling block).
  const pageFields = form ? queryEmailInputs(document) : [];
  const all = new Set<HTMLInputElement>([...fields, ...pageFields]);
  // Always force the focused field first so confirm-* twins get the same value
  if (fallbackField && fallbackField instanceof HTMLInputElement) {
    fillInputValue(fallbackField, address);
  }
  if (all.size > 0) {
    for (const el of all) fillInputValue(el, address);
    return;
  }
  if (fallbackField && fallbackField instanceof HTMLInputElement) {
    fillInputValue(fallbackField, address);
  }
}

/** True if this email already appears in saved login history for any domain. */
export async function isEmailUsedInSavedLogins(email: string): Promise<boolean> {
  const needle = (email || '').trim().toLowerCase();
  if (!needle) return false;
  try {
    const { loginInfo = [] } = (await browser.storage.local.get(['loginInfo'])) as {
      loginInfo?: CredentialsHistoryItem[];
    };
    return loginInfo.some((l) => {
      const candidates = [l.email, l.username, (l as { address?: string }).address];
      return candidates.some((c) => (c || '').trim().toLowerCase() === needle);
    });
  } catch {
    return false;
  }
}

/** Collect privacy / terms / policy links from the form (and nearby page links). */
export function extractPolicyUrls(form: HTMLFormElement | null): string[] {
  const urls = new Set<string>();
  const roots: ParentNode[] = form ? [form, document] : [document];
  const re = /privacy|terms|conditions|policy|tos|legal|gdpr|cookie/i;
  for (const root of roots) {
    try {
      const links = root.querySelectorAll<HTMLAnchorElement>('a[href]');
      for (const a of Array.from(links)) {
        const text = `${a.textContent || ''} ${a.getAttribute('href') || ''}`;
        if (!re.test(text)) continue;
        try {
          const abs = new URL(a.href, location.href).href;
          if (abs.startsWith('http')) urls.add(abs);
        } catch {
          /* ignore */
        }
        if (urls.size >= 8) break;
      }
    } catch {
      /* ignore */
    }
  }
  return Array.from(urls);
}

/**
 * Assign a data-URL image to file inputs that look like avatar/profile upload fields.
 * Uses DataTransfer so React/Vue controlled file inputs receive a real FileList.
 */
export async function fillProfilePictureInputs(
  form: HTMLFormElement | Document,
  dataUrl: string
): Promise<boolean> {
  try {
    const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
    if (!m) return false;
    const mime = m[1];
    const b64 = m[2];
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ext = mime.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
    const file = new File([bytes], `profile.${ext}`, { type: mime });

    const inputs = form.querySelectorAll<HTMLInputElement>(
      'input[type="file"][accept*="image" i], input[type="file"][name*="avatar" i], input[type="file"][id*="avatar" i], input[type="file"][name*="photo" i], input[type="file"][id*="photo" i], input[type="file"][name*="profile" i], input[type="file"][id*="profile" i], input[type="file"][name*="picture" i], input[type="file"][id*="picture" i], input[type="file"]'
    );
    let filled = false;
    for (const input of Array.from(inputs)) {
      // Skip clearly non-image multi-file document uploads
      const accept = (input.getAttribute('accept') || '').toLowerCase();
      if (accept && !accept.includes('image') && !accept.includes('*/*') && accept !== '') {
        // still allow if name/id hints at avatar
        const hint = `${input.name} ${input.id}`.toLowerCase();
        if (!/avatar|photo|profile|picture|image|logo|icon/.test(hint)) continue;
      }
      try {
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        filled = true;
      } catch {
        /* some browsers lock .files */
      }
    }
    return filled;
  } catch (e) {
    logError('fillProfilePictureInputs failed', e);
    return false;
  }
}

/** Best anchor element for the Autofill All control (heading or first field). */
export function findAutofillAllAnchor(form: HTMLFormElement): HTMLElement {
  const headingSel = 'h1, h2, h3, h4, legend, [class*="title" i], [class*="heading" i]';
  // Previous siblings often hold "Create your free account"
  let sib: Element | null = form.previousElementSibling;
  for (let i = 0; i < 6 && sib; i++) {
    if (sib.matches?.(headingSel)) return sib as HTMLElement;
    const inner = sib.querySelector?.(headingSel);
    if (inner) return inner as HTMLElement;
    const text = (sib.textContent || '').toLowerCase();
    if (
      /create|register|sign\s*up|join|account|free/.test(text) &&
      (sib as HTMLElement).offsetHeight > 0
    ) {
      return sib as HTMLElement;
    }
    sib = sib.previousElementSibling;
  }
  const internal = form.querySelector(headingSel);
  if (internal) return internal as HTMLElement;
  const firstField = form.querySelector<HTMLElement>(
    'input:not([type="hidden"]), select, textarea, button[type="submit"]'
  );
  return firstField || form;
}

export async function getNamesToFill(): Promise<FilledNames> {
  const { nameSettings = {} } = (await browser.storage.local.get(['nameSettings'])) as {
    nameSettings?: { useCustom?: boolean; firstName?: string; lastName?: string };
  };
  if (nameSettings.useCustom && nameSettings.firstName && nameSettings.lastName) {
    return {
      firstName: nameSettings.firstName,
      lastName: nameSettings.lastName,
      fullName: `${nameSettings.firstName} ${nameSettings.lastName}`,
    };
  }
  const randomFullName = generateRandomName();
  const [randomFirstName, randomLastName] = randomFullName.split(' ');
  return { firstName: randomFirstName, lastName: randomLastName, fullName: randomFullName };
}

function validSelectOptions(selectElement: HTMLSelectElement): HTMLOptionElement[] {
  return Array.from(selectElement.options).filter(
    (option: HTMLOptionElement) =>
      !option.disabled &&
      option.value &&
      option.value.trim() !== '' &&
      !/select|choose|pick/i.test(option.textContent ?? '')
  );
}

export function fillSelectElement(selectElement: HTMLSelectElement): void {
  const validOptions = validSelectOptions(selectElement);
  if (validOptions.length > 0) {
    const randomOption = randomItem(validOptions);
    if (!randomOption) return;
    selectElement.value = randomOption.value;
  }
}

/** Match a select option to preferred values (value, text, or substring). */
function matchSelectOption(
  selectElement: HTMLSelectElement,
  preferred: string[]
): HTMLOptionElement | null {
  const validOptions = validSelectOptions(selectElement);
  const prefs = preferred.map((p) => p.trim().toLowerCase()).filter(Boolean);
  if (prefs.length === 0 || validOptions.length === 0) return null;

  for (const pref of prefs) {
    const exact = validOptions.find(
      (o) => o.value.toLowerCase() === pref || (o.textContent || '').trim().toLowerCase() === pref
    );
    if (exact) return exact;
  }
  for (const pref of prefs) {
    if (pref.length < 2) continue;
    const partial = validOptions.find((o) => {
      const val = o.value.toLowerCase();
      const text = (o.textContent || '').toLowerCase();
      return val.includes(pref) || text.includes(pref) || pref.includes(val);
    });
    if (partial) return partial;
  }
  return null;
}

function selectMeta(select: HTMLSelectElement): string {
  const labelText = (() => {
    try {
      if (select.labels && select.labels.length > 0) {
        return Array.from(select.labels)
          .map((l) => l.textContent || '')
          .join(' ');
      }
      if (select.id) {
        const lab = select.ownerDocument?.querySelector(`label[for="${CSS.escape(select.id)}"]`);
        if (lab?.textContent) return lab.textContent;
      }
    } catch {
      /* ignore */
    }
    return '';
  })();
  return `${select.name} ${select.id} ${select.getAttribute('aria-label') || ''} ${select.getAttribute('autocomplete') || ''} ${labelText}`.toLowerCase();
}

const COUNTRY_NAME_BY_CODE: Record<string, string[]> = {
  us: ['united states', 'usa', 'u.s.', 'u.s.a.', 'america'],
  gb: ['united kingdom', 'uk', 'great britain', 'england', 'britain'],
  de: ['germany', 'deutschland'],
  fr: ['france'],
  es: ['spain', 'españa', 'espana'],
  it: ['italy', 'italia'],
  ca: ['canada'],
  au: ['australia'],
  in: ['india'],
  jp: ['japan'],
  cn: ['china'],
  br: ['brazil', 'brasil'],
  mx: ['mexico', 'méxico'],
  nl: ['netherlands', 'holland'],
  se: ['sweden'],
  no: ['norway'],
  dk: ['denmark'],
  fi: ['finland'],
  pl: ['poland'],
  pt: ['portugal'],
  ru: ['russia'],
  kr: ['south korea', 'korea'],
  sg: ['singapore'],
  ae: ['united arab emirates', 'uae'],
  ch: ['switzerland'],
  at: ['austria'],
  be: ['belgium'],
  ie: ['ireland'],
  nz: ['new zealand'],
};

function countryPreferredValues(codeOrName: string): string[] {
  const raw = codeOrName.trim();
  if (!raw) return [];
  const lower = raw.toLowerCase();
  const out = new Set<string>([raw, lower, raw.toUpperCase()]);
  const aliases = COUNTRY_NAME_BY_CODE[lower];
  if (aliases) {
    for (const a of aliases) out.add(a);
  }
  // If full name stored, also try reverse-lookup code
  for (const [code, names] of Object.entries(COUNTRY_NAME_BY_CODE)) {
    if (names.some((n) => n === lower || lower.includes(n))) {
      out.add(code);
      out.add(code.toUpperCase());
    }
  }
  return Array.from(out);
}

function genderPreferredValues(gender: string): string[] {
  const g = gender.toLowerCase().trim();
  if (g === 'male' || g === 'm') return ['male', 'm', 'man', 'boy', '1'];
  if (g === 'female' || g === 'f') return ['female', 'f', 'woman', 'girl', '2'];
  if (g === 'other') return ['other', 'non-binary', 'nonbinary', 'x', '3'];
  if (g === 'prefer_not' || g === 'prefer not')
    return ['prefer not', 'prefer not to say', 'undisclosed', 'n/a', 'na', 'unknown'];
  return [g];
}

/**
 * Fill selects preferring identity country/gender when the control looks related;
 * otherwise fall back to random valid option.
 */
export function fillSelectsWithIdentity(
  form: HTMLFormElement,
  identity?: {
    country?: string | null;
    gender?: string | null;
  }
): void {
  const countryPrefs = identity?.country ? countryPreferredValues(identity.country) : [];
  const genderPrefs = identity?.gender ? genderPreferredValues(identity.gender) : [];

  form.querySelectorAll<HTMLSelectElement>('select').forEach((select) => {
    const meta = selectMeta(select);
    let matched: HTMLOptionElement | null = null;

    if (countryPrefs.length && /country|nation|region|locale|citizenship/.test(meta)) {
      matched = matchSelectOption(select, countryPrefs);
    } else if (genderPrefs.length && /gender|sex/.test(meta)) {
      matched = matchSelectOption(select, genderPrefs);
    }

    if (matched) {
      select.value = matched.value;
    } else {
      // Last resort: try country/gender prefs on any unmatched select that has a hit
      if (!matched && countryPrefs.length) {
        matched = matchSelectOption(select, countryPrefs);
      }
      if (!matched && genderPrefs.length) {
        matched = matchSelectOption(select, genderPrefs);
      }
      if (matched) select.value = matched.value;
      else fillSelectElement(select);
    }

    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/**
 * Fill a signup form using a previously-saved disposable identity (replay).
 *
 * Unlike `fillSignupForm`'s generate path, this:
 *  - uses the saved email / password / username / name / phone / website
 *    verbatim (no generation, no random selection)
 *  - still dispatches `input` + `change` events so React/Vue/etc. pick it up
 *  - still calls `updateAndCopyCredentials` so the session credential + clipboard
 *    stay consistent
 *  - does NOT append a new `loginInfo` entry (it's a re-use, not a new fill)
 */
async function fillFormWithReplayCredential(
  form: HTMLFormElement,
  updateAndCopyCredentials: (creds: Record<string, string>) => Promise<void>,
  cred: {
    email: string;
    password: string;
    username?: string | null;
    name?: string | null;
    phone?: string | null;
    website?: string | null;
  }
): Promise<boolean> {
  const usernameInput = form.querySelector<HTMLInputElement>(
    'input[name*="username"], input[id*="username"], input[name*="userid"], input[id*="userid"], ' +
      'input[name*="login"], input[id*="login"], input[placeholder*="username" i], input[placeholder*="user id" i], input[placeholder*="login" i]'
  );
  const phoneInput = form.querySelector<HTMLInputElement>(
    'input[type="tel"], input[name*="phone"], input[id*="phone"], input[name*="mobile"], input[id*="mobile"], input[placeholder*="phone"], input[placeholder*="mobile"]'
  );
  const websiteInput = form.querySelector<HTMLInputElement>(
    'input[type="url"], input[name*="website"], input[id*="website"], input[placeholder*="website"], input[name*="url"], input[id*="url"], input[placeholder*="url"]'
  );
  const firstNameInput = form.querySelector<HTMLInputElement>(
    'input[name*="firstname" i], input[id*="firstname" i], input[name*="fname" i], input[id*="fname" i], input[placeholder*="first name" i]'
  );
  const lastNameInput = form.querySelector<HTMLInputElement>(
    'input[name*="lastname" i], input[id*="lastname" i], input[name*="lname" i], input[id*="lname" i], input[placeholder*="last name" i]'
  );
  const fullNameInput = form.querySelector<HTMLInputElement>(
    'input[name*="fullname" i], input[id*="fullname" i], input[name*="name"]:not([name*="user"]):not([name*="first"]):not([name*="last"]), input[id*="name"]:not([id*="user"]):not([id*="first"]):not([name*="last"]), input[placeholder*="full name" i], input[placeholder*="name" i]:not([placeholder*="user"]):not([placeholder*="first"]):not([placeholder*="last"])'
  );

  // Derive first/last/full name from the saved name for split-name fields
  const savedName = cred.name || '';
  const [savedFirst, ...rest] = savedName.split(' ');
  const savedLast = rest.join(' ');

  fillAllEmailFields(form, cred.email);
  fillInputValue(usernameInput, cred.username ?? null);

  let nameFilled = false;
  if (firstNameInput && lastNameInput) {
    fillInputValue(firstNameInput, savedFirst || null);
    fillInputValue(lastNameInput, savedLast || null);
    nameFilled = true;
  } else if (fullNameInput) {
    fillInputValue(fullNameInput, savedName || null);
    nameFilled = true;
  }

  // Prefer saved country/gender on selects when present on the credential
  fillSelectsWithIdentity(form, {
    country: (cred as { country?: string | null }).country,
    gender: (cred as { gender?: string | null }).gender,
  });

  fillInputValue(phoneInput, cred.phone ?? null);
  fillInputValue(websiteInput, cred.website ?? null);

  form
    .querySelectorAll<HTMLInputElement>(
      'input[type="password"], input[name*="password"], input[id*="password"]'
    )
    .forEach((input: HTMLInputElement) => {
      fillInputValue(input, cred.password);
    });

  const termsCheckbox = form.querySelector<HTMLInputElement>(
    'input[type="checkbox"][name*="terms"], input[type="checkbox"][id*="terms"], input[type="checkbox"][name*="agree"], input[type="checkbox"][id*="agree"]'
  );
  if (termsCheckbox && !termsCheckbox.checked) termsCheckbox.click();

  // Build session credentials for clipboard copy (consistent with generate path)
  const credentials: Record<string, string> = {};
  credentials.website = cred.website || window.location.hostname;
  credentials.email = cred.email;
  if (cred.username) credentials.username = cred.username;
  credentials.password = cred.password;
  if (nameFilled) credentials.name = savedName;
  if (cred.phone) credentials.phone = cred.phone;

  await updateAndCopyCredentials(credentials);

  // NOTE: intentionally do NOT append to loginInfo - this is a replay of an
  // existing identity, not a new fill. The original entry remains the record.

  return true;
}

export async function fillSignupForm(
  form: HTMLFormElement,
  updateAndCopyCredentials: (creds: Record<string, string>) => Promise<void>,
  identity?: {
    firstNames?: string;
    lastNames?: string;
    useRandomPassword?: boolean;
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
    profilePicture?: string | null;
  },
  replayCredential?: {
    email: string;
    password: string;
    username?: string | null;
    name?: string | null;
    phone?: string | null;
    website?: string | null;
    country?: string | null;
    gender?: string | null;
    dateOfBirth?: string | null;
    pin?: string | null;
  }
): Promise<boolean> {
  try {
    const { activeInboxId, inboxes = [] } = (await browser.storage.local.get([
      'activeInboxId',
      'inboxes',
    ])) as { activeInboxId?: string; inboxes?: Array<{ id: string; address: string }> };
    const inbox = inboxes.find((i: { id: string; address: string }) => i.id === activeInboxId);
    if (!inbox) throw new NoActiveInboxError({ activeInboxId });

    // ── Replay path: use the saved identity instead of generating ──────
    // When replayCredential is provided, skip all generation and fill the
    // form with the exact saved values. Do NOT append a new loginInfo entry
    // (it's a re-use of an existing identity, not a new fill).
    if (replayCredential) {
      return fillFormWithReplayCredential(form, updateAndCopyCredentials, replayCredential);
    }

    let names: FilledNames;
    if (identity?.firstNames && identity?.lastNames) {
      // Parse comma-separated names and select randomly
      const firstNameList = identity.firstNames
        .split(',')
        .map((n) => n.trim())
        .filter((n) => n);
      const lastNameList = identity.lastNames
        .split(',')
        .map((n) => n.trim())
        .filter((n) => n);

      const firstName = randomItem(firstNameList) ?? '';
      const lastName = randomItem(lastNameList) ?? '';

      names = {
        firstName,
        lastName,
        fullName: `${firstName} ${lastName}`,
      };
    } else {
      names = await getNamesToFill();
    }

    const { fullName, firstName, lastName } = names;

    const usernameInput = form.querySelector<HTMLInputElement>(
      'input[name*="username"], input[id*="username"], input[name*="userid"], input[id*="userid"], ' +
        'input[name*="login"], input[id*="login"], input[placeholder*="username" i], input[placeholder*="user id" i], input[placeholder*="login" i]'
    );
    const phoneInput = form.querySelector<HTMLInputElement>(
      'input[type="tel"], input[name*="phone"], input[id*="phone"], input[name*="mobile"], input[id*="mobile"], input[placeholder*="phone"], input[placeholder*="mobile"]'
    );
    const websiteInput = form.querySelector<HTMLInputElement>(
      'input[type="url"], input[name*="website"], input[id*="website"], input[placeholder*="website"], input[name*="url"], input[id*="url"], input[placeholder*="url"]'
    );
    const firstNameInput = form.querySelector<HTMLInputElement>(
      'input[name*="firstname" i], input[id*="firstname" i], input[name*="fname" i], input[id*="fname" i], input[placeholder*="first name" i]'
    );
    const lastNameInput = form.querySelector<HTMLInputElement>(
      'input[name*="lastname" i], input[id*="lastname" i], input[name*="lname" i], input[id*="lname" i], input[placeholder*="last name" i]'
    );
    const fullNameInput = form.querySelector<HTMLInputElement>(
      'input[name*="fullname" i], input[id*="fullname" i], input[name*="name"]:not([name*="user"]):not([name*="first"]):not([name*="last"]), input[id*="name"]:not([id*="user"]):not([id*="first"]):not([name*="last"]), input[placeholder*="full name" i], input[placeholder*="name" i]:not([placeholder*="user"]):not([placeholder*="first"]):not([placeholder*="last"])'
    );

    // Prefer identity.preferredEmail when it still exists in the mailbox list
    const identityWithEmail = identity as
      | {
          preferredEmail?: string | null;
          state?: string | null;
          address?: string | null;
          profilePicture?: string | null;
        }
      | undefined;
    const preferred = identityWithEmail?.preferredEmail?.trim();
    let emailAddress = inbox.address;
    if (preferred) {
      const match = inboxes.find(
        (i: { id: string; address: string }) => i.address.toLowerCase() === preferred.toLowerCase()
      );
      if (match) emailAddress = match.address;
    }

    // If the chosen email is already in saved logins, warn + create a fresh inbox
    if (await isEmailUsedInSavedLogins(emailAddress)) {
      try {
        const tipHost =
          form.querySelector<HTMLElement>(
            'input[type="email"], input[name*="email" i], input[id*="email" i]'
          ) || (form as unknown as HTMLElement);
        const { showConflictChip } = await import('../dom/tooltip.js');
        const { t: translate } = await import('@/utils/i18n-utils.js');
        showConflictChip(tipHost, await translate('contentAutofill.emailAlreadyUsedChip'));

        const { selectedProvider } = (await browser.storage.local.get('selectedProvider')) as {
          selectedProvider?: string;
        };
        const provider = selectedProvider || 'guerrilla';
        const created = (await browser.runtime.sendMessage({
          type: 'createInbox',
          provider,
        })) as {
          success?: boolean;
          address?: string;
          inbox?: { address?: string };
        };
        const fresh = created?.inbox?.address || created?.address;
        if (created?.success && fresh) emailAddress = fresh;
      } catch (e) {
        logError('Failed to generate replacement email for already-used address', e);
      }
    }

    let password: string;
    if (!identity?.useRandomPassword && identity?.customPassword) {
      try {
        password = await decrypt(identity.customPassword);
      } catch {
        throw new Error('Vault locked - unlock to use saved identity');
      }
    } else {
      const pwField = form.querySelector<HTMLInputElement>(
        'input[type="password"], input[name*="password" i], input[id*="password" i]'
      );
      password = await getPasswordToFill(pwField, form);
    }

    const randomUsername = usernameInput ? generateUsername() : null;
    const randomPhone = identity?.phone || (phoneInput ? generatePhoneNumber() : null);

    let randomWebsite: string | null = null;
    if (websiteInput) {
      const placeholder = websiteInput.placeholder;
      randomWebsite =
        placeholder && (placeholder.startsWith('http') || placeholder.startsWith('www'))
          ? placeholder
          : generateWebsiteUrl();
    }

    // Fill email + confirm-email (and any page-level email twins) with the same address
    fillAllEmailFields(form, emailAddress);
    fillInputValue(usernameInput, randomUsername);

    let nameFilled = false;
    if (firstNameInput && lastNameInput) {
      fillInputValue(firstNameInput, firstName);
      fillInputValue(lastNameInput, lastName);
      nameFilled = true;
    } else if (fullNameInput) {
      fillInputValue(fullNameInput, fullName);
      nameFilled = true;
    }

    // Prefer identity country/gender on matching selects (never random country when set)
    fillSelectsWithIdentity(form, {
      country: identity?.country,
      gender: identity?.gender,
    });

    fillInputValue(phoneInput, randomPhone);
    fillInputValue(websiteInput, randomWebsite);

    // DOB / pin / zip from identity when fields exist
    if (identity?.dateOfBirth) {
      form
        .querySelectorAll<HTMLInputElement>(
          'input[type="date"], input[name*="dob" i], input[id*="dob" i], input[name*="birth" i], input[id*="birth" i], input[autocomplete="bday"]'
        )
        .forEach((input) => {
          fillInputValue(input, identity.dateOfBirth || null);
        });
    }
    if (identity?.pin) {
      form
        .querySelectorAll<HTMLInputElement>(
          'input[name*="zip" i], input[id*="zip" i], input[name*="postal" i], input[id*="postal" i], input[name*="pin" i], input[id*="pin" i], input[autocomplete="postal-code"]'
        )
        .forEach((input) => {
          fillInputValue(input, identity.pin || null);
        });
    }
    if (identity?.city) {
      form
        .querySelectorAll<HTMLInputElement>(
          'input[name*="city" i], input[id*="city" i], input[autocomplete="address-level2"], input[placeholder*="city" i]'
        )
        .forEach((input) => {
          fillInputValue(input, identity.city || null);
        });
    }

    form
      .querySelectorAll<HTMLInputElement>(
        'input[type="password"], input[name*="password"], input[id*="password"]'
      )
      .forEach((input: HTMLInputElement) => {
        fillInputValue(input, password);
      });

    // Accept terms / privacy / marketing checkboxes commonly required to proceed
    form
      .querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"][name*="terms" i], input[type="checkbox"][id*="terms" i], input[type="checkbox"][name*="agree" i], input[type="checkbox"][id*="agree" i], input[type="checkbox"][name*="privacy" i], input[type="checkbox"][id*="privacy" i], input[type="checkbox"][name*="policy" i], input[type="checkbox"][id*="policy" i], input[type="checkbox"][name*="tos" i], input[type="checkbox"][id*="tos" i]'
      )
      .forEach((cb) => {
        if (!cb.checked) {
          try {
            cb.click();
          } catch {
            cb.checked = true;
            cb.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      });

    const policyUrls = extractPolicyUrls(form);

    // Identity state / street address when present
    if (identity) {
      const idExtra = identity as {
        state?: string | null;
        address?: string | null;
        city?: string | null;
      };
      if (idExtra.state) {
        form
          .querySelectorAll<HTMLInputElement>(
            'input[name*="state" i], input[id*="state" i], input[name*="province" i], input[id*="province" i], input[autocomplete="address-level1"]'
          )
          .forEach((el) => {
            fillInputValue(el, idExtra.state || null);
          });
      }
      if (idExtra.address) {
        form
          .querySelectorAll<HTMLInputElement>(
            'input[name*="address" i], input[id*="street" i], input[autocomplete="street-address"], textarea[name*="address" i]'
          )
          .forEach((el) => {
            fillInputValue(el as HTMLInputElement, idExtra.address || null);
          });
      }
      // Profile picture → file inputs (avatar / photo / profile)
      const pic = (identity as { profilePicture?: string | null }).profilePicture || null;
      if (pic?.startsWith('data:image')) {
        void fillProfilePictureInputs(form, pic);
      }
    }

    const pageHost = window.location.hostname;
    const credentials: Record<string, string> = {};
    if (randomWebsite) credentials.website = randomWebsite;
    else credentials.website = pageHost;
    credentials.email = emailAddress;
    if (randomUsername) credentials.username = randomUsername;
    credentials.password = password;
    if (nameFilled) credentials.name = fullName;
    if (randomPhone) credentials.phone = randomPhone;
    if (identity?.country) credentials.country = identity.country;
    if (identity?.gender) credentials.gender = identity.gender;
    if (identity?.dateOfBirth) credentials.dateOfBirth = identity.dateOfBirth;
    if (identity?.pin) credentials.pin = identity.pin;
    if (policyUrls.length) credentials.policyUrls = policyUrls.join('\n');

    await updateAndCopyCredentials(credentials);

    const { loginInfo = [], selectedIdentityId } = (await browser.storage.local.get([
      'loginInfo',
      'selectedIdentityId',
    ])) as {
      loginInfo?: CredentialsHistoryItem[];
      selectedIdentityId?: string;
    };
    // Encrypt password at rest. Never abort the whole save if encryption fails -
    // otherwise successful autofill leaves no saved-login history.
    let storedPassword = password;
    try {
      storedPassword = await encrypt(password);
    } catch (err) {
      logError('Failed to encrypt password before saving credential (storing as-is):', err);
    }

    const newCredential: CredentialsHistoryItem = {
      id: `login_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      email: emailAddress,
      username: randomUsername,
      name: nameFilled ? fullName : null,
      phone: randomPhone,
      website: randomWebsite || pageHost,
      password: storedPassword,
      domain: pageHost,
      timestamp: Date.now(),
      inboxId: activeInboxId,
      identityId: selectedIdentityId ?? undefined,
      country: identity?.country ?? null,
      gender: identity?.gender ?? null,
      dateOfBirth: identity?.dateOfBirth ?? null,
      pin: identity?.pin ?? null,
      policyUrls: policyUrls.length ? policyUrls : undefined,
    };

    // Prefer background write (more reliable than content-script storage on some hosts)
    try {
      const bg = (await browser.runtime.sendMessage({
        type: 'saveLoginCredential',
        credential: newCredential,
      })) as { success?: boolean };
      if (!bg?.success) {
        throw new Error('background saveLoginCredential failed');
      }
    } catch (bgErr) {
      logError('Background login save failed, falling back to local storage', bgErr);
      loginInfo.unshift(newCredential);
      if (loginInfo.length > 50) loginInfo.length = 50;
      await browser.storage.local.set({ loginInfo });
    }

    return true;
  } catch (error: unknown) {
    logError(
      'Error filling form:',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
    return false;
  }
}
