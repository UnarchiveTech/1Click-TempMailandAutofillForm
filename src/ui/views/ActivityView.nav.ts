/**
 * Navbar flag - declares that the Activity view gets a slot in the floating
 * navbar / sidebar. The registry in src/utils/ui/nav-layout.ts collects these;
 * deleting this export removes the item from the navbar.
 *
 * Note the key/view split: 'activity' is the canonical navbar key (and the id
 * stored in customNavOrder), while the rendered view is 'analytics'.
 */
import type { NavBarFlag } from '@/utils/ui/nav-layout.js';

export const navBarItem = {
  order: 6,
  key: 'activity',
  view: 'analytics',
  labelKey: 'nav.activity',
  iconName: 'analytics',
} as const satisfies NavBarFlag;
