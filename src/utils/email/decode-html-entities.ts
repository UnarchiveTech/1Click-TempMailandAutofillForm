/**
 * Shared HTML-entity decoder for parsed email content (subjects, anchor
 * text, bare URLs).
 *
 * This used to exist as three private copies (parsing/otp.ts,
 * parsing/magic-link.ts, utils/email/email-links.ts) that had already
 * drifted: the magic-link and email-links twins decoded numeric entities
 * with `String.fromCharCode`, which silently DROPS astral-plane characters
 * (any code point > 0xFFFF - e.g. `&#128512;` for 😀, common in email
 * subjects) because `fromCharCode` only accepts UTF-16 code units, and the
 * email-links copy had lost `&#x27;`. One utility ends the drift class.
 *
 * The single combined replacement pass is intentional: text created by
 * decoding `&amp;` must not be interpreted as a second entity in this call.
 */

/** Named entities commonly found in email subjects and anchor text. */
const HTML_ENTITY_RE = /&(?:nbsp|amp|lt|gt|quot|apos);|&#(?:39|x27);|&#\d+;|&#x[0-9a-f]+;/gi;

/**
 * Decode the named and numeric HTML entities in `text`.
 * Invalid numeric code points (> 0x10FFFF, or surrogate halves) decode to
 * the empty string rather than leaking garbage or throwing.
 */
export function decodeHtmlEntities(text: string): string {
  if (!text) return '';
  return text.replace(HTML_ENTITY_RE, (entity) => {
    const lower = entity.toLowerCase();
    switch (lower) {
      case '&nbsp;':
        return ' ';
      case '&amp;':
        return '&';
      case '&lt;':
        return '<';
      case '&gt;':
        return '>';
      case '&quot;':
        return '"';
      case '&apos;':
      case '&#39;':
      case '&#x27;':
        return "'";
      default:
        if (lower.startsWith('&#x')) {
          return safeFromCodePoint(Number.parseInt(lower.slice(3, -1), 16));
        }
        return safeFromCodePoint(Number.parseInt(lower.slice(2, -1), 10));
    }
  });
}

/** `String.fromCodePoint`, returning '' for anything outside Unicode. */
function safeFromCodePoint(code: number): string {
  // 0xD800-0xDFFF are surrogate halves: fromCodePoint throws on them, and
  // no well-formed document encodes a bare half.
  return Number.isInteger(code) &&
    code >= 0 &&
    code <= 0x10ffff &&
    !(code >= 0xd800 && code <= 0xdfff)
    ? String.fromCodePoint(code)
    : '';
}
