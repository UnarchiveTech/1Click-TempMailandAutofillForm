/**
 * Single source of truth for Material Design 3 surface elevation levels.
 *
 * Maps MD3 elevation levels to the project's shadow utilities so overlay,
 * card, and control elevation can be re-levelled centrally instead of ad-hoc
 * `shadow-sm` / `shadow-md` / `shadow-lg` literals drifting across components.
 *
 *   level1 - `shadow-sm` - resting cards, chips, subtle raised surfaces
 *   level2 - `shadow-md` - menus, popovers, pickers, cards while raised
 *   level3 - `shadow-lg` - dialogs, sheets, FABs, prominent overlays
 */
export const ELEVATION = {
  level1: 'shadow-sm',
  level2: 'shadow-md',
  level3: 'shadow-lg',
} as const;
