import type { View } from '@/features/types/view-types.js';

/** Primary CTA kind shown in floating footer FAB / sidebar create button */
export type SidebarFabKind =
  | 'refresh'
  | 'createAddress'
  | 'createIdentity'
  | 'createTag'
  | 'createLabel'
  | 'createFilter'
  | 'ghostLogin'
  | 'ghost'
  | 'ghostExpand'
  | 'none';

export type OrganizeTabKind = 'tags' | 'labels' | 'filters';

/** Mail loading blocks refresh only; unrelated visible actions remain usable. */
export function isFabActionDisabled(kind: SidebarFabKind, loading: boolean): boolean {
  return kind === 'none' || (loading && kind === 'refresh');
}

/**
 * Resolve contextual primary action for the current view (matches Footer FAB).
 * Pass organizeTab when on Organize hub so Labels/Filters get the right CTA.
 */
export function fabKindForView(
  view: View,
  opts?: { organizeTab?: OrganizeTabKind }
): SidebarFabKind {
  switch (view) {
    case 'mailbox':
    case 'addresses':
      return 'createAddress';
    case 'identities':
    case 'autofill':
      return 'createIdentity';
    case 'organize': {
      const tab = opts?.organizeTab ?? 'tags';
      if (tab === 'labels') return 'createLabel';
      if (tab === 'filters') return 'createFilter';
      return 'createTag';
    }
    case 'tagManagement':
      return 'createTag';
    case 'labelManagement':
      return 'createLabel';
    case 'filtersManagement':
      return 'createFilter';
    case 'automation':
      return 'ghost';
    case 'loginInfo':
      return 'ghostLogin';
    case 'mailView':
      return 'ghostExpand';
    case 'settings':
    case 'about':
    case 'analytics':
    case 'addressView':
    case 'keybindings':
    case 'mailProvider':
    case 'constantsSettings':
    case 'diagnostics':
    case 'storagePerformance':
      return 'ghost';
    default:
      return 'ghost';
  }
}

export function fabIconForKind(kind: SidebarFabKind): string {
  switch (kind) {
    case 'refresh':
      return 'refresh';
    case 'ghostLogin':
      return 'lock';
    case 'ghostExpand':
      return 'expand';
    case 'ghost':
      return 'chevronUp';
    case 'none':
      return 'add';
    default:
      return 'add';
  }
}

export function fabLabelKeyForKind(kind: SidebarFabKind): string {
  switch (kind) {
    case 'refresh':
      return 'nav.fabRefresh';
    case 'createAddress':
      return 'address.newMailAddress';
    case 'createIdentity':
      return 'nav.fabCreateIdentity';
    case 'createTag':
      return 'nav.fabCreateTag';
    case 'createLabel':
      return 'nav.fabCreateLabel';
    case 'createFilter':
      return 'nav.fabCreateFilter';
    case 'ghostLogin':
      return 'nav.fabSavedLogins';
    case 'ghostExpand':
      return 'inbox.emailActions.expandView';
    case 'ghost':
      return 'nav.fabScrollTop';
    default:
      return 'address.newMailAddress';
  }
}
