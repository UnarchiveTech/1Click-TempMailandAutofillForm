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

/**
 * Resolve contextual primary action for the current view (matches Footer FAB).
 * Pass organizeTab when on Organize hub so Labels/Filters get the right CTA.
 */
export function fabKindForView(
  view: View,
  opts?: { organizeTab?: OrganizeTabKind }
): SidebarFabKind {
  switch (view) {
    case 'main':
    case 'mailSettings':
    case 'mailboxManagement':
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
    case 'loginInfo':
      return 'ghostLogin';
    case 'messageDetail':
      return 'ghostExpand';
    case 'settings':
    case 'about':
    case 'analytics':
    case 'emailDetail':
    case 'keybindings':
    case 'mailProvider':
    case 'constantsSettings':
    case 'diagnostics':
    case 'storagePerformance':
    case 'archivedEmails':
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
      return 'plus';
    default:
      return 'plus';
  }
}

export function fabLabelKeyForKind(kind: SidebarFabKind): string {
  switch (kind) {
    case 'refresh':
      return 'nav.fabRefresh';
    case 'createAddress':
      return 'nav.fabCreateAddress';
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
      return 'nav.fabCreateAddress';
  }
}
