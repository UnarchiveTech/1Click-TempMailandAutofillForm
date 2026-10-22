import type { browser } from 'wxt/browser';
import { filterEmails } from '@/features/address/email-filters.js';
import { logError } from '@/utils/logger.js';
import { parseSearchShortcuts } from '@/utils/search/search-shortcuts.js';
import { updateStoredObject } from '@/utils/storage/rmw.js';
import type { Email, SavedSearchFilter } from '@/utils/types.js';

export interface FilterCriteria {
  searchQuery: string;
  otpOnly: boolean;
  unreadOnly: boolean;
  hasAttachment: boolean;
  senderDomain: string;
  senderEmail: string;
  recipient: string;
  subject: string;
  /** Exclude emails from this sender domain (!from:domain) */
  notSenderDomain: string;
  /** Exclude emails from this sender email (!from:email) */
  notSenderEmail: string;
  /** Exclude emails to this recipient (!to:address) */
  notRecipient: string;
  /** Exclude emails whose subject contains this text (!subject:text) */
  notSubject: string;
  selectedSenders: string[];
  dateFrom: string;
  dateTo: string;
  sortBy: string;
  emailLabelsById?: Record<string, string[]>;
}

export interface EmailFiltersState {
  /** Current search query */
  searchQuery: string;
  /** OTP-only filter */
  otpOnly: boolean;
  /** Unread-only filter */
  unreadOnly: boolean;
  /** Has-attachment filter */
  hasAttachment: boolean;
  /** Sender domain filter */
  senderDomain: string;
  /** Selected senders */
  selectedSenders: string[];
  /** Date from filter */
  dateFrom: string;
  /** Date to filter */
  dateTo: string;
  /** Sort option */
  sortBy: string;
  /** Saved filters */
  savedSearchFilters: SavedSearchFilter[];
}

export interface EmailFiltersResult {
  /** Filtered and sorted emails */
  filteredEmails: Email[];
  /** Current filter criteria */
  criteria: FilterCriteria;
  /** Whether any filter is active */
  hasActiveFilter: boolean;
}

/**
 * Apply filter criteria to an email list.
 * Pure function - no side effects.
 */
export function applyFilters(emails: Email[], criteria: FilterCriteria): Email[] {
  return filterEmails(emails, criteria);
}

/**
 * Check if any non-default filter is active.
 */
export function hasActiveFilter(criteria: FilterCriteria): boolean {
  return (
    criteria.searchQuery !== '' ||
    criteria.otpOnly ||
    criteria.unreadOnly ||
    criteria.hasAttachment ||
    criteria.senderDomain !== '' ||
    criteria.senderEmail !== '' ||
    criteria.recipient !== '' ||
    criteria.subject !== '' ||
    criteria.notSenderDomain !== '' ||
    criteria.notSenderEmail !== '' ||
    criteria.notRecipient !== '' ||
    criteria.notSubject !== '' ||
    criteria.selectedSenders.length > 0 ||
    criteria.dateFrom !== '' ||
    criteria.dateTo !== '' ||
    criteria.sortBy !== 'newest'
  );
}

/**
 * Parse search query with shortcuts and apply to filter criteria.
 * This function takes a raw search query and returns updated filter criteria
 * with shortcuts extracted and applied.
 *
 * @param rawQuery - The raw search query string (may contain shortcuts)
 * @param currentCriteria - Current filter criteria to update
 * @returns Updated filter criteria with shortcuts applied
 */
export function applySearchShortcuts(
  rawQuery: string,
  currentCriteria: FilterCriteria
): FilterCriteria {
  const parsed = parseSearchShortcuts(rawQuery);

  return {
    ...currentCriteria,
    searchQuery: parsed.searchQuery,
    // Explicit shortcut wins; absent shortcut leaves the current state alone
    otpOnly: parsed.otpOnlySet ? parsed.otpOnly : currentCriteria.otpOnly,
    unreadOnly: parsed.unreadOnlySet ? parsed.unreadOnly : currentCriteria.unreadOnly,
    hasAttachment: parsed.hasAttachmentSet ? parsed.hasAttachment : currentCriteria.hasAttachment,
    // Value shortcuts (from:/to:/subject: and their negated ! forms) are the
    // ONLY writers of these fields - there are no dedicated chips - so the raw
    // query is the source of truth: a present token sets it, an absent token
    // clears it. This is what makes pill removal round-trip cleanly: removing
    // the chip removes its token, and the field is cleared in the same commit
    // (FilterList keeps active pills in the committed query).
    senderDomain: parsed.senderDomainSet ? parsed.senderDomain : '',
    senderEmail: parsed.senderDomainSet ? parsed.senderEmail : '',
    recipient: parsed.recipientSet ? parsed.recipient : '',
    subject: parsed.subjectSet ? parsed.subject : '',
    notSenderDomain: parsed.senderDomainSet ? parsed.notSenderDomain : '',
    notSenderEmail: parsed.senderDomainSet ? parsed.notSenderEmail : '',
    notRecipient: parsed.recipientSet ? parsed.notRecipient : '',
    notSubject: parsed.subjectSet ? parsed.notSubject : '',
  };
}

/**
 * Load saved filters from extension storage.
 */
export async function loadSavedFilters(
  storage: typeof browser.storage.local
): Promise<SavedSearchFilter[]> {
  try {
    const result = await storage.get(['savedSearchFilters']);
    return parseSavedSearchFilters((result as Record<string, unknown>).savedSearchFilters);
  } catch (e) {
    logError('Error loading saved filters', {
      message: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}

/** Shared parse for the whole-key RMW helpers below (missing/corrupt → []). */
export function parseSavedSearchFilters(raw: unknown): SavedSearchFilter[] {
  return Array.isArray(raw) ? (raw as SavedSearchFilter[]) : [];
}

/** Read/write seams that honor the storage area the caller was handed. */
function savedFilterAccess(storage: typeof browser.storage.local) {
  return {
    read: async () =>
      parseSavedSearchFilters(
        ((await storage.get(['savedSearchFilters'])) as Record<string, unknown>).savedSearchFilters
      ),
    write: async (next: SavedSearchFilter[]) => {
      await storage.set({ savedSearchFilters: structuredClone(next) });
    },
  };
}

/**
 * Save a new filter to storage.
 * Returns the updated filters array.
 */
/** Normalize filter identity for uniqueness checks (ignore id/name/timestamps). */
export function filterSignature(f: {
  searchQuery?: string;
  hasOTP?: boolean;
  hasAttachment?: boolean;
  unreadOnly?: boolean;
  senderDomain?: string;
  senderEmail?: string;
  dateFrom?: string;
  dateTo?: string;
  selectedSenders?: string[];
  sortBy?: string;
  recipient?: string;
  subject?: string;
  notSenderDomain?: string;
  notSenderEmail?: string;
  notRecipient?: string;
  notSubject?: string;
}): string {
  return JSON.stringify({
    q: (f.searchQuery || '').trim().toLowerCase(),
    otp: !!f.hasOTP,
    att: !!f.hasAttachment,
    unread: f.unreadOnly ?? parseSearchShortcuts(f.searchQuery || '').unreadOnly,
    domain: (f.senderDomain || '').trim().toLowerCase(),
    senderEmail: (
      f.senderEmail || parseSearchShortcuts(f.searchQuery || '').senderEmail
    ).toLowerCase(),
    from: f.dateFrom || '',
    to: f.dateTo || '',
    senders: [...(f.selectedSenders || [])].map((s) => s.toLowerCase()).sort(),
    sort: f.sortBy || '',
    recipient: (f.recipient || '').toLowerCase(),
    subject: (f.subject || '').toLowerCase(),
    notDomain: (f.notSenderDomain || '').trim().toLowerCase(),
    notEmail: (f.notSenderEmail || '').toLowerCase(),
    notRecipient: (f.notRecipient || '').toLowerCase(),
    notSubject: (f.notSubject || '').toLowerCase(),
  });
}

export async function saveFilterToStorage(
  storage: typeof browser.storage.local,
  filter: SavedSearchFilter
): Promise<SavedSearchFilter[]> {
  try {
    const sig = filterSignature(filter);
    // Serialized RMW: the dup check and the append both run against the list
    // storage holds when this call's turn on the key arrives, so a concurrent
    // save/rename/delete cannot be overwritten by a stale in-memory copy.
    return await updateStoredObject<SavedSearchFilter[]>(
      'savedSearchFilters',
      (current) => {
        if (current.some((f) => filterSignature(f) === sig)) {
          // Return unchanged - caller compares length to toast "already exists".
          return current;
        }
        return [...current, filter];
      },
      parseSavedSearchFilters,
      savedFilterAccess(storage)
    );
  } catch (e) {
    logError('Error saving filter', { message: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

/**
 * Delete a filter from storage.
 * Returns the updated filters array.
 */
export async function deleteFilterFromStorage(
  storage: typeof browser.storage.local,
  filterId: string
): Promise<SavedSearchFilter[]> {
  try {
    return await updateStoredObject<SavedSearchFilter[]>(
      'savedSearchFilters',
      (current) => current.filter((f) => f.id !== filterId),
      parseSavedSearchFilters,
      savedFilterAccess(storage)
    );
  } catch (e) {
    logError('Error deleting filter', { message: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

/**
 * Rename a filter in storage.
 * Returns the updated filters array.
 */
export async function renameFilterInStorage(
  storage: typeof browser.storage.local,
  filterId: string,
  newName: string
): Promise<SavedSearchFilter[]> {
  try {
    return await updateStoredObject<SavedSearchFilter[]>(
      'savedSearchFilters',
      (current) => current.map((f) => (f.id === filterId ? { ...f, name: newName } : { ...f })),
      parseSavedSearchFilters,
      savedFilterAccess(storage)
    );
  } catch (e) {
    logError('Error renaming filter', { message: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

/**
 * Create a new saved filter object.
 */
export function createFilter(
  name: string,
  searchQuery: string,
  hasOTP: boolean,
  hasAttachment: boolean,
  senderDomain: string,
  dateFrom: string,
  dateTo: string,
  selectedSenders: string[] = [],
  sortBy: string = 'newest',
  recipient: string = '',
  subject: string = '',
  notSenderDomain: string = '',
  notSenderEmail: string = '',
  notRecipient: string = '',
  notSubject: string = '',
  senderEmail: string = '',
  unreadOnly: boolean = false
): SavedSearchFilter {
  const uuid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  return {
    id: uuid,
    name,
    searchQuery,
    hasOTP,
    hasAttachment,
    unreadOnly,
    senderDomain,
    senderEmail,
    selectedSenders,
    dateFrom,
    dateTo,
    sortBy,
    recipient,
    subject,
    notSenderDomain,
    notSenderEmail,
    notRecipient,
    notSubject,
    createdAt: Date.now(),
  };
}

/**
 * Build a SavedSearchFilter from current criteria.
 */
export function buildFilterFromCriteria(name: string, criteria: FilterCriteria): SavedSearchFilter {
  return createFilter(
    name,
    criteria.searchQuery,
    criteria.otpOnly,
    criteria.hasAttachment,
    criteria.senderDomain,
    criteria.dateFrom,
    criteria.dateTo,
    criteria.selectedSenders,
    criteria.sortBy,
    criteria.recipient,
    criteria.subject,
    criteria.notSenderDomain,
    criteria.notSenderEmail,
    criteria.notRecipient,
    criteria.notSubject,
    criteria.senderEmail,
    criteria.unreadOnly
  );
}

/**
 * Extract filter criteria from a SavedSearchFilter.
 */
export function extractCriteriaFromFilter(filter: SavedSearchFilter): Partial<FilterCriteria> {
  const parsedQuery = parseSearchShortcuts(filter.searchQuery);
  return {
    searchQuery: filter.searchQuery,
    otpOnly: filter.hasOTP,
    hasAttachment: !!filter.hasAttachment,
    unreadOnly: filter.unreadOnly ?? (parsedQuery.unreadOnlySet ? parsedQuery.unreadOnly : false),
    senderDomain: filter.senderDomain,
    senderEmail: filter.senderEmail || parsedQuery.senderEmail,
    selectedSenders: filter.selectedSenders || [],
    dateFrom: filter.dateFrom,
    dateTo: filter.dateTo,
    sortBy: filter.sortBy || 'newest',
    recipient: filter.recipient || '',
    subject: filter.subject || '',
    notSenderDomain: filter.notSenderDomain || '',
    notSenderEmail: filter.notSenderEmail || '',
    notRecipient: filter.notRecipient || '',
    notSubject: filter.notSubject || '',
  };
}
