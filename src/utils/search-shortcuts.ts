/**
 * Search shortcut parser for email filtering
 * Supports syntax like: is:otp, from:domain.com, to:address, subject:text
 */

export interface ParsedSearchQuery {
  /** The remaining text search query after removing shortcuts */
  searchQuery: string;
  /** Whether to filter for OTP-only emails */
  otpOnly: boolean;
  /** Sender domain filter */
  senderDomain: string;
  /** Sender email filter */
  senderEmail: string;
  /** Recipient address filter */
  recipient: string;
  /** Subject filter */
  subject: string;
  /** Highlight terms for UI */
  highlightTerms: string[];
}

/**
 * Parse search query for shortcuts
 * Supported shortcuts:
 * - is:otp - Filter for OTP emails only
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
    senderDomain: '',
    senderEmail: '',
    recipient: '',
    subject: '',
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

    // Parse is:otp
    if (lowerToken === 'is:otp') {
      result.otpOnly = true;
      result.highlightTerms.push('is:otp');
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
      result.highlightTerms.push(token);
      continue;
    }

    // Parse to:address
    const toMatch = token.match(/^to:(.+)$/i);
    if (toMatch) {
      result.recipient = toMatch[1].toLowerCase();
      result.highlightTerms.push(token);
      continue;
    }

    // Parse subject:text
    const subjectMatch = token.match(/^subject:(.+)$/i);
    if (subjectMatch) {
      result.subject = subjectMatch[1].toLowerCase();
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
  let result = text.replace(
    /[&<>"']/g,
    (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m] || m
  );

  if (!terms?.length) {
    return result;
  }

  // Filter, sanitize, and sort terms by length descending so longer terms match first
  const validTerms = terms
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0 && t.length <= 100 && !t.includes(':'));

  if (validTerms.length === 0) {
    return result;
  }

  const uniqueTerms = [...new Set(validTerms)].sort((a, b) => b.length - a.length);

  try {
    const escapedTerms = uniqueTerms.map((term) => {
      const escapedTermHtml = term.replace(
        /[&<>"']/g,
        (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m] || m
      );
      return escapeRegex(escapedTermHtml);
    });

    const pattern = `(${escapedTerms.join('|')})`;
    const regex = new RegExp(pattern, 'gi');
    result = result.replace(regex, `<mark class="${highlightClass}">$1</mark>`);
  } catch {
    // Ignore compilation errors
  }

  return result;
}

/**
 * Escape special regex characters
 * @param str - String to escape
 * @returns Escaped string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
