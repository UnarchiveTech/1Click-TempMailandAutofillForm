/**
 * Active Page Tabs Store.
 *
 * Allows any page rendering `<Tabs showInSidebar />` to automatically and
 * dynamically publish its tabs, active state, badges, and click handlers to the
 * sidebar navigation without any hardcoding in SidebarNav.
 */
import { writable } from 'svelte/store';
import type { KnownIconName } from '@/ui/components/icons/icon-names.js';

export interface TabItem {
  id: string;
  label: string;
  icon?: KnownIconName;
  subheading?: string;
  badge?: number | string | null;
}

export interface SidebarActiveTabsState {
  tabs: TabItem[];
  activeTab: string;
  onchange: (id: string) => void;
}

export const sidebarActiveTabsStore = writable<SidebarActiveTabsState | null>(null);
/** True only while the mounted, expanded sidebar exposes the current page's submenu. */
export const sidebarTabsVisible = writable(false);

let currentState: SidebarActiveTabsState | null = null;

function areTabsEqual(a: TabItem[], b: TabItem[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ta = a[i];
    const tb = b[i];
    if (
      ta?.id !== tb?.id ||
      ta?.label !== tb?.label ||
      ta?.badge !== tb?.badge ||
      ta?.icon !== tb?.icon ||
      ta?.subheading !== tb?.subheading
    ) {
      return false;
    }
  }
  return true;
}

export function setSidebarActiveTabs(state: SidebarActiveTabsState | null) {
  if (state === null && currentState === null) return;
  if (state === null) {
    currentState = null;
    sidebarActiveTabsStore.set(null);
    return;
  }
  if (
    currentState !== null &&
    currentState.activeTab === state.activeTab &&
    areTabsEqual(currentState.tabs, state.tabs)
  ) {
    if (currentState.onchange === state.onchange) return;
    // Closure-only update: publish a fresh object so subscribers (SidebarNav)
    // re-render and call the NEW onchange - in-place mutation without
    // store.set() leaves them invoking the stale closure.
    currentState = { ...currentState, onchange: state.onchange };
    sidebarActiveTabsStore.set(currentState);
    return;
  }
  currentState = state;
  sidebarActiveTabsStore.set(state);
}
