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
} from '@/utils/content/content-constants.js';
import {
  randomInt,
  randomIntBetween,
  randomItem,
  randomToken,
} from '@/utils/security/secure-random.js';

export function generateUsername(): string {
  const adj = [
    'swift',
    'calm',
    'bright',
    'quiet',
    'lucky',
    'clever',
    'happy',
    'cool',
    'vivid',
    'noble',
    'fresh',
    'sunny',
  ];
  const noun = [
    'otter',
    'maple',
    'river',
    'cloud',
    'pixel',
    'cedar',
    'falcon',
    'comet',
    'orchid',
    'ember',
    'nova',
    'harbor',
  ];
  const a = randomItem(adj) || 'cool';
  const n = randomItem(noun) || 'user';
  const digits = String(randomIntBetween(10, 9999));
  // Keep within common site limits (3-20)
  let u = `${a}${n}${digits}`;
  if (u.length > USERNAME_MAX_LENGTH) u = u.slice(0, USERNAME_MAX_LENGTH);
  if (u.length < USERNAME_MIN_LENGTH) u = `${u}${randomIntBetween(10, 99)}`;
  return u.toLowerCase().replace(/[^a-z0-9_]/g, '');
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
  form?: HTMLElement | Document | null
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
  const between = blob.match(/(\d{1,2})\s*(?:to|-|-)\s*(\d{1,2})\s*(?:char|character)/);
  if (between) {
    rules.minLength = Math.max(rules.minLength, Number(between[1]));
    rules.maxLength = Math.min(rules.maxLength, Number(between[2]));
  }

  const upperMention = /upper|capital|majuscule|groß|mayúsc|大文字/.test(blob);
  const lowerMention = /lower|minuscule|klein|minúsc|小文字/.test(blob);
  const digitMention = /number|digit|numérique|zahl|número|数字/.test(blob);
  if (upperMention) rules.requireUpper = true;
  if (lowerMention) rules.requireLower = true;
  if (digitMention) rules.requireDigit = true;
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
  if (
    /no (?:uppercase|capital)|without (?:uppercase|capital)|(?:uppercase|capital) (?:not allowed|not required)/.test(
      blob
    )
  ) {
    rules.requireUpper = false;
  }
  if (/no lowercase|without lowercase|lowercase (?:not allowed|not required)/.test(blob)) {
    rules.requireLower = false;
  }
  if (
    /no (?:numbers?|digits?)|without (?:numbers?|digits?)|(?:numbers?|digits?) (?:not allowed|not required)/.test(
      blob
    )
  ) {
    rules.requireDigit = false;
  }
  if (/only lowercase|lowercase.{0,24}only|only.{0,24}lowercase/.test(blob)) {
    rules.requireUpper = false;
    rules.requireSpecial = false;
  }
  if (/letters? and numbers? only|numbers? and letters? only/.test(blob)) {
    rules.requireSpecial = false;
  }

  // Pattern-based hints
  const pattern = field?.getAttribute('pattern') || '';
  if (pattern) {
    if (pattern.includes('A-Z') || pattern.includes('[:upper:]')) rules.requireUpper = true;
    if (pattern.includes('a-z') || pattern.includes('[:lower:]')) rules.requireLower = true;
    if (pattern.includes('0-9') || pattern.includes('\\d')) rules.requireDigit = true;
    if (/[!@#$%^&*_\-\\[\]{}]/.test(pattern)) rules.requireSpecial = true;

    // When a pattern is a single repeated character class, it is an allowlist
    // (e.g. ^[a-z0-9]{8,}$), not a set of lookahead requirements. Match its
    // permitted classes so generation cannot add characters the site rejects.
    const allowlist = pattern.match(/^\^?\[([^\]]+)\](?:(?:[+*?])|(?:\{\d+(?:,\d*)?\}))*\$?$/);
    if (allowlist) {
      const chars = allowlist[1];
      rules.requireUpper = /A-Z/.test(chars);
      rules.requireLower = /a-z/.test(chars);
      rules.requireDigit = /0-9|\\d/.test(chars);
      rules.requireSpecial =
        [...DEFAULT_SPECIAL].some((char) => char !== '-' && chars.includes(char)) ||
        chars.includes('\\-');
    }
  }

  // Explicit exclusions and allow-list wording override conservative defaults.
  const onlyLowerAndDigit =
    /(?:only\s+)?(?:lowercase|lower\s+case|small\s+letters?)[^.!?;]{0,32}(?:and|\+|,)\s*(?:digits?|numbers?)[^.!?;]{0,16}only/.test(
      blob
    ) ||
    /only\s+(?:lowercase|lower\s+case|small\s+letters?)[^.!?;]{0,32}(?:and|\+|,)\s*(?:digits?|numbers?)/.test(
      blob
    ) ||
    /(?:digits?|numbers?)[^.!?;]{0,32}(?:and|\+|,)\s*(?:lowercase|lower\s+case|small\s+letters?)[^.!?;]{0,16}only/.test(
      blob
    );
  const upperExcluded =
    /(?:no|without|exclude|excluding)\s+(?:uppercase|upper\s+case|capital\s+letters?)|(?:uppercase|upper\s+case|capital\s+letters?)[^.!?;]{0,20}(?:not\s+(?:required|allowed|needed)|optional)/.test(
      blob
    );
  const lowerExcluded =
    /(?:no|without|exclude|excluding)\s+(?:lowercase|lower\s+case)|(?:lowercase|lower\s+case)[^.!?;]{0,20}(?:not\s+(?:required|allowed|needed)|optional)/.test(
      blob
    );
  const digitExcluded =
    /(?:no|without|exclude|excluding)\s+(?:digits?|numbers?)|(?:digits?|numbers?)[^.!?;]{0,20}(?:not\s+(?:required|allowed|needed)|optional)/.test(
      blob
    );
  const specialExcluded =
    /no\s+special|without\s+special|special\s+characters?[^.!?;]{0,20}(?:not\s+(?:required|allowed|needed)|optional)|記号不要|keine\s+sonder/.test(
      blob
    );
  if (onlyLowerAndDigit) {
    rules.requireUpper = false;
    rules.requireLower = true;
    rules.requireDigit = true;
    rules.requireSpecial = false;
  }
  if (upperExcluded) rules.requireUpper = false;
  if (lowerExcluded) rules.requireLower = false;
  if (digitExcluded) rules.requireDigit = false;
  if (specialExcluded) rules.requireSpecial = false;

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

  // One char per required class (up to 4) must never push the password past
  // maxLength - e.g. {minLength: 3, maxLength: 3} with all four classes would
  // otherwise produce a 4-char password. Clamp the required set to maxLength
  // and never let the target length drop below the required count.
  const maxLength = Math.max(r.minLength, r.maxLength);
  const required: string[] = [];
  if (r.requireLower && required.length < maxLength)
    required.push(lowercase[randomInt(lowercase.length)]);
  if (r.requireUpper && required.length < maxLength)
    required.push(uppercase[randomInt(uppercase.length)]);
  if (r.requireDigit && required.length < maxLength)
    required.push(numbers[randomInt(numbers.length)]);
  if (r.requireSpecial && required.length < maxLength)
    required.push(special[randomInt(special.length)]);

  const minLength = Math.max(r.minLength, required.length);
  const length = randomIntBetween(minLength, Math.max(minLength, Math.min(maxLength, 20)));

  const chars = [...required];
  while (chars.length < length) {
    chars.push(pool[randomInt(pool.length)]);
  }

  // Fisher-Yates shuffle
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/** Smart password from a field context. */
export function generateSmartPassword(
  field?: HTMLInputElement | null,
  form?: HTMLElement | Document | null
): string {
  return generatePassword(detectPasswordRules(field, form));
}

/**
 * Human-readable username (not password-like).
 * Pattern: word + word + 2-4 digits, no special chars.
 */
