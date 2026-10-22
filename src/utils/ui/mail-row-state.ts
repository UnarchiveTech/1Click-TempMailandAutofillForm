/**
 * The mailbox row's state - a thin, mailbox-specific vocabulary over the shared
 * row-surface contract (`src/utils/ui/row-surface.ts`, values in
 * `src/styles/row-surfaces.css`).
 *
 * This module used to own the fill, the edge and the ink itself, and the row
 * used to carry `ring-2 ring-md-secondary rounded-lg`, which never painted:
 * `.ring-2` is a NON-inset box-shadow and the row sits inside an
 * `overflow-hidden` swipe wrapper, so all four sides were clipped away. A
 * 60%-alpha wash is not a signal either - measured against the six themes in
 * `src/styles/theme.css`, a 60% `secondary-container` wash sits 1.12:1 from the
 * plain row in `light-standard` and 1.44:1 in `dark-standard`, the same distance
 * as an inactive row's hover wash (1.09 / 1.26), i.e. "selected" and "hovered"
 * were the same pixel.
 *
 * The states now come from the contract; what stays here is the mailbox's own
 * vocabulary - which state a row is in, the star's special case, and the ink
 * roles a mail row has (subject, sender, preview, meta, star).
 */

import {
  type RowSurfaceState,
  rowGlyphInk,
  rowInk,
  rowSurface,
  rowSurfaceState,
} from '@/utils/ui/row-surface.js';

/** Kept for callers that need the state name alone (the ink maps below). */
export type { RowSurfaceState };

/** Applied to a selected row; the rule itself lives in row-surfaces.css. */
export const MAIL_ROW_SELECTED_CLASS = 'row-surface-selected';

export interface MailRowSurfaceState {
  /** Ticked for a bulk action. */
  selected: boolean;
  /** The thread's open message (at most one row). */
  active: boolean;
  /** The row a search / deep link jumped to. */
  highlighted: boolean;
  unread: boolean;
}

/**
 * The row's surface classes. Precedence: selected > active > highlighted/unread
 * - the contract's own precedence, so the mailbox cannot disagree with the rest
 * of the app about what a row with two states on it looks like.
 *
 * `font-semibold` / the container ink follow the active row, so a row that is
 * both open and ticked keeps the weight it had. The row's hover and pressed
 * washes belong to `.row-surface` and are neutralised for a selected row by the
 * stylesheet, not by dropping anything here.
 */
export function mailRowSurfaceClass(state: MailRowSurfaceState): string {
  const surface = rowSurface(state);
  // `font-semibold` only: the ROW's ink belongs to the state, and the state's
  // ink is `--row-ink-primary` on the stylesheet (it has to follow the palette,
  // because the ticked fill is deepened in the standard palettes).
  return state.active || state.selected ? `${surface} font-semibold` : surface;
}

/** The state a mail row is in - the ink maps are keyed by this. */
export function mailRowState(state: MailRowSurfaceState): RowSurfaceState {
  return rowSurfaceState(state);
}

export type MailRowInkKind = 'subject' | 'sender' | 'preview' | 'meta' | 'star';

/** Map a mail row's line to the contract's ink role. */
const MAIL_ROW_INK_ROLE: Record<MailRowInkKind, 'primary' | 'meta' | 'icon'> = {
  subject: 'primary',
  sender: 'primary',
  preview: 'meta',
  meta: 'meta',
  star: 'icon',
};

/**
 * Ink on a selected mail row, read off the contract. Hierarchy comes from size
 * and weight - never from opacity on the important lines - because an alpha
 * multiplied over a `secondary-container` fill is exactly what made the old
 * tinted row look muddy.
 *
 * These are the sheet's `--row-ink-*` set, not a fixed role pair: the ticked
 * fill is deepened in the two `standard` palettes (its container there is
 * 1.22:1 - the same pixel as a hover), and the ink moves with it.
 */
export const SELECTED_ROW_INK: Record<MailRowInkKind, string> = Object.fromEntries(
  (Object.keys(MAIL_ROW_INK_ROLE) as MailRowInkKind[]).map((kind) => [
    kind,
    rowInk(MAIL_ROW_INK_ROLE[kind], 'selected'),
  ])
) as Record<MailRowInkKind, string>;

/** A starred row keeps its amber off a selected surface, and not on one. */
export const SELECTED_ROW_STARRED_INK = rowGlyphInk('selected', 'text-md-tertiary');

/**
 * An unstarred star on a RESTING row is a deliberately quiet affordance (it
 * appears on hover, and the star's place is known) - not a floor problem,
 * because nothing has to be legible against it. The floor applies on the
 * selected fill, which is what `rowGlyphInk` handles.
 */
export const MAIL_ROW_UNSTARRED_INK = 'text-md-on-surface/25';

/** The star button's ink - the one glyph whose colour depends on BOTH states. */
export function mailRowStarClass(state: { selected: boolean; starred: boolean }): string {
  const surface = rowSurfaceState({ selected: state.selected });
  return rowGlyphInk(surface, state.starred ? 'text-md-tertiary' : MAIL_ROW_UNSTARRED_INK);
}
