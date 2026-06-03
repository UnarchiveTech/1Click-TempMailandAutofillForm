/**
 * Email filtering composable
 * Provides reactive email filtering with memoization for performance
 */

import type { Email } from '@/utils/types.js';

export interface EmailFilterOptions {
  searchQuery?: string;
  otpOnly?: boolean;
  senderDomain?: string;
  senderEmail?: string;
  subject?: string;
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
    senderEmail = '',
    subject = '',
    selectedSenders = [],
    dateFrom = '',
    dateTo = '',
    sortBy = 'newest',
  } = options;

  const getReceivedAtMs = (email: Email) =>
    email.received_at > 1_000_000_000_000 ? email.received_at : email.received_at * 1000;

  return emails
    .filter((email) => {
      // Search query filter (after parsing shortcuts)
      const matchesSearch =
        !searchQuery ||
        email.subject?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        email.from?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        email.body_plain?.toLowerCase().includes(searchQuery.toLowerCase());

      // OTP-only filter
      const matchesOtp = !otpOnly || email.isOtp;

      // Sender domain filter
      const matchesDomain =
        !senderDomain || email.from?.toLowerCase().includes(senderDomain.toLowerCase());

      // Sender email filter (exact match)
      const matchesSenderEmail =
        !senderEmail || email.from?.toLowerCase() === senderEmail.toLowerCase();

      // Subject filter
      const matchesSubject =
        !subject || email.subject?.toLowerCase().includes(subject.toLowerCase());

      // Selected senders filter (multi-select)
      const matchesSelectedSenders =
        selectedSenders.length === 0 ||
        selectedSenders.some((s) => email.from?.toLowerCase().includes(s.toLowerCase()));

      // Date range filter
      let matchesDateRange = true;
      const receivedAtMs = getReceivedAtMs(email);
      if (dateFrom) {
        const fromDate = new Date(dateFrom).getTime();
        matchesDateRange = matchesDateRange && receivedAtMs >= fromDate;
      }
      if (dateTo) {
        const toDate = new Date(dateTo).getTime() + 24 * 60 * 60 * 1000 - 1;
        matchesDateRange = matchesDateRange && receivedAtMs <= toDate;
      }

      return (
        matchesSearch &&
        matchesOtp &&
        matchesDomain &&
        matchesSenderEmail &&
        matchesSubject &&
        matchesSelectedSenders &&
        matchesDateRange
      );
    })
    .sort((a, b) => {
      // Sorting logic
      switch (sortBy) {
        case 'newest':
          return getReceivedAtMs(b) - getReceivedAtMs(a);
        case 'oldest':
          return getReceivedAtMs(a) - getReceivedAtMs(b);
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
  let hasCachedResult = false;

  return () => {
    const currentEmails = emails();
    const currentOptions = options();
    const key = JSON.stringify(currentOptions) + currentEmails.length;

    if (hasCachedResult && key === cacheKey) {
      return cachedResult;
    }

    const result = filterEmails(currentEmails, currentOptions);
    cacheKey = key;
    cachedResult = result;
    hasCachedResult = true;
    return result;
  };
}
