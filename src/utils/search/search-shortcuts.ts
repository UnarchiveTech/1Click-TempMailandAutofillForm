/**
 * Search shortcut parser for email filtering
 * Supports syntax like: is:otp, has:attachment, from:domain.com, to:address, subject:text
 * Negated forms (!from:domain, !to:address, !subject:text) add exclusion filters.
 */

/** Matches a full shortcut token (positive or negated) used for pill detection. */

export const SHORTCUT_REGEX =
  /^(!?is:(?:otp|unread)|!?has:attachment|!?from:\S+|!?subject:\S+|!?to:\S+)$/i;

export interface ParsedSearchQuery {
  /** The remaining text search query after removing shortcuts */
  searchQuery: string;
  /** Whether to filter for OTP-only emails */
  otpOnly: boolean;
  /** Whether to filter for unread emails */
  unreadOnly: boolean;
  /** True when an is:otp / !is:otp token appeared (explicit set/clear) */
  otpOnlySet: boolean;
  /** True when an is:unread / !is:unread token appeared */
  unreadOnlySet: boolean;
  /** Whether to filter for emails with attachments */
  hasAttachment: boolean;
  /** True when a has:attachment / !has:attachment token appeared */
  hasAttachmentSet: boolean;
  /** Sender domain filter */
  senderDomain: string;
  /** Sender email filter */
  senderEmail: string;
  /** Recipient address filter */
  recipient: string;
  /** Subject filter */
  subject: string;
  /** Excluded sender domain (negated from:domain) */
  notSenderDomain: string;
  /** Excluded sender email (negated from:email) */
  notSenderEmail: string;
  /** Excluded recipient address (negated to:address) */
  notRecipient: string;
  /** Excluded subject text (negated subject:text) */
  notSubject: string;
  /** True when a from: / !from: token appeared (explicit set/clear) */
  senderDomainSet: boolean;
  /** True when a to: / !to: token appeared (explicit set/clear) */
  recipientSet: boolean;
  /** True when a subject: / !subject: token appeared (explicit set/clear) */
  subjectSet: boolean;
  /** Highlight terms for UI */
  highlightTerms: string[];
}

/**
 * Parse search query for shortcuts
 * Supported shortcuts:
 * - is:otp / !is:otp - Filter for (or exclude) OTP emails only
 * - has:attachment / !has:attachment - Filter for (or exclude) emails with attachments
 * - from:domain.com - Filter by sender domain
 * - from:email@domain.com - Filter by specific sender email
 * - to:address - Filter by recipient address
 * - subject:text - Filter by subject text
 *
 * @param query - The raw search query string
 * @returns Parsed search query with extracted shortcuts
 */
export function parseSearchShortcuts(query: string): ParsedSearchQuery {
  const result: ParsedSearchQuery = {
    searchQuery: '',
    otpOnly: false,
    otpOnlySet: false,
    unreadOnly: false,
    unreadOnlySet: false,
    hasAttachment: false,
    hasAttachmentSet: false,
    senderDomain: '',
    senderEmail: '',
    recipient: '',
    subject: '',
    notSenderDomain: '',
    notSenderEmail: '',
    notRecipient: '',
    notSubject: '',
    senderDomainSet: false,
    recipientSet: false,
    subjectSet: false,
    highlightTerms: [],
  };

  if (!query?.trim()) {
    return result;
  }

  // Split into tokens while respecting quoted strings
  const tokens = tokenizeQuery(query);
  const remainingTokens: string[] = [];

  for (const token of tokens) {
    const lowerToken = token.toLowerCase();

    // Parse is:otp / !is:otp (negated form clears the OTP filter)
    if (lowerToken === 'is:otp' || lowerToken === '!is:otp') {
      result.otpOnly = lowerToken === 'is:otp';
      result.otpOnlySet = true;
      result.highlightTerms.push(token);
      continue;
    }

    // Parse is:unread / !is:unread (negated form clears the filter)
    if (lowerToken === 'is:unread' || lowerToken === '!is:unread') {
      result.unreadOnly = lowerToken === 'is:unread';
      result.unreadOnlySet = true;
      result.highlightTerms.push(token);
      continue;
    }

    // Parse has:attachment / !has:attachment (negated form clears the filter)
    if (lowerToken === 'has:attachment' || lowerToken === '!has:attachment') {
      result.hasAttachment = lowerToken === 'has:attachment';
      result.hasAttachmentSet = true;
      result.highlightTerms.push(token);
      continue;
    }

    // Parse !from:domain or !from:email (negated - excluded sender)
    const notFromMatch = token.match(/^!from:(.+)$/i);
    if (notFromMatch) {
      const value = notFromMatch[1].toLowerCase();
      if (value.includes('@')) {
        result.notSenderEmail = value;
      } else {
        result.notSenderDomain = value;
      }
      result.senderDomainSet = true;
      result.highlightTerms.push(token);
      continue;
    }

    // Parse from:domain or from:email
    const fromMatch = token.match(/^from:(.+)$/i);
    if (fromMatch) {
      const value = fromMatch[1].toLowerCase();
      if (value.includes('@')) {
        result.senderEmail = value;
      } else {
        result.senderDomain = value;
      }
      result.senderDomainSet = true;
      result.highlightTerms.push(token);
      continue;
    }

    // Parse !to:address (negated - excluded recipient)
    const notToMatch = token.match(/^!to:(.+)$/i);
    if (notToMatch) {
      result.notRecipient = notToMatch[1].toLowerCase();
      result.recipientSet = true;
      result.highlightTerms.push(token);
      continue;
    }

    // Parse to:address
    const toMatch = token.match(/^to:(.+)$/i);
    if (toMatch) {
      result.recipient = toMatch[1].toLowerCase();
      result.recipientSet = true;
      result.highlightTerms.push(token);
      continue;
    }

    // Parse !subject:text (negated - excluded subject text)
    const notSubjectMatch = token.match(/^!subject:(.+)$/i);
    if (notSubjectMatch) {
      result.notSubject = notSubjectMatch[1].toLowerCase();
      result.subjectSet = true;
      result.highlightTerms.push(token);
      continue;
    }

    // Parse subject:text
    const subjectMatch = token.match(/^subject:(.+)$/i);
    if (subjectMatch) {
      result.subject = subjectMatch[1].toLowerCase();
      result.subjectSet = true;
      result.highlightTerms.push(token);
      continue;
    }

    // Keep as regular search term
    remainingTokens.push(token);
  }

  // Join remaining tokens as the search query
  result.searchQuery = remainingTokens.join(' ').trim();

  return result;
}

/**
 * Reconcile a boolean toggle (is:otp / has:attachment) with the pill row so
 * chips and pills never contradict each other:
 *   • on=true  → the positive pill is guaranteed present (negated form removed)
 *   • on=false → both forms are removed (no pill for that filter)
 *
 * @param pills - Current pill list
 * @param positive - Positive token, e.g. 'is:otp'
 * @param on - Desired toggle state
 * @returns New pill list
 */
export function reconcileBooleanPill(
  pills: readonly string[],
  positive: string,
  on: boolean
): string[] {
  const negated = `!${positive}`;
  const base = pills.filter((p) => p !== positive && p !== negated);
  return on ? [...base, positive] : base;
}

/**
 * Reconcile a saved-filter query's boolean pills with the filter's boolean
 * flags (hasOTP / hasAttachment / unreadOnly) so restoring a filter never leaves the chip
 * row and pill row contradicting each other. Pills matching SHORTCUT_REGEX are
 * rebuilt from the flags; the free-text remainder is preserved.
 *
 * @param query - Stored filter searchQuery (may contain pills)
 * @param otp - Saved hasOTP flag
 * @param attachment - Saved hasAttachment flag
 * @returns Reconciled query
 */
export function reconcileSavedFilterQuery(
  query: string,
  otp: boolean,
  attachment: boolean,
  unread?: boolean
): string {
  const parts = (query || '').split(/\s+/).filter(Boolean);
  const pills = parts.filter((p) => SHORTCUT_REGEX.test(p));
  const text = parts.filter((p) => !SHORTCUT_REGEX.test(p));
  const parsed = parseSearchShortcuts(query);
  let reconciled = reconcileBooleanPill(pills, 'is:otp', otp);
  reconciled = reconcileBooleanPill(reconciled, 'has:attachment', attachment);
  reconciled = reconcileBooleanPill(
    reconciled,
    'is:unread',
    unread ?? (parsed.unreadOnlySet && parsed.unreadOnly)
  );
  return [...reconciled, ...text].filter(Boolean).join(' ');
}

/**
 * Tokenize a query string, respecting quoted strings
 * @param query - The query string to tokenize
 * @returns Array of tokens
 */
function tokenizeQuery(query: string): string[] {
  const tokens: string[] = [];
  let currentToken = '';
  let inQuotes = false;
  let quoteChar = '';

  for (let i = 0; i < query.length; i++) {
    const char = query[i];

    // Backslash escape inside a quoted string: \" or \' or \\
    if (char === '\\' && inQuotes && i + 1 < query.length) {
      const next = query[i + 1];
      if (next === quoteChar || next === '\\') {
        currentToken += next;
        i++;
        continue;
      }
    }

    if ((char === '"' || char === "'") && !inQuotes) {
      inQuotes = true;
      quoteChar = char;
    } else if (char === quoteChar && inQuotes) {
      inQuotes = false;
      quoteChar = '';
    } else if (char === ' ' && !inQuotes) {
      if (currentToken.trim()) {
        tokens.push(currentToken.trim());
        currentToken = '';
      }
    } else {
      currentToken += char;
    }
  }

  if (currentToken.trim()) {
    tokens.push(currentToken.trim());
  }

  return tokens;
}

/** HTML entities for the shared text/term escape pass. */
const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const HTML_ESCAPE_RE = /[&<>"']/g;

function escapeHtml(value: string): string {
  return value.replace(HTML_ESCAPE_RE, (m) => HTML_ESCAPES[m] || m);
}

/**
 * The compiled matcher for the LAST terms array passed to `highlightMatches`,
 * memoized so a list render does not rebuild it per row.
 *
 * The list views call `highlightMatches` once per row - twice per email row,
 * plus once per search-result row - while the terms are identical for every row
 * in a pass. The term pipeline (trim/lower/filter/de-dupe/sort) and, far more
 * expensively, the alternation `RegExp` compile therefore repeated for every
 * row of every render: rebuilding a 200-row list compiled the same pattern ~400
 * times.
 *
 * The memo is a single entry keyed by the raw terms, so it survives the terms
 * array being rebuilt with a fresh identity each render and is invalidated
 * whenever the query changes. One entry cannot grow, so it needs no eviction
 * policy, and it matches how a list renders - one term set per pass. A global
 * regex is safe to reuse: `String.prototype.replace` rewinds `lastIndex` for
 * the duration of each call, so no match state survives between rows. A `null`
 * memo means "these terms produce no matcher" (all filtered out, or the pattern
 * failed to compile) and the caller renders the escaped text unmarked.
 */
let cachedTermsKey: string | null = null;
let cachedTermsRegex: RegExp | null = null;

function highlightRegexForTerms(terms: string[]): RegExp | null {
  const key = terms.join('\u0000');
  if (cachedTermsKey === key) return cachedTermsRegex;

  // Filter, sanitize, and sort terms by length descending so longer terms match first
  const validTerms = terms
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0 && t.length <= 100 && !t.includes(':'));
  const uniqueTerms = [...new Set(validTerms)].sort((a, b) => b.length - a.length);

  let regex: RegExp | null = null;
  if (uniqueTerms.length > 0) {
    try {
      const escapedTerms = uniqueTerms.map((term) => escapeRegex(escapeHtml(term)));
      regex = new RegExp(`(${escapedTerms.join('|')})`, 'gi');
    } catch {
      // Ignore compilation errors
      regex = null;
    }
  }

  cachedTermsKey = key;
  cachedTermsRegex = regex;
  return regex;
}

/**
 * Highlight matched terms in text
 * @param text - The text to highlight
 * @param terms - Terms to highlight
 * @param highlightClass - CSS class for highlighting
 * @returns HTML string with highlighted terms
 */
export function highlightMatches(
  text: string,
  terms: string[],
  highlightClass: string = 'bg-md-primary-container text-md-on-primary-container rounded px-0.5'
): string {
  if (!text) return '';

  // Escape HTML characters first
  const result = escapeHtml(text);

  if (!terms?.length) {
    return result;
  }

  const regex = highlightRegexForTerms(terms);
  if (!regex) {
    return result;
  }

  return result.replace(regex, `<mark class="${highlightClass}">$1</mark>`);
}

/**
 * Escape special regex characters
 * @param str - String to escape
 * @returns Escaped string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
