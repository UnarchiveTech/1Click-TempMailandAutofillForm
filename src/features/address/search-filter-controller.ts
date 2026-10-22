import type {
  SavedSearchFilterSetters,
  SavedSearchFilterState,
  SaveFilterInput,
} from './use-saved-search-filters.js';

type SavedSearchFiltersActions = {
  loadSavedSearchFilters: () => Promise<void>;
  saveFilter: (input: SaveFilterInput) => Promise<void>;
  renameFilter: (id: string, name: string) => Promise<void>;
  loadFilter: (filter: import('@/utils/types.js').SavedSearchFilter) => Promise<void>;
  clearFilters: () => void;
  deleteFilter: (id: string) => Promise<void>;
};

export interface SearchFilterControllerDeps {
  state: SavedSearchFilterState;
  setters: SavedSearchFilterSetters;
}

/**
 * Lazily creates and caches the saved-search-filters actions for a host
 * component. The underlying module is dynamically imported on first use so
 * filter CRUD code stays out of the initial bundle.
 */
export function createSearchFilterController(ext: Browser, deps: SearchFilterControllerDeps) {
  let actions: SavedSearchFiltersActions | null = null;

  async function getActions(): Promise<SavedSearchFiltersActions> {
    if (!actions) {
      const { useSavedSearchFilters } = await import('./use-saved-search-filters.js');
      const created = useSavedSearchFilters(ext, deps.state, deps.setters);
      actions = created;
      return created;
    }
    return actions;
  }

  return {
    loadSavedSearchFilters: async () => {
      await (await getActions()).loadSavedSearchFilters();
    },
    saveFilter: async (input: SaveFilterInput) => {
      await (await getActions()).saveFilter(input);
    },
    renameFilter: async (id: string, name: string) => {
      await (await getActions()).renameFilter(id, name);
    },
    loadFilter: async (filter: import('@/utils/types.js').SavedSearchFilter) => {
      await (await getActions()).loadFilter(filter);
    },
    clearFilters: async () => {
      (await getActions()).clearFilters();
    },
    deleteFilter: async (id: string) => {
      await (await getActions()).deleteFilter(id);
    },
  };
}
