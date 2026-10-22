import lexicon from '@/config/otp-detection-lexicon.json';
import { decodeHtmlEntities } from '@/utils/email/decode-html-entities.js';
import { parseAnchors, stripAnchors } from '@/utils/email/html-scan.js';

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const verificationWords = new RegExp(
  `(?<![a-zA-Z])(?:${[...new Set(Object.values(lexicon.otpKeywords).flat())]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex)
    .join('|')})(?![a-zA-Z])`,
  'iu'
);
const couponLabel =
  '(?:promo(?:tional)?\\s+code|coupon(?:\\s+code)?|voucher(?:\\s+code)?|discount\\s+code|gutscheincode|rabattcode|code\\s+promo|code\\s+de\\s+r[ée]duction|c[oó]digo\\s+(?:promocional|de\\s+descuento)|رمز\\s+(?:الخصم|القسيمة)|كود\\s+الخصم|クーポンコード|割引コード|优惠码|折扣码|優惠碼|รหัสส่วนลด|โค้ดส่วนลด)';
const couponPattern = new RegExp(
  `${couponLabel}\\s*(?:is|ist|est|es|คือ|为|是)?\\s*[:：=–—-]?\\s*["'“]?([a-z0-9][a-z0-9_-]{2,31})(?![a-z0-9_-])`,
  'giu'
);
const couponSubject = new RegExp(couponLabel, 'iu');
const commercialContext =
  /\b(?:discount|sale|offer|rabatt|gutschein|r[ée]duction|offre|descuento|oferta)\b|\d\s*%\s*off|خصم|قسيمة|クーポン|割引|优惠|折扣|ส่วนลด/iu;
const genericCouponPattern =
  /\b(?:use|apply|enter)\s+(?:the\s+)?code\s*[:：=]?\s*([a-z0-9][a-z0-9_-]{2,31})(?![a-z0-9_-])/giu;
const explicitLabel = new RegExp(
  `${verificationWords.source}\\s*(?:is|below|ist|est|es)?\\s*[:：=]?\\s*$`,
  'iu'
);
const reminderSubject =
  /\b(?:reminder|appointment reminder|payment due|renewal reminder|rappel|erinnerung|recordatorio)\b|تذكير|リマインダー|提醒|แจ้งเตือน|เตือนความจำ/iu;
const reminderBody =
  /\b(?:this is (?:a |your )?reminder|remind you (?:that|about|to)|payment is due|appointment is (?:on|at)|vous rappelons|wir erinnern|te recordamos)\b|نذكرك|お忘れなく|温馨提醒|ขอแจ้งเตือน/iu;

const durationUnits =
  '(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?|segundos?|minutos?|horas?|d[ií]as?|semanas?|mes(?:es)?|a[nñ]os?|secondes?|heures?|jours?|semaines?|mois|ans?|sekunden?|minuten?|stunden?|tagen?|tage|wochen?|monaten?|monate|jahren?|jahre|ثواني|ثانية|دقائق|دقيقة|ساعات|ساعة|أيام|يوم|أسابيع|أسبوع|أشهر|شهر|سنوات|سنة|秒|分钟|分鐘|分|小时|小時|時間|时|時|天|日|周|週|个月|個月|月|年|วินาที|นาที|ชั่วโมง|วัน|สัปดาห์|เดือน|ปี)';
const durationCode = new RegExp(`^\\d{1,4}${durationUnits}$`, 'iu');
const durationAfter = new RegExp(`^\\s*${durationUnits}(?![\\p{L}])`, 'iu');
const phoneLabel =
  /(?:\b(?:tel(?:ephone|[ée]fono)?|phone|mobile|call(?: us)?|fax|t[ée]l[ée]phone|telefon|anrufen)|هاتف|اتصل|電話|手机|手機|电话|โทรศัพท์)\s*[:：.]?\s*$/iu;
const dealSubject =
  /\b(?:sales?|discounts?|special offers?|limited[- ]time offers?|deals?|rabatte?|sonderangebote?|soldes|offres? sp[ée]ciales?|descuentos?|ofertas?|rebajas)\b|خصم|عرض خاص|セール|特別オファー|限时优惠|限時優惠|特价|特價|ลดราคา|ข้อเสนอพิเศษ/iu;
const dealBody =
  /(?:\d\s*%\s*(?:off|discount|de descuento|de r[ée]duction)|save\s+\d+\s*%|(?:discount|descuento|rabatt)\s+(?:of\s+|del\s+)?\d+\s*%|خصم\s*\d+|\d+\s*%\s*(?:割引|优惠|優惠|ส่วนลด))/iu;

/** Telephone destinations and their visible labels are never code evidence. */
export function stripTelephoneLinks(value: string): string {
  if (!/tel|&#|&colon;/i.test(value)) return value;
  const anchors = parseAnchors(value).filter((anchor) =>
    /^\s*tel\s*:/i.test(decodeHtmlEntities(anchor.href))
  );
  return stripAnchors(value, anchors);
}

function phoneRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  for (const match of text.matchAll(/(?<![a-z0-9])\+?\d(?:[ .()-]*\d){2,14}(?![a-z0-9])/giu)) {
    const digits = match[0].replace(/\D/g, '');
    const labelled = phoneLabel.test(
      text.slice(Math.max(0, match.index - 45), match.index).replace(/\(\s*$/, '')
    );
    const groups = match[0].match(/\d+/g) || [];
    const phoneShape =
      /\d\)[ .-]*\d/.test(match[0]) ||
      (digits.length >= 9 &&
        (groups.length === 1 ||
          (groups.length >= 3 && groups.every((group) => group.length <= 4))));
    if (labelled || match[0].startsWith('+') || phoneShape) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  return ranges;
}

/** Text only: attributes, comments and executable/style content are not evidence. */
export function emailEvidenceText(value: string | undefined): string {
  return decodeHtmlEntities(
    (value || '')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
  )
    .replace(/\s+/gu, ' ')
    .trim();
}

export function extractCouponCode(
  subject: string | undefined,
  body: string | undefined
): string | undefined {
  const text = `${emailEvidenceText(subject)}\n${emailEvidenceText(body)}`;
  return couponCodesInText(text)[0];
}

function couponCodesInText(text: string): string[] {
  const codes: string[] = [];
  const matches = [...text.matchAll(couponPattern)];
  if (commercialContext.test(text)) matches.push(...text.matchAll(genericCouponPattern));
  for (const match of matches) {
    const code = match[1];
    // A prose connector after a label is not a coupon, even if it is 3+ letters.
    if (
      /^(?:below|here|today|your|this|with|apply|enter|expires|valid|ist|est|the|use)$/i.test(code)
    )
      continue;
    codes.push(code);
  }
  return codes;
}

export type OtpEvidence = 'supported' | 'uncertain' | 'rejected';

/** Known non-code shapes are rejected; missing language/context is uncertainty. */
export function assessOtpEvidence(
  subject: string | undefined,
  body: string | undefined,
  candidate: string
): OtpEvidence {
  return createOtpEvidenceChecker(subject, body)(candidate);
}

/** One normalization per extraction pass, rather than per regex candidate. */
export function createOtpEvidenceChecker(
  subject: string | undefined,
  body: string | undefined
): (candidate: string) => OtpEvidence {
  const phoneFreeBody = stripTelephoneLinks(body || '');
  const removedTelephone = phoneFreeBody !== (body || '');
  const text = `${emailEvidenceText(subject)}\n${emailEvidenceText(phoneFreeBody)}`;
  const phones = phoneRanges(text);
  const coupons = new Set(
    couponCodesInText(text).map((coupon) => coupon.replace(/[-\s]/g, '').toLowerCase())
  );
  return (candidate) => {
    const code = candidate.replace(/[-\s]/g, '');
    if (!/^[a-z0-9]{3,8}$/i.test(code) || !/\d/.test(code)) return 'rejected';
    if (coupons.has(code.toLowerCase())) return 'rejected';
    if (durationCode.test(code)) return 'rejected';
    // Relative timestamps, clock suffixes, ordinals and discount amounts are prose.
    if (
      /^\d{1,3}(?:off|on|am|pm|st|nd|rd|th|hrs?|hours?|mins?|minutes?|days?|ago)$/i.test(code) ||
      /^\d{1,3}[smhd](?:ago)?$/i.test(code) ||
      /^\d{1,2}(?:am|pm)\d{1,2}(?:am|pm)$/i.test(code)
    )
      return 'rejected';
    const token = new RegExp(
      `(?<![a-z0-9])${code.split('').map(escapeRegex).join('[-\\s]*')}(?![a-z0-9])`,
      'giu'
    );
    let supported = false;
    let explicitlyLabelled = false;
    let calendarOccurrence = false;
    let nonCalendarOccurrence = false;
    let excludedOccurrence = false;
    for (const match of text.matchAll(token)) {
      const at = match.index;
      const before = text.slice(Math.max(0, at - 90), at);
      const after = text.slice(at + match[0].length, at + match[0].length + 45);
      if (
        phones.some((range) => at < range.end && at + match[0].length > range.start) ||
        (/^\d+$/.test(code) && durationAfter.test(after))
      ) {
        excludedOccurrence = true;
        continue;
      }
      if (
        /^(?:19|20|21)\d{2}$/.test(code) &&
        (/\d{1,2}(?:st|nd|rd|th)?[.\s]+(?:de\s+)?[\p{L}.]{2,20}(?:\s+de)?[,]?\s*$/iu.test(before) ||
          /\d{1,2}[-/.]\d{1,2}[-/.]\s*$/.test(before) ||
          /^\s*(?:年|년)\s*\d{1,2}\s*(?:月|월)/u.test(after))
      ) {
        calendarOccurrence = true;
        continue;
      }
      nonCalendarOccurrence = true;
      const directLabel = explicitLabel.test(before) && !/\bcodes\s*[:：=]?\s*$/i.test(before);
      if (verificationWords.test(before + after) && (!couponSubject.test(before) || directLabel))
        supported = true;
      if (directLabel) explicitlyLabelled = true;
    }
    if (calendarOccurrence && !nonCalendarOccurrence) return 'rejected';
    if (
      !nonCalendarOccurrence &&
      (excludedOccurrence ||
        removedTelephone ||
        (/^\d+$/.test(code) &&
          phones.some((range) =>
            text.slice(range.start, range.end).replace(/\D/g, '').includes(code)
          )))
    )
      return 'rejected';
    // Sequential group1/group2, section1/section2, etc. describe a list. An
    // explicitly labelled verification token may legitimately share that shape.
    const family = /^([a-z]{2,})(\d+)$/i.exec(code);
    if (family && !explicitlyLabelled) {
      const siblings = new Set(
        [...text.matchAll(new RegExp(`\\b${escapeRegex(family[1])}(\\d+)\\b`, 'gi'))].map(
          (m) => m[1]
        )
      );
      if (siblings.size > 1) return 'rejected';
    }
    if (/^(?:19|20|21)\d{2}$/.test(code) && !supported) return 'rejected';
    return supported ? 'supported' : 'uncertain';
  };
}

export interface EmailCodeClassification {
  otp: string | null;
  /** Unlabelled/unknown-language candidate: manual copy only, never auto-fill. */
  otpCandidate: string | null;
  couponCode: string | null;
  isReminder: boolean;
  isDeal: boolean;
}

export function classifyEmailCodes(
  subject: string | undefined,
  body: string | undefined,
  candidate: string | null | undefined
): EmailCodeClassification {
  const evidence = candidate ? assessOtpEvidence(subject, body, candidate) : 'rejected';
  const couponCode = extractCouponCode(subject, body) || null;
  return {
    otp: evidence === 'supported' ? candidate || null : null,
    otpCandidate: evidence === 'uncertain' ? candidate || null : null,
    couponCode,
    isDeal:
      !!couponCode ||
      dealSubject.test(emailEvidenceText(subject)) ||
      dealBody.test(emailEvidenceText(body)),
    isReminder:
      reminderSubject.test(emailEvidenceText(subject)) ||
      reminderBody.test(emailEvidenceText(body)),
  };
}
