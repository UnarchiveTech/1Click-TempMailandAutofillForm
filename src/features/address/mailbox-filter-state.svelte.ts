import type { Email } from '@/utils/types.js';
import {
  buildFilterCriteria,
  commitSearchQuery,
  filterMessages,
  freeTextQuery,
  type SearchFilterState,
} from './use-search-filters.svelte.js';

export interface MailboxFilterState extends SearchFilterState {
  searchQuery: string;
}

export interface MailboxFilterStateOptions {
  emailLabelsById: () => Record<string, string[]>;
}

/**
 * Owns the mailbox's query and filter values while keeping the state local to
 * the component that creates it. This avoids a singleton store shared between
 * popup, sidepanel, and app instances.
 */
export function createMailboxFilterState(options: MailboxFilterStateOptions) {
  let searchQuery = $state('');
  let otpOnly = $state(false);
  let unreadOnly = $state(false);
  let hasAttachment = $state(false);
  let senderDomain = $state('');
  let senderEmail = $state('');
  let recipient = $state('');
  let subject = $state('');
  let notSenderDomain = $state('');
  let notSenderEmail = $state('');
  let notRecipient = $state('');
  let notSubject = $state('');
  let selectedSenders = $state<string[]>([]);
  let dateFrom = $state('');
  let dateTo = $state('');
  let sortBy = $state('newest');

  const searchQueryFreeText = $derived(freeTextQuery(searchQuery));

  const state = $derived<SearchFilterState>({
    searchQuery: searchQueryFreeText,
    otpOnly,
    unreadOnly,
    hasAttachment,
    senderDomain,
    senderEmail,
    recipient,
    subject,
    notSenderDomain,
    notSenderEmail,
    notRecipient,
    notSubject,
    selectedSenders,
    dateFrom,
    dateTo,
    sortBy,
    emailLabelsById: options.emailLabelsById(),
  });

  const filtered = (emails: Email[]) =>
    filterMessages(emails, buildFilterCriteria(state, searchQueryFreeText));

  function applySearchQuery(value: string) {
    const updated = commitSearchQuery(value, state);
    searchQuery = value;
    otpOnly = updated.otpOnly;
    unreadOnly = updated.unreadOnly;
    hasAttachment = updated.hasAttachment;
    senderDomain = updated.senderDomain;
    senderEmail = updated.senderEmail;
    recipient = updated.recipient;
    subject = updated.subject;
    notSenderDomain = updated.notSenderDomain;
    notSenderEmail = updated.notSenderEmail;
    notRecipient = updated.notRecipient;
    notSubject = updated.notSubject;
  }

  function clear() {
    searchQuery = '';
    otpOnly = false;
    unreadOnly = false;
    hasAttachment = false;
    senderDomain = '';
    senderEmail = '';
    recipient = '';
    subject = '';
    notSenderDomain = '';
    notSenderEmail = '';
    notRecipient = '';
    notSubject = '';
    selectedSenders = [];
    dateFrom = '';
    dateTo = '';
    sortBy = 'newest';
  }

  return {
    get searchQuery() {
      return searchQuery;
    },
    set searchQuery(value: string) {
      searchQuery = value;
    },
    get otpOnly() {
      return otpOnly;
    },
    set otpOnly(value: boolean) {
      otpOnly = value;
    },
    get unreadOnly() {
      return unreadOnly;
    },
    set unreadOnly(value: boolean) {
      unreadOnly = value;
    },
    get hasAttachment() {
      return hasAttachment;
    },
    set hasAttachment(value: boolean) {
      hasAttachment = value;
    },
    get senderDomain() {
      return senderDomain;
    },
    set senderDomain(value: string) {
      senderDomain = value;
    },
    get senderEmail() {
      return senderEmail;
    },
    set senderEmail(value: string) {
      senderEmail = value;
    },
    get recipient() {
      return recipient;
    },
    set recipient(value: string) {
      recipient = value;
    },
    get subject() {
      return subject;
    },
    set subject(value: string) {
      subject = value;
    },
    get notSenderDomain() {
      return notSenderDomain;
    },
    set notSenderDomain(value: string) {
      notSenderDomain = value;
    },
    get notSenderEmail() {
      return notSenderEmail;
    },
    set notSenderEmail(value: string) {
      notSenderEmail = value;
    },
    get notRecipient() {
      return notRecipient;
    },
    set notRecipient(value: string) {
      notRecipient = value;
    },
    get notSubject() {
      return notSubject;
    },
    set notSubject(value: string) {
      notSubject = value;
    },
    get selectedSenders() {
      return selectedSenders;
    },
    set selectedSenders(value: string[]) {
      selectedSenders = value;
    },
    get dateFrom() {
      return dateFrom;
    },
    set dateFrom(value: string) {
      dateFrom = value;
    },
    get dateTo() {
      return dateTo;
    },
    set dateTo(value: string) {
      dateTo = value;
    },
    get sortBy() {
      return sortBy;
    },
    set sortBy(value: string) {
      sortBy = value;
    },
    get searchQueryFreeText() {
      return searchQueryFreeText;
    },
    get state() {
      return state;
    },
    get filteredEmails() {
      return filtered;
    },
    applySearchQuery,
    clear,
  };
}
