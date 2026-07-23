/**
 * Random data generators for form autofill
 */

import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PHONE_AREA_CODE_MAX,
  PHONE_AREA_CODE_MIN,
  PHONE_LAST_PART_MAX,
  PHONE_LAST_PART_MIN,
  PHONE_PART_MAX,
  PHONE_PART_MIN,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from '@/utils/constants.js';
import {
  randomChance,
  randomInt,
  randomIntBetween,
  randomItem,
  randomToken,
} from '@/utils/secure-random.js';

export interface PasswordRules {
  minLength: number;
  maxLength: number;
  requireUpper: boolean;
  requireLower: boolean;
  requireDigit: boolean;
  requireSpecial: boolean;
  specialChars: string;
}

const DEFAULT_SPECIAL = '!@#$%^&*()_+-=[]{}|;:,.<>?';

/** Infer password rules from the input + nearby labels / minlength / pattern / text. */
export function detectPasswordRules(
  field?: HTMLInputElement | null,
  form?: HTMLFormElement | Document | null
): PasswordRules {
  const rules: PasswordRules = {
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
    requireUpper: true,
    requireLower: true,
    requireDigit: true,
    requireSpecial: true,
    specialChars: DEFAULT_SPECIAL,
  };

  const chunks: string[] = [];
  if (field) {
    chunks.push(
      field.getAttribute('pattern') || '',
      field.getAttribute('title') || '',
      field.getAttribute('aria-label') || '',
      field.placeholder || '',
      field.name || '',
      field.id || ''
    );
    const minL = Number(field.getAttribute('minlength') || field.minLength || 0);
    const maxL = Number(field.getAttribute('maxlength') || field.maxLength || 0);
    if (minL > 0) rules.minLength = Math.max(rules.minLength, minL);
    if (maxL > 0 && maxL >= rules.minLength) rules.maxLength = Math.min(rules.maxLength, maxL);

    try {
      if (field.labels) {
        for (const lab of Array.from(field.labels)) {
          chunks.push(lab.textContent || '');
        }
      }
    } catch {
      /* ignore */
    }
  }

  // Nearby help / requirements text in the form
  try {
    const root: ParentNode = form || field?.form || document;
    const near = root.querySelectorAll(
      '[class*="password" i], [id*="password" i], [class*="requirement" i], [class*="hint" i], [data-password], small, .help, .error, li'
    );
    for (const el of Array.from(near).slice(0, 40)) {
      const t = (el.textContent || '').trim();
      if (t.length > 0 && t.length < 200) chunks.push(t);
    }
  } catch {
    /* ignore */
  }

  const blob = chunks.join(' \n ').toLowerCase();

  const minMatch = blob.match(/(?:at least|minimum|min(?:imum)?\.?\s*(?:of)?|≥|>=)\s*(\d{1,2})/);
  if (minMatch) rules.minLength = Math.max(rules.minLength, Number(minMatch[1]));
  const between = blob.match(/(\d{1,2})\s*(?:to|-|–)\s*(\d{1,2})\s*(?:char|character)/);
  if (between) {
    rules.minLength = Math.max(rules.minLength, Number(between[1]));
    rules.maxLength = Math.min(rules.maxLength, Number(between[2]));
  }

  if (/upper|capital|majuscule|groß|mayúsc|大文字/.test(blob)) rules.requireUpper = true;
  if (/lower|minuscule|klein|minúsc|小文字/.test(blob)) rules.requireLower = true;
  if (/number|digit|numérique|zahl|número|数字/.test(blob)) rules.requireDigit = true;
  if (
    /special|symbol|punctuation|symbole|sonder|especial|記号|特殊/.test(blob) ||
    /[!@#$%^&*]/.test(blob)
  ) {
    rules.requireSpecial = true;
  }
  // Explicit "no special characters"
  if (/no special|without special|special characters? not|記号不要|keine sonder/.test(blob)) {
    rules.requireSpecial = false;
  }

  // Pattern-based hints
  const pattern = field?.getAttribute('pattern') || '';
  if (pattern) {
    if (pattern.includes('A-Z') || pattern.includes('[:upper:]')) rules.requireUpper = true;
    if (pattern.includes('a-z') || pattern.includes('[:lower:]')) rules.requireLower = true;
    if (pattern.includes('0-9') || pattern.includes('\\d')) rules.requireDigit = true;
    if (/[!@#$%^&*_\-\\[\]{}]/.test(pattern)) rules.requireSpecial = true;
  }

  if (rules.minLength > rules.maxLength) rules.maxLength = rules.minLength + 4;
  rules.minLength = Math.min(Math.max(rules.minLength, 6), 64);
  rules.maxLength = Math.min(Math.max(rules.maxLength, rules.minLength), 128);
  return rules;
}

/** Generate a password that satisfies optional site rules. */
export function generatePassword(rules?: Partial<PasswordRules>): string {
  const r: PasswordRules = {
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
    requireUpper: true,
    requireLower: true,
    requireDigit: true,
    requireSpecial: true,
    specialChars: DEFAULT_SPECIAL,
    ...rules,
  };

  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const numbers = '0123456789';
  const special = r.specialChars || DEFAULT_SPECIAL;

  let pool = '';
  if (r.requireLower) pool += lowercase;
  if (r.requireUpper) pool += uppercase;
  if (r.requireDigit) pool += numbers;
  if (r.requireSpecial) pool += special;
  if (!pool) pool = lowercase + uppercase + numbers;

  const length = randomIntBetween(r.minLength, Math.max(r.minLength, Math.min(r.maxLength, 20)));
  const required: string[] = [];
  if (r.requireLower) required.push(lowercase[randomInt(lowercase.length)]);
  if (r.requireUpper) required.push(uppercase[randomInt(uppercase.length)]);
  if (r.requireDigit) required.push(numbers[randomInt(numbers.length)]);
  if (r.requireSpecial) required.push(special[randomInt(special.length)]);

  const chars = [...required];
  while (chars.length < length) {
    chars.push(pool[randomInt(pool.length)]);
  }

  // Fisher–Yates shuffle
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/** Smart password from a field context. */
export function generateSmartPassword(
  field?: HTMLInputElement | null,
  form?: HTMLFormElement | Document | null
): string {
  return generatePassword(detectPasswordRules(field, form));
}

export function generateUsername(): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const numbers = '0123456789';
  const allChars = letters + numbers;
  const length = randomIntBetween(USERNAME_MIN_LENGTH, USERNAME_MAX_LENGTH);
  let username = '';

  username += letters[randomInt(letters.length)];

  for (let i = 1; i < length - 1; i++) {
    if (i > 1 && username[i - 1] !== '-' && randomChance(0.1)) {
      username += '-';
    } else {
      const useNumber = randomChance(0.3);
      username += useNumber
        ? numbers[randomInt(numbers.length)]
        : letters[randomInt(letters.length)];
    }
  }

  username += allChars[randomInt(allChars.length)];
  return username;
}

export function generatePhoneNumber(locale?: string): string {
  // Try to use provided locale, or detect from navigator.language, defaulting to 'en-US'
  const activeLocale = locale || (typeof navigator !== 'undefined' ? navigator.language : 'en-US');

  if (activeLocale.startsWith('fr')) {
    // French style: 06 12 34 56 78
    return `06 ${String(randomIntBetween(10, 99))} ${String(randomIntBetween(10, 99))} ${String(randomIntBetween(10, 99))} ${String(randomIntBetween(10, 99))}`;
  } else if (activeLocale.startsWith('de')) {
    // German style: +49 170 1234567
    return `+49 17${randomInt(10)} ${randomIntBetween(1000000, 9999999)}`;
  } else if (activeLocale.startsWith('en-GB') || activeLocale.startsWith('en-UK')) {
    // UK style: 07123 456789
    return `07${randomIntBetween(100, 999)} ${randomIntBetween(100000, 999999)}`;
  } else if (activeLocale.startsWith('ja')) {
    // Japan style: 090-1234-5678
    return `090-${randomIntBetween(1000, 9999)}-${randomIntBetween(1000, 9999)}`;
  }

  // Default to US format: XXX-XXX-XXXX
  const areaCode = randomIntBetween(PHONE_AREA_CODE_MIN, PHONE_AREA_CODE_MAX);
  const firstPart = randomIntBetween(PHONE_PART_MIN, PHONE_PART_MAX);
  const secondPart = randomIntBetween(PHONE_LAST_PART_MIN, PHONE_LAST_PART_MAX);
  return `${areaCode}-${firstPart}-${secondPart}`;
}

export function generateWebsiteUrl(): string {
  const domains = ['com', 'net', 'org', 'io', 'co', 'ai', 'dev'];
  const name = randomToken(10);
  const domain = randomItem(domains) ?? 'com';
  return `https://www.${name}.${domain}`;
}

export function generateRandomName(): string {
  const firstNames = [
    'James',
    'John',
    'Robert',
    'Michael',
    'William',
    'David',
    'Richard',
    'Joseph',
    'Thomas',
    'Charles',
    'Mary',
    'Patricia',
    'Jennifer',
    'Linda',
    'Elizabeth',
    'Barbara',
    'Susan',
    'Jessica',
    'Sarah',
    'Karen',
  ];
  const lastNames = [
    'Smith',
    'Johnson',
    'Williams',
    'Brown',
    'Jones',
    'Garcia',
    'Miller',
    'Davis',
    'Rodriguez',
    'Martinez',
    'Anderson',
    'Taylor',
    'Thomas',
    'Moore',
    'Jackson',
    'Martin',
    'Lee',
    'Thompson',
    'White',
    'Harris',
  ];

  const firstName = randomItem(firstNames) ?? 'James';
  const lastName = randomItem(lastNames) ?? 'Smith';
  return `${firstName} ${lastName}`;
}
