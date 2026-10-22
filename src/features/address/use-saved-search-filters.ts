import {
  createFilter,
  deleteFilterFromStorage,
  loadSavedFilters,
  renameFilterInStorage,
  saveFilterToStorage,
} from '@/features/address/use-email-filters.js';
import { t } from '@/utils/i18n/i18n-utils.js';
import { logError } from '@/utils/logger.js';
import {
  parseSearchShortcuts,
  reconcileSavedFilterQuery,
} from '@/utils/search/search-shortcuts.js';
import type { SavedSearchFilter } from '@/utils/types.js';
import { validateTextInput } from '@/utils/validation.js';

export interface SavedSearchFilterState {
  get savedSearchFilters(): SavedSearchFilter[];
}

export interface SavedSearchFilterSetters {
  setSavedSearchFilters: (filters: SavedSearchFilter[]) => void;
  setSearchQuery: (value: string) => void;
  setOtpOnly: (value: boolean) => void;
  setUnreadOnly: (value: boolean) => void;
  setHasAttachment: (value: boolean) => void;
  setSenderDomain: (value: string) => void;
  setSenderEmail: (value: string) => void;
  setRecipient: (value: string) => void;
  setSubject: (value: string) => void;
  setNotSenderDomain: (value: string) => void;
  setNotSenderEmail: (value: string) => void;
  setNotRecipient: (value: string) => void;
  setNotSubject: (value: string) => void;
  setSelectedSenders: (value: string[]) => void;
  setDateFrom: (value: string) => void;
  setDateTo: (value: string) => void;
  setSortBy: (value: string) => void;
  showToast: (message: string, type?: 'success' | 'error') => void;
}

export interface SaveFilterInput {
  name: string;
  searchQuery: string;
  hasOTP: boolean;
  hasAttachment: boolean;
  unreadOnly: boolean;
  senderDomain: string;
  senderEmail: string;
  dateFrom: string;
  dateTo: string;
  selectedSenders: string[];
  sortBy: string;
  recipient: string;
  subject: string;
  notSenderDomain: string;
  notSenderEmail: string;
  notRecipient: string;
  notSubject: string;
}

export function useSavedSearchFilters(
  ext: Browser,
  state: SavedSearchFilterState,
  setters: SavedSearchFilterSetters
) {
  async function loadSavedSearchFilters() {
    setters.setSavedSearchFilters(await loadSavedFilters(ext.storage.local));
  }

  async function saveFilter(input: SaveFilterInput) {
    try {
      const filterName = validateTextInput(input.name, 'Filter name', 64);
      const newFilter = createFilter(
        filterName,
        input.searchQuery,
        input.hasOTP,
        input.hasAttachment,
        input.senderDomain,
        input.dateFrom,
        input.dateTo,
        input.selectedSenders,
        input.sortBy,
        input.recipient,
        input.subject || '',
        input.notSenderDomain || '',
        input.notSenderEmail || '',
        input.notRecipient || '',
        input.notSubject || '',
        input.senderEmail || '',
        input.unreadOnly
      );
      const before = state.savedSearchFilters.length;
      const filters = await saveFilterToStorage(ext.storage.local, newFilter);
      setters.setSavedSearchFilters(filters);
      if (filters.length === before) {
        setters.showToast(await t('toasts.filterDuplicate'), 'error');
      } else {
        setters.showToast(await t('toasts.filterSaved'));
      }
    } catch (error) {
      logError('Error saving filter', error);
      setters.showToast(await t('toasts.filterSaveFailed'), 'error');
    }
  }

  async function renameFilter(id: string, name: string) {
    try {
      const filterName = validateTextInput(name, 'Filter name', 64);
      const filters = await renameFilterInStorage(ext.storage.local, id, filterName);
      setters.setSavedSearchFilters(filters);
      setters.showToast(await t('toasts.filterRenamed'));
    } catch (error) {
      logError('Error renaming filter', error);
      setters.showToast(await t('toasts.filterRenameFailed'), 'error');
    }
  }

  async function loadFilter(filter: SavedSearchFilter) {
    // Reconcile the stored query's pills with its boolean flags so chips and
    // pills never contradict after a filter load.
    const restoredQuery = reconcileSavedFilterQuery(
      filter.searchQuery,
      filter.hasOTP,
      !!filter.hasAttachment,
      filter.unreadOnly
    );
    setters.setSearchQuery(restoredQuery);
    setters.setOtpOnly(filter.hasOTP);
    const parsedQuery = parseSearchShortcuts(restoredQuery);
    setters.setUnreadOnly(
      filter.unreadOnly ?? (parsedQuery.unreadOnlySet ? parsedQuery.unreadOnly : false)
    );
    setters.setHasAttachment(!!filter.hasAttachment);
    setters.setSenderDomain(filter.senderDomain);
    // Sender email is encoded in the `from:` query shortcut rather than a
    // separate SavedSearchFilter field. Restore its parsed value explicitly;
    // setSearchQuery alone does not commit shortcut fields into mailbox state.
    setters.setSenderEmail(
      filter.senderEmail || (parsedQuery.senderDomainSet ? parsedQuery.senderEmail : '')
    );
    setters.setRecipient(filter.recipient || '');
    setters.setSubject(filter.subject || '');
    setters.setNotSenderDomain(filter.notSenderDomain || '');
    setters.setNotSenderEmail(filter.notSenderEmail || '');
    setters.setNotRecipient(filter.notRecipient || '');
    setters.setNotSubject(filter.notSubject || '');
    setters.setSelectedSenders(filter.selectedSenders || []);
    setters.setDateFrom(filter.dateFrom);
    setters.setDateTo(filter.dateTo);
    setters.setSortBy(filter.sortBy || 'newest');
    setters.showToast(await t('toasts.filterLoaded', { name: filter.name }));
  }

  function clearFilters() {
    setters.setSearchQuery('');
    setters.setOtpOnly(false);
    setters.setHasAttachment(false);
    setters.setSenderDomain('');
    setters.setSenderEmail('');
    setters.setRecipient('');
    setters.setSubject('');
    setters.setNotSenderDomain('');
    setters.setNotSenderEmail('');
    setters.setNotRecipient('');
    setters.setNotSubject('');
    setters.setSelectedSenders([]);
    setters.setDateFrom('');
    setters.setDateTo('');
    setters.setSortBy('newest');
  }

  async function deleteFilter(filterId: string) {
    try {
      const filters = await deleteFilterFromStorage(ext.storage.local, filterId);
      setters.setSavedSearchFilters(filters);
      setters.showToast(await t('toasts.filterDeleted'));
    } catch (error) {
      logError('Error deleting filter', error);
      setters.showToast(await t('toasts.filterDeleteFailed'), 'error');
    }
  }

  return {
    loadSavedSearchFilters,
    saveFilter,
    renameFilter,
    loadFilter,
    clearFilters,
    deleteFilter,
  };
}
