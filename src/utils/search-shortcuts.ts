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
      // Could be used for recipient filtering in the future
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

    if ((char === '"' || char === "'") && !inQuotes) {
      inQuotes = true;
      quoteChar = char;
    } else if (char === quoteChar && inQuotes) {
      inQuotes = false;
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
  highlightClass: string = 'bg-yellow-200 dark:bg-yellow-800'
): string {
  if (!text || !terms.length) {
    return text;
  }

  let result = text;
  const uniqueTerms = [...new Set(terms.map((t) => t.toLowerCase()))];

  for (const term of uniqueTerms) {
    // Skip shortcut syntax in highlighting
    if (term.includes(':')) continue;

    const regex = new RegExp(`(${escapeRegex(term)})`, 'gi');
    result = result.replace(regex, `<mark class="${highlightClass}">$1</mark>`);
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
