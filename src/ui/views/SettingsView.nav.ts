/**
 * Navbar flag - declares that the Settings view gets a slot in the floating
 * navbar / sidebar. The registry in src/utils/ui/nav-layout.ts collects these;
 * deleting this export removes the item from the navbar.
 */
import type { NavBarFlag } from '@/utils/ui/nav-layout.js';

export const navBarItem = {
  order: 7,
  key: 'settings',
  view: 'settings',
  labelKey: 'common.settings',
  iconName: 'settings',
} as const satisfies NavBarFlag;
