/**
 * Shared floating detail-toolbar language (MailView · AddressView).
 *
 * MD3 rules applied here:
 * - Actions sit FLAT on the pill strip (no per-button elevation - the strip
 *   itself provides the surface + shadow).
 * - One shared type scale: 12px/600 labels (`text-xs font-semibold`) and
 *   16px icons (`w-4 h-4`) in both label and icon-only modes.
 * - Neutral actions use `on-surface-variant`, with the MD3 `secondary-container`
 *   state layer on hover (matches the floating footer nav).
 * - Destructive actions use the `error` role and stay error through hover.
 * Callers append exactly ONE tone constant per button (neutral / danger / a
 * state color) so no two `text-*` utilities ever compete on the same element.
 */

/** Structural button classes - shape, size, typography, press feedback. */
export function detailToolbarBtnClass(showLabels: boolean): string {
  return showLabels
    ? 'inline-flex items-center gap-1 h-8 px-2.5 shrink-0 rounded-full text-xs font-semibold whitespace-nowrap transition-[color,background-color,transform] motion-reduce:transition-none active:scale-95'
    : 'w-8 h-8 shrink-0 flex items-center justify-center rounded-full transition-[color,background-color,transform] motion-reduce:transition-none active:scale-95';
}

/** Neutral resting color + hover state layer (MD3 default toolbar action). */
export const DETAIL_TOOLBAR_TONE_NEUTRAL =
  'text-md-on-surface-variant hover:bg-md-secondary-container hover:text-md-on-secondary-container';

/** Destructive action tone - keeps the error tint through hover. */
export const DETAIL_TOOLBAR_TONE_DANGER = 'text-md-error hover:bg-md-error/15';

/** Accent action tone (e.g. Print) - primary color at rest with the standard hover layer. */
export const DETAIL_TOOLBAR_TONE_ACCENT =
  'text-md-primary hover:bg-md-secondary-container hover:text-md-on-secondary-container';

/** Floating pill strip container (surface, blur, shadow, border). */
export const DETAIL_TOOLBAR_STRIP =
  'pointer-events-auto flex flex-nowrap items-center gap-2 max-w-full bg-md-surface/95 backdrop-blur-sm rounded-full p-1 shadow-md border border-md-outline-variant/25';
