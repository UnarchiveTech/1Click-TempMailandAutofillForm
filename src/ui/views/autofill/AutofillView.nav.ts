/**
 * Navbar flag - declares that the Autofill view gets a slot in the floating
 * navbar / sidebar. The registry in src/utils/ui/nav-layout.ts collects these;
 * deleting this export removes the item from the navbar.
 */
import type { NavBarFlag } from '@/utils/ui/nav-layout.js';

export const navBarItem = {
  order: 3,
  key: 'autofill',
  view: 'autofill',
  labelKey: 'nav.autofill',
  iconName: 'editSquare',
} as const satisfies NavBarFlag;
