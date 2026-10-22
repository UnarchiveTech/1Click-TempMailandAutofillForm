/**
 * The row-surface contract - the single home of a list row's state.
 *
 * Every list row in the app (mailbox rows, address rows, identity rows, saved
 * logins, sidebar nav items, palette and menu results) states its state through
 * this module, and the values themselves live in
 * `src/styles/row-surfaces.css`. A view picks the STATE; it never picks a fill
 * alpha, a ring, or a hover wash.
 *
 * Why: `bun run audit-row-surfaces` measures every selection-conditional fill in
 * the app against the surface under it, and in the two `standard` themes the
 * whole surface family spans 1.23:1 / 1.98:1 against a 1.8:1 floor. So the fill
 * a state paints has to be chosen with the palette in mind, `ring-2` cannot be
 * used (it paints outside the border box and any clipping ancestor removes it -
 * the mailbox row lost all four sides of its ring that way), and two rows must
 * not express two different states with the same pixels. The contract's states
 * are distinguishable by construction, each as a FILL and nothing else:
 * `selected` is `secondary-container` (deepened in the standard palettes, with
 * the row's ink re-roled onto `--row-ink-*` to follow it), `active` is a `/60`
 * wash of it and always a step below, `highlighted` is a `primary/40` wash in a
 * different hue.
 *
 * The CSS is unlayered, so these classes out-rank any `bg-md-*` utility a view
 * also writes - which is what fixed the identity row, whose selected fill had
 * silently lost to a static `bg-md-tertiary-container`.
 */

/** The four surfaces a row can be in, in precedence order. */
export type RowSurfaceState = 'selected' | 'active' | 'highlighted' | 'unread' | 'plain';

/** Which states a row is in. At most one surface class is emitted. */
export interface RowSurfaceInput {
  /** Ticked for a bulk action. */
  selected?: boolean;
  /** The open / current row: the nav item you are on, the result the keyboard
   *  sits on, the thread whose message is open. */
  active?: boolean;
  /** The row a search or a deep link jumped to. */
  highlighted?: boolean;
  /**
   * Unread mail. A MODIFIER, not a selection: it is the quietest state and it
   * never competes with one, because a ticked or open row out-ranks it.
   */
  unread?: boolean;
}

/** The resting class: the row's hover and pressed wash. Always applied. */
export const ROW_SURFACE_CLASS = 'row-surface';

/** The state classes, one per state, defined in `src/styles/row-surfaces.css`. */
export const ROW_SURFACE_STATE_CLASS: Record<RowSurfaceState, string> = {
  selected: 'row-surface-selected',
  active: 'row-surface-active',
  highlighted: 'row-surface-highlighted',
  unread: 'row-surface-unread',
  plain: '',
};

/** The state a row is in - precedence: selected > active > highlighted > unread. */
export function rowSurfaceState(state: RowSurfaceInput = {}): RowSurfaceState {
  if (state.selected) return 'selected';
  if (state.active) return 'active';
  if (state.highlighted) return 'highlighted';
  if (state.unread) return 'unread';
  return 'plain';
}

/**
 * The classes for a row's surface: the resting class plus, at most, one state
 * class. Every row takes this (`class="… {rowSurface({ … })}"`), and no view adds
 * a state fill of its own next to it.
 */
export function rowSurface(state: RowSurfaceInput = {}): string {
  const className = ROW_SURFACE_STATE_CLASS[rowSurfaceState(state)];
  return className ? `${ROW_SURFACE_CLASS} ${className}` : ROW_SURFACE_CLASS;
}

/** The roles a row's text plays, so one row cannot ink two lines the same. */
export type RowInkRole = 'primary' | 'meta' | 'icon';

/**
 * Ink on a SELECTED row. Hierarchy comes from size and weight, never from
 * opacity on the important lines: an alpha multiplied over a
 * `secondary-container` fill is what made the old tinted row look muddy
 * (`on-surface/50` measured 2.23:1…3.74:1). These are measured instead -
 * `on-secondary-container` itself is 5.2:1…11.1:1, `/85` is 4.3:1…8.5:1, and
 * `/70` (the icon floor, 3:1) is 3.4:1…5.5:1 across the six themes.
 *
 * The classes name the sheet's `--row-ink-*` set rather than a fixed role,
 * because THE FILL IS PALETTE-DEPENDENT: in the two `standard` palettes the
 * ticked fill is deepened toward its own ink (the container otherwise measures
 * 1.22:1 - the same pixel as a hover), and on that deeper fill the container's
 * ink falls to 4.4:1, under the 4.5:1 body-text floor, while the palette's
 * `on-surface` measures 6.85:1. The sheet picks the ink; a view cannot know the
 * palette, so it must not name a role.
 */
export const ROW_INK_SELECTED: Record<RowInkRole, string> = {
  primary: 'text-(--row-ink-primary)',
  meta: 'text-(--row-ink-meta)',
  icon: 'text-(--row-ink-icon)',
};

/** Ink on a resting row - the app's normal hierarchy. */
export const ROW_INK_PLAIN: Record<RowInkRole, string> = {
  primary: 'text-md-on-surface',
  meta: 'text-md-on-surface/60',
  icon: 'text-md-on-surface/40',
};

/** Ink for one line of a row, per its surface state. */
export function rowInk(role: RowInkRole, state: RowSurfaceState): string {
  return state === 'selected' ? ROW_INK_SELECTED[role] : ROW_INK_PLAIN[role];
}

/**
 * A coloured glyph on a row (the amber star) keeps its colour only off a
 * selected surface: the amber star is 1.5:1…2.3:1 against the
 * `secondary-container` fill in the `-medium` / `-high` themes, so on a selected
 * row the filled glyph SHAPE carries "starred" and the ink stays legible.
 */
export function rowGlyphInk(state: RowSurfaceState, coloured: string): string {
  return state === 'selected' ? ROW_INK_SELECTED.icon : coloured;
}

/**
 * The classes for a selected CONTROL - a filter chip, a filter or view toggle,
 * a chooser row: `controlSurface(cond)`.
 *
 * A control is applied or it is not, and the applied form is a solid accent
 * role (`.control-surface-selected`, values in `src/styles/row-surfaces.css`),
 * so no hover can out-paint it. Before this existed, the idle hover
 * (`bg-md-surface-variant`, 1.23:1 in `light-standard`) and the applied form
 * (`bg-md-primary/10`, **1.15:1**) sat on opposite sides of the same threshold:
 * hovering an unapplied filter painted a stronger fill than applying it.
 *
 * The resting classes stay on the element and the contract overrides them when
 * selected - the CSS is unlayered, so a view writes its own `bg-*`/`text-*`
 * once and never an arm pair of its own:
 *
 *   class="… border border-md-outline-variant text-md-on-surface/60
 *          {controlSurface(filterActive)}"
 *
 * Sites whose flag is not selection-named (`sortBy !== 'newest'`, `otpOnly`)
 * belong here too: the state is what matters, not the variable's name.
 */
export function controlSurface(selected: unknown, shape: ControlShape = 'fill'): string {
  if (!selected) return 'control-surface';
  if (shape === 'underline') return 'control-surface control-underline-selected';
  if (shape === 'border') return 'control-surface control-border-selected';
  return 'control-surface control-surface-selected';
}

/**
 * The three shapes an applied control takes, all in `src/styles/row-surfaces.css`
 * and all measured by `tests/unit/utils/row-surface.test.ts`:
 *
 * - `fill` - a filled segment: a chip, a toggle, a chooser row.
 * - `underline` - a tab in a strip whose container is already a surface, where a
 *   filled segment would restyle the strip.
 * - `border` - a control whose own box holds content a fill would swallow (the
 *   credentials domain's select-all disc holds a favicon), so the state is the
 *   border in the accent role instead.
 *
 * The shape decides WHERE the state is painted, never which state it is: all
 * three are excluded from the idle hover whisper, so an applied control cannot
 * be repainted by its own hover or press whichever shape it takes.
 */
export type ControlShape = 'fill' | 'underline' | 'border';

/**
 * The ink a selected control's LABEL takes when the label is a child element
 * (a table cell, say) rather than the control itself: the contract's `color`
 * cannot reach a child that carries its own `text-*` utility.
 */
export const CONTROL_INK_SELECTED = 'text-md-on-primary';
