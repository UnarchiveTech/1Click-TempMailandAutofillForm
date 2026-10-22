/**
 * Dynamic Floating Action Button (FAB) Store.
 *
 * Allows any active page/view or tab to declaratively publish its contextual
 * Primary Call-to-Action (CTA) button, icon, label, and direct click callback
 * to the floating Footer FAB and Sidebar create button.
 */
import { writable } from 'svelte/store';
import type { KnownIconName } from '@/ui/components/icons/icon-names.js';
import type { SidebarFabKind } from '@/utils/ui/sidebar-fab.js';

export interface FloatingActionDescriptor {
  kind?: SidebarFabKind;
  icon?: KnownIconName;
  labelKey?: string;
  label?: string;
  onclick: () => void;
}

export const activeFabActionStore = writable<FloatingActionDescriptor | null>(null);

let currentFab: FloatingActionDescriptor | null = null;

export function setActiveFabAction(action: FloatingActionDescriptor | null) {
  if (action === null && currentFab === null) return;
  if (action === null) {
    currentFab = null;
    activeFabActionStore.set(null);
    return;
  }
  if (
    currentFab !== null &&
    currentFab.kind === action.kind &&
    currentFab.icon === action.icon &&
    currentFab.labelKey === action.labelKey &&
    currentFab.label === action.label
  ) {
    // Closure-only update: publish a fresh object so subscribers (FAB /
    // SidebarNav) pick up the new onclick - in-place mutation without
    // store.set() leaves them invoking the stale closure.
    currentFab = { ...currentFab, onclick: action.onclick };
    activeFabActionStore.set(currentFab);
    return;
  }
  currentFab = action;
  activeFabActionStore.set(action);
}
