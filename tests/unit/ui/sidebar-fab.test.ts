import { describe, expect, test } from 'bun:test';
import { isFabActionDisabled, type SidebarFabKind } from '@/utils/ui/sidebar-fab';

describe('contextual action availability', () => {
  const kinds: SidebarFabKind[] = [
    'refresh',
    'createAddress',
    'createIdentity',
    'createTag',
    'createLabel',
    'createFilter',
    'ghostLogin',
    'ghost',
    'ghostExpand',
    'none',
  ];
  for (const kind of kinds) {
    test(`${kind}: loading blocks only refresh, while none stays unavailable`, () => {
      expect(isFabActionDisabled(kind, true)).toBe(kind === 'refresh' || kind === 'none');
      expect(isFabActionDisabled(kind, false)).toBe(kind === 'none');
    });
  }
});
