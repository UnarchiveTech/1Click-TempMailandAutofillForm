import type { Browser } from 'wxt/browser';
import {
  createFilter,
  deleteFilterFromStorage,
  loadSavedFilters,
  renameFilterInStorage,
  saveFilterToStorage,
} from '@/composables/useEmailFilters.js';
import { t } from '@/utils/i18n-utils.js';
import { logError } from '@/utils/logger.js';
import type { SavedSearchFilter } from '@/utils/types.js';
import { validateTextInput } from '@/utils/validation.js';

export interface SavedSearchFilterState {
  get savedSearchFilters(): SavedSearchFilter[];
}

export interface SavedSearchFilterSetters {
  setSavedSearchFilters: (filters: SavedSearchFilter[]) => void;
  setSearchQuery: (value: string) => void;
  setOtpOnly: (value: boolean) => void;
  setSenderDomain: (value: string) => void;
  setSenderEmail: (value: string) => void;
  setSubject: (value: string) => void;
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
  senderDomain: string;
  dateFrom: string;
  dateTo: string;
  selectedSenders: string[];
  sortBy: string;
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
        input.senderDomain,
        input.dateFrom,
        input.dateTo,
        input.selectedSenders,
        input.sortBy
      );
      const filters = await saveFilterToStorage(
        ext.storage.local,
        state.savedSearchFilters,
        newFilter
      );
      setters.setSavedSearchFilters(filters);
      setters.showToast(await t('toasts.filterSaved'));
    } catch (error) {
      logError('Error saving filter', error);
      setters.showToast(await t('toasts.filterSaveFailed'), 'error');
    }
  }

  async function renameFilter(id: string, name: string) {
    try {
      const filterName = validateTextInput(name, 'Filter name', 64);
      const filters = await renameFilterInStorage(
        ext.storage.local,
        state.savedSearchFilters,
        id,
        filterName
      );
      setters.setSavedSearchFilters(filters);
      setters.showToast(await t('toasts.filterRenamed'));
    } catch (error) {
      logError('Error renaming filter', error);
      setters.showToast(await t('toasts.filterRenameFailed'), 'error');
    }
  }

  async function loadFilter(filter: SavedSearchFilter) {
    setters.setSearchQuery(filter.searchQuery);
    setters.setOtpOnly(filter.hasOTP);
    setters.setSenderDomain(filter.senderDomain);
    setters.setSenderEmail('');
    setters.setSubject('');
    setters.setSelectedSenders(filter.selectedSenders || []);
    setters.setDateFrom(filter.dateFrom);
    setters.setDateTo(filter.dateTo);
    setters.setSortBy(filter.sortBy || 'newest');
    setters.showToast(await t('toasts.filterLoaded', { name: filter.name }));
  }

  function clearFilters() {
    setters.setSearchQuery('');
    setters.setOtpOnly(false);
    setters.setSenderDomain('');
    setters.setSenderEmail('');
    setters.setSubject('');
    setters.setSelectedSenders([]);
    setters.setDateFrom('');
    setters.setDateTo('');
    setters.setSortBy('newest');
  }

  async function deleteFilter(filterId: string) {
    try {
      const filters = await deleteFilterFromStorage(
        ext.storage.local,
        state.savedSearchFilters,
        filterId
      );
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
