/**
 * OTP extraction utilities
 *
 * Multi-language keyword support: matches "code", "Code", "验证码", "コード",
 * "код", "Bestätigungscode", "mot de passe", etc. The keyword alternation is
 * built once at module load and shared across all patterns.
 *
 * HTML entities in subjects (e.g. `&#39;`, `&amp;`, `&#x27;`) are decoded
 * before pattern matching so they don't break token detection.
 */

import otpDetectionLexicon from '@/config/otp-detection-lexicon.json';
import { decodeHtmlEntities } from '@/utils/email/decode-html-entities.js';
import { createOtpEvidenceChecker, stripTelephoneLinks } from '@/utils/otp/email-code-evidence.js';

const OTP_KEYWORDS_BY_LANG = otpDetectionLexicon.otpKeywords;
const EXPIRY_LANGUAGE_BY_LANG = otpDetectionLexicon.expiryKeywords;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildKeywordAlternation(byLang: Record<string, readonly string[]>): string {
  const all = new Set<string>();
  for (const keywords of Object.values(byLang)) {
    for (const kw of keywords) all.add(kw);
  }
  return Array.from(all)
    .sort((a, b) => b.length - a.length)
    .map((kw) => escapeRegex(kw).replace(/[\s\u3000]+/g, '[\\s\\u3000]+'))
    .join('|');
}

// Latin keywords must be whole words: "pin" inside "shipping" and "pass"
// inside longer prose/base64 strings are not verification context. CJK words
// still match adjacent localized text without Latin word boundaries.
const KEYWORD_GROUP = `(?<![a-zA-Z])(?:${buildKeywordAlternation(OTP_KEYWORDS_BY_LANG)})(?![a-zA-Z])`;
const EXPIRY_GROUP = buildKeywordAlternation(EXPIRY_LANGUAGE_BY_LANG);
const NON_OTP_NUMBER_GROUP = buildKeywordAlternation(otpDetectionLexicon.nonOtpNumberKeywords);
const NON_OTP_NUMBER_SUFFIX =
  '(?:\\s*[:#]|\\s+(?:number|no\\.?|id)(?:\\s+(?:is|was|are))?|\\s+(?:is|was|are)|[-_]+)?';
const NON_OTP_NUMBER_LABEL_AT_END = new RegExp(
  `(?:${NON_OTP_NUMBER_GROUP})${NON_OTP_NUMBER_SUFFIX}\\s*$`,
  'iu'
);

const YOUR_POSSESSIVES =
  '(?:your|this|the|votre|tu|dein|deine|ihr|euer|sein|ihre|ihr|tu|su|su|sus|uw|jouw|je|mon|ma|mes|son|sa|tuo|tua|il|la|lo|i|gli|le)';

// Words that typically precede a NON-OTP number: "Order 12345", "Invoice no.
// 567890", "Reference: 123456", "your balance is 1234". The lookbehind blocks
// a code-shaped token when one of these immediately precedes it, so order /
// invoice / tracking / reference numbers are never surfaced as OTPs. Covers
// the colon form ("Order: 123456"), the "number" form ("order number 123456"),
// and the copula form ("your balance is 1234").
const ORDER_INVOICE_GUARD = `(?<!(?:${NON_OTP_NUMBER_GROUP})${NON_OTP_NUMBER_SUFFIX}\\s*#?\\s*)`;

// Code-shaped capture: 3-8 alphanumeric chars with OPTIONAL single dashes or
// spaces between them, so "XY-4829" / "AB-12-34" / "123 456" are captured in
// full and normalized ("XY4829" etc.) instead of truncating to their numeric
// tail.
const CODE_CAPTURE = '([a-zA-Z0-9](?:[- ]?[a-zA-Z0-9]){2,7})';

// Reject pure-letter tokens - including separated runs like "at https" or
// "a-b-c" - so words are never captured as codes. Digits or a dash/spaces
// adjacent to a digit break the letter-only run and let the capture through.
const NOT_PURE_LETTERS = '(?![a-zA-Z](?:[- ]?[a-zA-Z]){2,7}\\b)';

const PATTERNS: readonly RegExp[] = [
  // 1. Keyword : code
  new RegExp(
    `(?:${KEYWORD_GROUP})[\\s\\S]{0,75}[:：]\\s*\\b${NOT_PURE_LETTERS}${ORDER_INVOICE_GUARD}${CODE_CAPTURE}\\b`,
    'iu'
  ),
  // 2. (possessive) + keyword + (is|below) + code
  new RegExp(
    `(?:${YOUR_POSSESSIVES}\\s+)?(?:${KEYWORD_GROUP})\\s*(?:is|below|=|:|：)?\\s*\\b${NOT_PURE_LETTERS}${ORDER_INVOICE_GUARD}${CODE_CAPTURE}\\b`,
    'iu'
  ),
  // 3. Keyword ... 3-8 digit code (proximity)
  new RegExp(`(?:${KEYWORD_GROUP})[\\s\\S]{0,50}\\b${ORDER_INVOICE_GUARD}(\\d{3,8})\\b`, 'iu'),
  // 4. Standalone 4-8 char token on its own line. Runs AFTER the keyword
  //    patterns so a stray "2026" line cannot beat "Your code is 482901",
  //    and is guarded against order/invoice/tracking numbers.
  /^(?![a-zA-Z]{4,8}$)([a-zA-Z0-9](?:[- ]?[a-zA-Z0-9]){3,7})$/iu,
];

// Subject-only fallback: a code-only subject, optionally prefixed Re/Fwd.
// Ordinary headlines and numbers embedded in prose are not OTP evidence.
const SUBJECT_FALLBACK = new RegExp(
  `^(?:(?:re|fw|fwd):\\s*)?${NOT_PURE_LETTERS}${CODE_CAPTURE}$`,
  'iu'
);

// Expiration-language fallback
const EXPIRY_FALLBACK_PATTERN = new RegExp(
  `\\b(?![a-zA-Z]{3,8}\\b)([a-zA-Z0-9]{3,8})\\b[\\s\\S]{0,100}(?:${EXPIRY_GROUP})`,
  'iu'
);
const EXPIRY_TEST_PATTERN = new RegExp(`(?:${EXPIRY_GROUP})`, 'iu');

// Block-level HTML detection. Runs BEFORE text normalization so we keep the
// structural signal that a `<div>` / `<p>` / `<td>` / `<h1-6>` gives us. Many
// transactional emails render the OTP as the sole content of one of these
// block-level elements (e.g. `<div class="otp">123456</div>`). This is a
// high-confidence signal that we should prefer over plain-text patterns.
const BLOCK_TAG_NAMES = 'div|p|td|th|h[1-6]|strong|b|li|article|section|main|header|footer';
const BLOCK_PAIR_PATTERN = new RegExp(
  `<\\s*(${BLOCK_TAG_NAMES})\\b[^>]*>([\\s\\S]*?)<\\/\\s*\\1\\s*>`,
  'gi'
);

// OTP keyword test over a tag-stripped window (built once, shared by blocks).
// `g` is required for matchAll.
const BLOCK_KEYWORD_TEST = new RegExp(`(?:${KEYWORD_GROUP})`, 'giu');
const OTP_CONTEXT_TEST = new RegExp(KEYWORD_GROUP, 'iu');

// How far (in stripped chars) an OTP keyword may sit from a code-shaped block
// element for the block to count as "anchored". Transactional emails usually
// render the code in a block right under the "Your code is" paragraph.
const BLOCK_KEYWORD_WINDOW = 600;

// Class/id attributes that mark a block element as an OTP container even with
// no nearby keyword text (e.g. <div class="otp-code">123456</div>).
const BLOCK_CLASS_HINT = /(?:class|id)\s*=\s*["'][^"']*["']/i;

function getLocalizedMonthNames(): string[] {
  const names = new Set<string>();
  const locales = new Set(['en-US', ...Object.keys(OTP_KEYWORDS_BY_LANG)]);

  for (const locale of locales) {
    for (let month = 0; month < 12; month++) {
      const date = new Date(Date.UTC(2026, month, 17));
      for (const options of [
        { month: 'long' as const },
        { month: 'short' as const },
        { day: 'numeric' as const, month: 'long' as const, year: 'numeric' as const },
      ]) {
        try {
          const formatted = new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' });
          const monthPart = options.day
            ? formatted.formatToParts(date).find((part) => part.type === 'month')?.value
            : formatted.format(date);
          if (monthPart?.trim()) names.add(monthPart.trim());
        } catch {
          // Unsupported locale: the remaining locales still cover date names.
        }
      }
    }
  }

  return [...names].sort((a, b) => b.length - a.length);
}

const MONTH_NAME_GROUP = getLocalizedMonthNames().map(escapeRegex).join('|');
const WRITTEN_DATE_PATTERNS = [
  new RegExp(`(?:${MONTH_NAME_GROUP})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?[,]?\\s+\\d{4}`, 'giu'),
  new RegExp(
    `\\d{1,2}(?:st|nd|rd|th)?[.]?\\s+(?:de\\s+)?(?:${MONTH_NAME_GROUP})(?:\\s+de)?[,]?\\s+\\d{4}`,
    'giu'
  ),
  new RegExp(`\\d{4}\\s+(?:${MONTH_NAME_GROUP})\\s+\\d{1,2}`, 'giu'),
];
const CJK_DATE_PATTERN =
  /(?<!\d)(?:19|20|21)\d{2}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日?(?!\d)|(?<!\d)(?:19|20|21)\d{2}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일?(?!\d)/giu;
const COMPACT_DATE_PATTERN = /\b(?:19|20|21)\d{6}\b/g;
const OTP_LABEL_AT_END = new RegExp(
  `(?:${KEYWORD_GROUP})\\s*(?:(?:is|below)\\s*)?[:：=]?\\s*$`,
  'iu'
);

function isValidCompactDate(value: string): boolean {
  if (!/^(?:19|20|21)\d{6}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function hasWrittenDate(text: string, containing?: string): boolean {
  for (const pattern of WRITTEN_DATE_PATTERNS) {
    const matcher = new RegExp(pattern.source, pattern.flags);
    for (const match of text.matchAll(matcher)) {
      if (!containing || match[0].includes(containing)) return true;
    }
  }
  return false;
}

function maskDateLikeText(text: string): string {
  let masked = text;
  for (const pattern of WRITTEN_DATE_PATTERNS) {
    masked = masked.replace(pattern, ' ');
  }
  return masked
    .replace(CJK_DATE_PATTERN, ' ')
    .replace(COMPACT_DATE_PATTERN, (date, offset, source) => {
      if (!isValidCompactDate(date)) return date;
      const preceding = source.slice(Math.max(0, offset - 80), offset);
      return OTP_LABEL_AT_END.test(preceding) ? date : ' ';
    });
}

function nearestOtpKeywordDistance(
  html: string,
  index: number,
  length: number,
  inner: string
): number | null {
  const start = Math.max(0, index - BLOCK_KEYWORD_WINDOW);
  const end = Math.min(html.length, index + length + BLOCK_KEYWORD_WINDOW);
  const windowText = html
    .slice(start, end)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#?\w+;?/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
  // Locate the candidate text within the window (raw form, then de-separated).
  let innerPos = -1;
  for (const candidate of [inner.toLowerCase(), inner.replace(/[- ]/g, '').toLowerCase()]) {
    innerPos = windowText.indexOf(candidate);
    if (innerPos !== -1) break;
  }
  if (innerPos === -1) return null;
  let best: number | null = null;
  for (const km of windowText.matchAll(BLOCK_KEYWORD_TEST)) {
    if (km.index === undefined) continue;
    const dist = Math.abs(km.index - innerPos);
    if (best === null || dist < best) best = dist;
  }
  return best;
}

function hasNearbyNonOtpNumberLabel(html: string, index: number): boolean {
  const precedingText = html
    .slice(Math.max(0, index - 120), index)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#?\w+;?/g, ' ')
    .replace(/\s+/g, ' ');
  return NON_OTP_NUMBER_LABEL_AT_END.test(precedingText);
}

function extractFromBlockTags(html: string, allowUnanchored = false): string | null {
  const noComments = html.replace(/<!--[\s\S]*?-->/g, ' ');
  const assessEvidence = createOtpEvidenceChecker('', html);
  let best: { normalized: string; distance: number } | null = null;
  let firstUnanchored: string | null = null;
  for (const match of noComments.matchAll(BLOCK_PAIR_PATTERN)) {
    const inner = match[2]
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&#?\w+;?/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // Must be 3-8 chars, code-shaped (alphanumeric with optional inner dashes/spaces),
    // and contain at least one digit. The digit requirement rejects words like
    // "Hello" or "Customer" that happen to land in a block element.
    if (!/^[a-zA-Z0-9][- a-zA-Z0-9]{1,6}[a-zA-Z0-9]$/.test(inner) || !/\d/.test(inner)) continue;
    const normalized = normalizeOtp(inner);
    if (!normalized) continue;
    if (assessEvidence(normalized) === 'rejected') continue;

    // Class/id hint (e.g. <div class="otp">) is the strongest anchor signal.
    const openTag = match[0].match(/^<[^>]*>/)?.[0] ?? '';
    const hintAttribute = openTag.match(BLOCK_CLASS_HINT)?.[0] || '';
    const classHinted =
      /(?:^|["'\s_-])(?:otp(?:[-_]?code)?|pin(?:[-_]?code)?|pass(?:word|code)?|verif(?:ication)?|confirm(?:ation)?|secur(?:ity)?|token|auth(?:entication)?|one[-_]?time)(?=$|["'\s_-])/i.test(
        hintAttribute
      );
    if (match.index === undefined) continue;
    if (!classHinted) {
      const context = normalizeBody(
        noComments.slice(Math.max(0, match.index - 100), match.index + match[0].length + 100)
      );
      const innerContextIndex = context.indexOf(inner);
      const hasExplicitOtpLabel =
        innerContextIndex >= 0 && OTP_LABEL_AT_END.test(context.slice(0, innerContextIndex));
      if ((isValidCompactDate(inner) && !hasExplicitOtpLabel) || hasWrittenDate(context, inner)) {
        continue;
      }
    }
    // Structured number blocks are useful for OTP mail, but transactional
    // templates also put order/tracking IDs in their own table cells. Keep a
    // nearby localized non-OTP label from being overridden by the block
    // shortcut; an explicit OTP class or nearby OTP wording still wins.
    if (!classHinted && hasNearbyNonOtpNumberLabel(noComments, match.index)) continue;
    const distance = classHinted
      ? 0
      : nearestOtpKeywordDistance(noComments, match.index, match[0].length, inner);
    if (distance === null) {
      if (/[a-z]/i.test(normalized) && normalizeBody(noComments).trim() !== inner) continue;
      // Keep code-only templates as a last resort, but never promote an
      // unlabelled footer year into an OTP.
      if (!/^(?:19|20)\d{2}$/.test(normalized)) firstUnanchored ??= normalized;
      continue;
    }
    if (!best || distance < best.distance) best = { normalized, distance };
  }
  return best?.normalized ?? (allowUnanchored ? firstUnanchored : null);
}

function normalizeOtp(candidate: string): string | null {
  const cleaned = candidate.replace(/[- ]/g, '');
  if (cleaned.length < 3 || cleaned.length > 8) return null;
  return cleaned;
}

function normalizeSubject(subject: string | undefined): string {
  if (!subject) return '';
  return decodeHtmlEntities(subject)
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\s\u3000]+/g, ' ')
    .trim();
}

function normalizeBody(body: string | undefined): string {
  if (!body) return '';
  let normalized = body;
  normalized = normalized.replace(/<(style|script)[\s\S]*?>[\s\S]*?<\/(style|script)>/gi, '');
  normalized = normalized.replace(/<br\s*\/?>/gi, '\n');
  normalized = normalized.replace(/<p.*?>/gi, '\n');
  normalized = normalized.replace(/<div.*?>/gi, '\n');
  normalized = normalized.replace(/<h[1-6].*?>/gi, '\n');
  normalized = normalized.replace(/<[^>]+>/g, ' ');
  normalized = decodeHtmlEntities(normalized);
  normalized = normalized.replace(/[ \t]+/g, ' ').trim();
  normalized = normalized.replace(/(\r\n|\r|\n){2,}/g, '\n');
  return normalized;
}

// Mask dates, phone numbers, and timestamps so they are not collapsed into false OTP candidates
function maskNonOtpNumericPatterns(text: string): string {
  if (!text) return '';
  return (
    maskDateLikeText(text)
      // Mask ISO dates (e.g. 2026-07-04 or 2026/07/04)
      .replace(/\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/g, ' ')
      // Mask standard dates (e.g. 07/04/2026 or 07-04-2026)
      .replace(/\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/g, ' ')
      // Mask phone numbers (10+ digits with dashes/spaces/parens/plus)
      .replace(/(?:\+?\d{1,3}[- .]?)?\(?\d{3}\)?[- .]?\d{3}[- .]?\d{4}/g, ' ')
      // Mask timestamps (e.g. 14:30:15)
      .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, ' ')
      // Device-login notices contain public IPs, not verification codes.
      .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, ' ')
  );
}

// Collapse dashes/spaces between DIGITS so that "Code: 123-456" matches as
// "Code: 123456". Deliberately digit-only: merging letter-adjacent spaces
// would destroy \b boundaries in prose ("Your code is 482901"). Letter-
// prefixed codes like "XY-4829" are instead handled by the separator-tolerant
// capture groups (CODE_CAPTURE) in the patterns. Runs after date/phone/
// timestamp masking.
function collapseDigitSeparators(text: string): string {
  const masked = maskNonOtpNumericPatterns(text);
  return masked.replace(/(\d)[- ]+(?=\d)/g, '$1');
}

/** User-selectable OTP detection strictness (settings). */
export type OtpDetectionMode = 'numeric' | 'alphanumeric' | 'balanced';

/** Module default; background may set from storage before parse runs. */
let activeOtpMode: OtpDetectionMode = 'balanced';

/** Master switch for OTP extraction (default ON; set from storage). */
let otpDetectionEnabled = true;

export function setOtpDetectionMode(mode: OtpDetectionMode): void {
  activeOtpMode = mode === 'numeric' || mode === 'alphanumeric' ? mode : 'balanced';
}

export function setOtpDetectionEnabled(enabled: boolean): void {
  otpDetectionEnabled = enabled;
}

export function getOtpDetectionMode(): OtpDetectionMode {
  return activeOtpMode;
}

function passesModeFilter(otp: string, mode: OtpDetectionMode): boolean {
  if (!otp) return false;
  const digitsOnly = /^\d+$/.test(otp);
  if (mode === 'numeric') return digitsOnly;
  if (mode === 'alphanumeric') {
    // Prefer mixed or non-dictionary-like codes; still allow pure digits
    if (digitsOnly) return true;
    // Reject pure letter runs that look like words (no digit)
    if (/^[a-zA-Z]+$/.test(otp)) return false;
    return /[a-zA-Z]/.test(otp) && /[0-9]/.test(otp);
  }
  // balanced: current behavior - digits or mixed codes
  if (digitsOnly) return true;
  if (/^[a-zA-Z]+$/.test(otp)) return false;
  return true;
}

export function extractOTP(
  subject: string | undefined,
  body: string | undefined,
  mode: OtpDetectionMode = activeOtpMode
): string | null {
  if (!otpDetectionEnabled) return null;
  body = stripTelephoneLinks(body || '');
  if (
    /\b(?:off|discount|voucher|coupon|sale)\b/i.test(normalizeSubject(subject)) &&
    /\b(?:using|use|apply|enter)\s+(?:the\s+)?(?:promo\s+)?code\b/i.test(normalizeBody(body)) &&
    !/verification|verify|one[- ]?time|login\s+code|sign[- ]?in\s+code|\botp\b/i.test(subject || '')
  )
    return null;
  // 1. Explicitly anchored block-level HTML detection. Runs on raw body before
  //    normalization so the structural signal is preserved. Unanchored blocks
  //    are deferred until after keyword patterns so a footer year cannot beat
  //    a real code in the subject or body.
  if (body) {
    const blockOtp = extractFromBlockTags(body);
    if (blockOtp && passesModeFilter(blockOtp, mode)) return blockOtp;
  }

  // 2. Subject-first keyword patterns on normalized subject.
  const normalizedSubject = collapseDigitSeparators(normalizeSubject(subject));
  let otp = findOtpInText(normalizedSubject, true);
  if (otp && passesModeFilter(otp, mode)) return otp;

  // 3. Body keyword patterns on normalized body.
  if (body) {
    const normalizedBody = collapseDigitSeparators(normalizeBody(body));
    otp = findOtpInText(normalizedBody, false);
    if (otp && passesModeFilter(otp, mode)) return otp;

    // Structural fallback runs only after subject and body keyword matches.
    // It preserves code-only HTML while letting a labelled code outrank an
    // unrelated earlier number block.
    const blockFallback = extractFromBlockTags(body, true);
    if (blockFallback && passesModeFilter(blockFallback, mode)) return blockFallback;
  }

  return null;
}

export function findOtpInText(text: string, isSubject: boolean): string | null {
  if (!text) return null;
  const assessEvidence = createOtpEvidenceChecker('', text);

  const patterns = [...PATTERNS];
  if (isSubject) patterns.push(SUBJECT_FALLBACK);

  for (const [index, pattern] of patterns.entries()) {
    if (index === 3) {
      // Trim each line before testing. An unbounded whitespace prefix combined
      // with the backwards number-label guard used to backtrack for tens of
      // seconds on ordinary HTML newsletters containing many blank lines.
      for (const line of text.matchAll(/[^\r\n]+/g)) {
        const candidate = line[0].trim();
        if (candidate.length < 4 || candidate.length > 15) continue;
        const captured = candidate.match(pattern)?.[1];
        if (!captured) continue;
        // Mixed prose such as "0 pts", "2ndFloor" and "2 min" is not a
        // standalone OTP. Mixed codes elsewhere still use keyword/class
        // evidence; a body containing only the code remains supported.
        if (/[a-z]/i.test(captured) && text.trim() !== candidate) {
          const offset = line.index ?? 0;
          const context =
            text.slice(Math.max(0, offset - 100), offset) +
            text.slice(offset + line[0].length, offset + line[0].length + 100);
          if (!OTP_CONTEXT_TEST.test(context)) continue;
        }
        const preceding = text.slice(Math.max(0, (line.index ?? 0) - 120), line.index);
        if (NON_OTP_NUMBER_LABEL_AT_END.test(preceding)) continue;
        if (
          /^\d{5}(?:\d{4})?$/.test(candidate) &&
          /(?:,\s*[A-Z]{2}|postal\s+code|postcode|zip(?:\s+code)?)\s*=?\s*$/i.test(preceding)
        )
          continue;
        const normalized = normalizeOtp(captured);
        if (
          normalized &&
          !/^(?:19|20)\d{2}$/.test(normalized) &&
          assessEvidence(normalized) !== 'rejected'
        )
          return normalized;
      }
      continue;
    }
    for (const match of text.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))) {
      const captured = match[1];
      if (!captured) continue;
      const normalized = normalizeOtp(captured);
      if (normalized && assessEvidence(normalized) !== 'rejected') return normalized;
    }
  }

  if (EXPIRY_TEST_PATTERN.test(text)) {
    const match = text.match(EXPIRY_FALLBACK_PATTERN);
    const candidate = match?.[1];
    if (candidate) {
      const normalized = normalizeOtp(candidate);
      if (normalized && assessEvidence(normalized) !== 'rejected') return normalized;
    }
  }

  return null;
}
