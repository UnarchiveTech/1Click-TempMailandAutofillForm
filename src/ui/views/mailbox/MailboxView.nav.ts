/**
 * Navbar flag - declares that the Mailbox view gets a slot in the floating
 * navbar / sidebar. The registry in src/utils/ui/nav-layout.ts collects these;
 * deleting this export removes the item from the navbar.
 */
import type { NavBarFlag } from '@/utils/ui/nav-layout.js';

export const navBarItem = {
  order: 1,
  key: 'mailbox',
  view: 'mailbox',
  labelKey: 'nav.mailbox',
  iconName: 'inbox',
} as const satisfies NavBarFlag;
