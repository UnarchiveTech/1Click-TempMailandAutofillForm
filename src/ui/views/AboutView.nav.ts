/**
 * Navbar flag - declares that the About view gets a slot in the floating
 * navbar / sidebar. The registry in src/utils/ui/nav-layout.ts collects these;
 * deleting this export removes the item from the navbar.
 */
import type { NavBarFlag } from '@/utils/ui/nav-layout.js';

export const navBarItem = {
  order: 8,
  key: 'about',
  view: 'about',
  labelKey: 'nav.about',
  iconName: 'info',
} as const satisfies NavBarFlag;
