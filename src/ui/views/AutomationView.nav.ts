/**
 * Navbar flag - declares that the Automation view gets a slot in the floating
 * navbar / sidebar. The registry in src/utils/ui/nav-layout.ts collects these;
 * deleting this export removes the item from the navbar.
 */
import type { NavBarFlag } from '@/utils/ui/nav-layout.js';

export const navBarItem = {
  order: 5,
  key: 'automation',
  view: 'automation',
  labelKey: 'nav.automation',
  iconName: 'automation',
} as const satisfies NavBarFlag;
