/**
 * Dynamic View Header Store.
 *
 * Allows any sub-page or view to declaratively configure its header title,
 * subtitle, custom back handler, or action buttons when active.
 */
import { writable } from 'svelte/store';
import type { KnownIconName } from '@/ui/components/icons/icon-names.js';

export interface ViewHeaderState {
  title?: string;
  titleKey?: string;
  subtitle?: string;
  subtitleKey?: string;
  /** Material icon shown before the title in sub-navigation header chrome. */
  icon?: KnownIconName;
  showBack?: boolean;
  onBack?: () => void;
}

export const activeViewHeaderStore = writable<ViewHeaderState | null>(null);

let currentHeader: ViewHeaderState | null = null;

export function setActiveViewHeader(header: ViewHeaderState | null) {
  if (header === null && currentHeader === null) return;
  if (header === null) {
    currentHeader = null;
    activeViewHeaderStore.set(null);
    return;
  }
  if (
    currentHeader !== null &&
    currentHeader.title === header.title &&
    currentHeader.titleKey === header.titleKey &&
    currentHeader.subtitle === header.subtitle &&
    currentHeader.subtitleKey === header.subtitleKey &&
    currentHeader.icon === header.icon &&
    currentHeader.showBack === header.showBack
  ) {
    // Closure-only update (e.g. a re-render passed a new onBack): publish a
    // fresh object so subscribers (Header.svelte) re-render and call the NEW
    // handler - mutating in place without store.set() would leave the UI
    // invoking the stale closure captured by the previous publish.
    currentHeader = { ...currentHeader, onBack: header.onBack };
    activeViewHeaderStore.set(currentHeader);
    return;
  }
  currentHeader = header;
  activeViewHeaderStore.set(header);
}
