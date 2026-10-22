/**
 * Shared responsive width breakpoints - single source of truth for the
 * layout and nav ladders.
 *
 * Layout ladder (container width, sidepanel/app only - popup is always
 * excluded from wide/split):
 *   ≥ LAYOUT_WIDE_MIN  → sidebar + content row (flex-row)
 *   ≥ LAYOUT_SPLIT_MIN → true 3-column split (sidebar | list | detail)
 *   800-1280           → vertical split (list above detail)
 *
 * Nav ladder (navShellWidth, all contexts including popup):
 *   ≥ NAV_SEVEN_MIN            → all 8 pages primary
 *   ≥ NAV_SIX_MIN              → 5 primary + More
 *   ≥ NAV_PLUS_ORGANIZE_MIN    → 4 primary + More
 *   < NAV_PLUS_ORGANIZE_MIN    → 3 primary + More
 */

/** Sidebar appears at/above this container width (sidepanel/app only). */
export const LAYOUT_WIDE_MIN = 800;
/** True list|detail horizontal split at/above this width. */
export const LAYOUT_SPLIT_MIN = 1280;
/** Nav stage `seven`: all pages in the primary nav. */
export const NAV_SEVEN_MIN = 520;
/** Nav stage `six`: 5 primary items + More. */
export const NAV_SIX_MIN = 440;
/** Nav stage `plus_organize`: 4 primary items + More. */
export const NAV_PLUS_ORGANIZE_MIN = 400;

/**
 * Fallback container width used when an element's clientWidth can't be
 * measured yet (e.g. `parent?.clientWidth || 1280`). Kept at the split
 * threshold so clamping math never assumes a container smaller than the
 * widest layout mode.
 */
export const DEFAULT_CONTAINER_WIDTH = LAYOUT_SPLIT_MIN;
