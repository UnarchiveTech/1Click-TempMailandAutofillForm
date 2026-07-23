/**
 * Email filtering composable
 * Provides reactive email filtering with memoization for performance
 */

import { toMs } from '@/utils/time.js';
import type { Email } from '@/utils/types.js';

export interface EmailFilterOptions {
  searchQuery?: string;
  otpOnly?: boolean;
  senderDomain?: string;
  senderEmail?: string;
  recipient?: string;
  subject?: string;
  selectedSenders?: string[];
  dateFrom?: string;
  dateTo?: string;
  sortBy?: string;
  /** Message labels keyed by email id (mailbox search) */
  emailTagsById?: Record<string, string[]>;
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
    recipient = '',
    subject = '',
    selectedSenders = [],
    dateFrom = '',
    dateTo = '',
    sortBy = 'newest',
    emailTagsById = {},
  } = options;

  const getReceivedAtMs = (email: Email) => toMs(email.received_at);

  const filtered = emails.filter((email) => {
    // Search query filter (after parsing shortcuts)
    const q = searchQuery.toLowerCase();
    // Labels / tags on the message (if present) are searchable
    const tagEntry = emailTagsById[email.id];
    const storedLabels = (Array.isArray(tagEntry) ? tagEntry : []).join(' ');
    const labelsField = (email as { labels?: unknown }).labels;
    const tagsField = (email as { tags?: unknown }).tags;
    const labelBlob = [
      storedLabels,
      (email as { label?: string }).label,
      Array.isArray(labelsField) ? labelsField.join(' ') : '',
      (email as { tag?: string }).tag,
      Array.isArray(tagsField) ? tagsField.join(' ') : '',
      (email as { emailLabel?: string }).emailLabel,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const matchesSearch =
      !searchQuery ||
      email.subject?.toLowerCase().includes(q) ||
      email.from?.toLowerCase().includes(q) ||
      email.from_name?.toLowerCase().includes(q) ||
      email.body_plain?.toLowerCase().includes(q) ||
      email.body?.toLowerCase().includes(q) ||
      (labelBlob.length > 0 && labelBlob.includes(q));

    // OTP-only filter
    const matchesOtp = !otpOnly || email.isOtp || !!email.otp;

    // Sender domain filter
    const matchesDomain =
      !senderDomain || email.from?.toLowerCase().includes(senderDomain.toLowerCase());

    // Sender email filter (exact match)
    const matchesSenderEmail =
      !senderEmail || email.from?.toLowerCase() === senderEmail.toLowerCase();

    // Recipient filter (to:address)
    const matchesRecipient =
      !recipient || email.original_inbox?.toLowerCase().includes(recipient.toLowerCase());

    // Subject filter
    const matchesSubject = !subject || email.subject?.toLowerCase().includes(subject.toLowerCase());

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
      matchesRecipient &&
      matchesSubject &&
      matchesSelectedSenders &&
      matchesDateRange
    );
  });

  // Always copy before sort so we never mutate a shared array reference
  const sorted = [...filtered];
  const senderName = (e: Email) => (e.from_name || e.from || '').toLowerCase();
  const senderEmailVal = (e: Email) => (e.from || '').toLowerCase();
  const subjectVal = (e: Email) => (e.subject || '').toLowerCase();
  const byId = (a: Email, b: Email) => String(a.id).localeCompare(String(b.id));

  sorted.sort((a, b) => {
    let cmp = 0;
    switch (sortBy) {
      case 'oldest':
        cmp = getReceivedAtMs(a) - getReceivedAtMs(b);
        break;
      case 'senderNameAsc':
        cmp = senderName(a).localeCompare(senderName(b));
        break;
      case 'senderNameDesc':
        cmp = senderName(b).localeCompare(senderName(a));
        break;
      case 'senderEmailAsc':
        cmp = senderEmailVal(a).localeCompare(senderEmailVal(b));
        break;
      case 'senderEmailDesc':
        cmp = senderEmailVal(b).localeCompare(senderEmailVal(a));
        break;
      case 'subjectAsc':
        cmp = subjectVal(a).localeCompare(subjectVal(b));
        break;
      case 'subjectDesc':
        cmp = subjectVal(b).localeCompare(subjectVal(a));
        break;
      default: // 'newest' and unknown sorts
        cmp = getReceivedAtMs(b) - getReceivedAtMs(a);
        break;
    }
    return cmp !== 0 ? cmp : byId(a, b);
  });

  return sorted;
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
    const emailSig = currentEmails
      .map(
        (e) =>
          `${e.id}:${e.unread ? 1 : 0}:${e.received_at}:${e.local_archived ? 1 : 0}:${e.local_deleted ? 1 : 0}:${e.subject || ''}:${e.from || ''}:${e.isOtp ? 1 : 0}`
      )
      .join('|');
    const key = `${JSON.stringify(currentOptions)}#${currentEmails.length}#${emailSig}`;

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
