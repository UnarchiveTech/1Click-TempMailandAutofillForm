import { parseSearchShortcuts } from '@/utils/search/search-shortcuts.js';
import type { Email } from '@/utils/types.js';
import type { FilterCriteria } from './use-email-filters.js';
import { applyFilters, applySearchShortcuts } from './use-email-filters.js';

export interface SearchFilterState {
  searchQuery: string;
  otpOnly: boolean;
  unreadOnly: boolean;
  hasAttachment: boolean;
  senderDomain: string;
  senderEmail: string;
  recipient: string;
  subject: string;
  notSenderDomain: string;
  notSenderEmail: string;
  notRecipient: string;
  notSubject: string;
  selectedSenders: string[];
  dateFrom: string;
  dateTo: string;
  sortBy: string;
  emailLabelsById: Record<string, string[]>;
}

/** Extract the free-text portion of a query (shortcut tokens removed). */
export function freeTextQuery(rawQuery: string): string {
  return parseSearchShortcuts(rawQuery).searchQuery;
}

/** Mutate filter state in-place when user commits a new raw search query
 * (including shortcut tokens like otp: sender: subject: date:). */
export function commitSearchQuery(rawQuery: string, state: SearchFilterState): SearchFilterState {
  const currentCriteria: FilterCriteria = {
    searchQuery: state.searchQuery,
    otpOnly: state.otpOnly,
    unreadOnly: state.unreadOnly,
    hasAttachment: state.hasAttachment,
    senderDomain: state.senderDomain,
    senderEmail: state.senderEmail,
    recipient: state.recipient,
    subject: state.subject,
    notSenderDomain: state.notSenderDomain,
    notSenderEmail: state.notSenderEmail,
    notRecipient: state.notRecipient,
    notSubject: state.notSubject,
    selectedSenders: state.selectedSenders,
    dateFrom: state.dateFrom,
    dateTo: state.dateTo,
    sortBy: state.sortBy,
    emailLabelsById: state.emailLabelsById,
  };

  const updated = applySearchShortcuts(rawQuery, currentCriteria);

  return {
    searchQuery: rawQuery,
    otpOnly: updated.otpOnly,
    unreadOnly: updated.unreadOnly,
    hasAttachment: updated.hasAttachment,
    senderDomain: updated.senderDomain,
    senderEmail: updated.senderEmail,
    recipient: updated.recipient,
    subject: updated.subject,
    notSenderDomain: updated.notSenderDomain,
    notSenderEmail: updated.notSenderEmail,
    notRecipient: updated.notRecipient,
    notSubject: updated.notSubject,
    selectedSenders: state.selectedSenders,
    dateFrom: state.dateFrom,
    dateTo: state.dateTo,
    sortBy: state.sortBy,
    emailLabelsById: state.emailLabelsById,
  };
}

/** Build the FilterCriteria object passed to `applyFilters`. */
export function buildFilterCriteria(
  state: SearchFilterState,
  freeTextSearch: string
): FilterCriteria {
  return {
    searchQuery: freeTextSearch,
    otpOnly: state.otpOnly,
    unreadOnly: state.unreadOnly,
    hasAttachment: state.hasAttachment,
    senderDomain: state.senderDomain,
    senderEmail: state.senderEmail,
    recipient: state.recipient,
    subject: state.subject,
    notSenderDomain: state.notSenderDomain,
    notSenderEmail: state.notSenderEmail,
    notRecipient: state.notRecipient,
    notSubject: state.notSubject,
    selectedSenders: state.selectedSenders,
    dateFrom: state.dateFrom,
    dateTo: state.dateTo,
    sortBy: state.sortBy,
    emailLabelsById: state.emailLabelsById,
  };
}

/** Pure filter - returns filtered+sorted email array from messages + criteria. */
export function filterMessages(emails: Email[], criteria: FilterCriteria): Email[] {
  return applyFilters(emails, criteria);
}
