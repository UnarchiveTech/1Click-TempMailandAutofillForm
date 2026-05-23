/**
 * Email filtering composable
 * Provides reactive email filtering with memoization for performance
 */

import type { Email } from '@/utils/types.js';

export interface EmailFilterOptions {
  searchQuery?: string;
  otpOnly?: boolean;
  senderDomain?: string;
  selectedSenders?: string[];
  dateFrom?: string;
  dateTo?: string;
  sortBy?: string;
}

/**
 * Filters and sorts emails based on provided criteria
 * @param emails - The array of emails to filter
 * @param options - Filtering and sorting options
 * @returns Filtered and sorted array of emails
 */
export function filterEmails(emails: Email[], options: EmailFilterOptions): Email[] {
  const {
    searchQuery = '',
    otpOnly = false,
    senderDomain = '',
    selectedSenders = [],
    dateFrom = '',
    dateTo = '',
    sortBy = 'date',
  } = options;

  return emails
    .filter((email) => {
      // Search query filter
      const matchesSearch =
        !searchQuery ||
        email.subject?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        email.from?.toLowerCase().includes(searchQuery.toLowerCase());

      // OTP-only filter
      const matchesOtp = !otpOnly || email.isOtp;

      // Sender domain filter
      const matchesDomain =
        !senderDomain || email.from?.toLowerCase().includes(senderDomain.toLowerCase());

      // Selected senders filter (multi-select)
      const matchesSelectedSenders =
        selectedSenders.length === 0 ||
        selectedSenders.some((s) => email.from?.toLowerCase().includes(s.toLowerCase()));

      // Date range filter
      let matchesDateRange = true;
      if (dateFrom) {
        const fromDate = new Date(dateFrom).getTime();
        matchesDateRange = matchesDateRange && email.received_at >= fromDate;
      }
      if (dateTo) {
        const toDate = new Date(dateTo).getTime();
        matchesDateRange = matchesDateRange && email.received_at <= toDate;
      }

      return (
        matchesSearch && matchesOtp && matchesDomain && matchesSelectedSenders && matchesDateRange
      );
    })
    .sort((a, b) => {
      // Sorting logic
      switch (sortBy) {
        case 'newest':
          return b.received_at - a.received_at;
        case 'oldest':
          return a.received_at - b.received_at;
        case 'senderNameAsc':
          return (a.from_name || '').localeCompare(b.from_name || '');
        case 'senderNameDesc':
          return (b.from_name || '').localeCompare(a.from_name || '');
        case 'senderEmailAsc':
          return (a.from || '').localeCompare(b.from || '');
        case 'senderEmailDesc':
          return (b.from || '').localeCompare(a.from || '');
        case 'subjectAsc':
          return (a.subject || '').localeCompare(b.subject || '');
        case 'subjectDesc':
          return (b.subject || '').localeCompare(a.subject || '');
        default:
          return b.received_at - a.received_at; // Default to newest
      }
    });
}

/**
 * Creates a reactive email filter with memoization
 * @param emails - Reactive array of emails
 * @param options - Reactive filter options
 * @returns Reactive filtered emails
 */
export function useEmailFilter(
  emails: () => Email[],
  options: () => EmailFilterOptions
): () => Email[] {
  let cacheKey = '';
  let cachedResult: Email[] = [];

  return () => {
    const currentEmails = emails();
    const currentOptions = options();
    const key = JSON.stringify(currentOptions) + currentEmails.length;

    if (key === cacheKey && cachedResult.length > 0) {
      return cachedResult;
    }

    const result = filterEmails(currentEmails, currentOptions);
    cacheKey = key;
    cachedResult = result;
    return result;
  };
}
