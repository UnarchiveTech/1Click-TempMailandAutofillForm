/**
 * The multi-select contract every list publishes, and the one strip that drives
 * them all.
 *
 * A list owns its selection (rows, long-press, marquee, its own strip used to),
 * but the same handful of parties want to drive it: the shell's selection strip,
 * the sidebar's drag-onto-folder/label targets, the keyboard bindings, and the
 * view's own header. So each list publishes ONE `SelectionApi` plus the facts the
 * strip renders from, and every one of those parties goes through it rather than
 * reaching into a view.
 *
 * ONE declaration on purpose. This shape had drifted into three type declarations
 * (AppShell, MailboxSplitView, MailboxView) and five placeholder literals (a
 * module const, two `$bindable` defaults, a second internal mirror in MailboxView
 * and AppLayout's `$state`), which is a silent trap: a method added to the copy
 * the caller happens to see type-checks, and the copy the callee implements never
 * learns about it - the call is simply undefined at runtime. `applyLabel` had
 * already picked up two parameter spellings, and the placeholders disagreed on
 * `async` vs not.
 *
 * `SelectionApi.run(action)` is a CLOSED vocabulary rather than one method per
 * verb, which is what lets a single strip render four different lists: the strip
 * draws `state.actions` through `SELECTION_ACTION_META` and calls `run(id)`, so a
 * new action is one union member, one metadata row, and one `case` in the lists
 * that offer it - never a new prop, a new branch per list, or a second strip.
 */

import type { KnownIconName } from '@/ui/components/icons/icon-names.js';

/** The surface a published selection belongs to (the registry keys by this). */
export type SelectionSurface = 'mailbox' | 'addresses' | 'identities' | 'logins';

/**
 * Every bulk action any list can offer. The strip renders these in the order the
 * list declares them; a list advertises a subset (the inbox archive+delete+star+
 * label, the addresses list archive/unarchive+delete+tag+export+read-state, …).
 */
export type SelectionActionId =
  | 'restore'
  | 'unarchive'
  | 'archive'
  | 'star'
  | 'tag'
  | 'duplicate'
  | 'export'
  | 'markRead'
  | 'markUnread'
  | 'delete';

/** How the shared strip paints and labels one action. */
export interface SelectionActionMeta {
  /** Icon name from the shared catalog. */
  icon: KnownIconName;
  /** Existing locale key for the button face (never a new one per list). */
  labelKey: string;
  /** A longer hint where the face is terse (`Star` → "Star selected"). */
  titleKey?: string;
  /** Button treatment, from the same `btn-*` vocabulary the strips already used. */
  variant: 'primary' | 'secondary' | 'tertiary' | 'error';
  /** Drag-onto-action target token, so dropping a selection on it still works. */
  dropAction: string;
  /**
   * What a drop onto this action means, for the drag cursor. `move` for actions
   * that relocate the selection (archive, delete), `copy` for the ones that only
   * read it (tag, export, mark read/unread).
   */
  dropEffect: 'move' | 'copy';
}

/**
 * One row per action: the strip's label, icon, treatment and drop target.
 * The keys are all pre-existing - this table must never be the reason a locale
 * file changes.
 */
export const SELECTION_ACTION_META: Record<SelectionActionId, SelectionActionMeta> = {
  restore: {
    icon: 'refresh',
    labelKey: 'common.restore',
    variant: 'tertiary',
    dropAction: 'restore',
    dropEffect: 'move',
  },
  unarchive: {
    icon: 'archive',
    labelKey: 'common.unarchive',
    variant: 'tertiary',
    dropAction: 'unarchive',
    dropEffect: 'move',
  },
  archive: {
    icon: 'archive',
    labelKey: 'common.archive',
    variant: 'tertiary',
    dropAction: 'archive',
    dropEffect: 'move',
  },
  star: {
    icon: 'star',
    labelKey: 'inbox.emailActions.star',
    titleKey: 'inbox.emailActions.starSelected',
    variant: 'secondary',
    dropAction: 'star',
    dropEffect: 'move',
  },
  tag: {
    icon: 'tag',
    labelKey: 'inbox.emailActions.label',
    titleKey: 'inbox.emailActions.labelSelected',
    variant: 'primary',
    dropAction: 'tag',
    dropEffect: 'copy',
  },
  duplicate: {
    icon: 'contentCopy',
    labelKey: 'common.duplicate',
    variant: 'primary',
    dropAction: 'duplicate',
    dropEffect: 'copy',
  },
  export: {
    icon: 'download',
    labelKey: 'address.exportSelected',
    variant: 'secondary',
    dropAction: 'export',
    dropEffect: 'copy',
  },
  markRead: {
    icon: 'mail',
    labelKey: 'address.markAllRead',
    variant: 'tertiary',
    dropAction: 'mark-read',
    dropEffect: 'copy',
  },
  markUnread: {
    icon: 'mail',
    labelKey: 'address.markAllUnread',
    variant: 'tertiary',
    dropAction: 'mark-unread',
    dropEffect: 'copy',
  },
  delete: {
    icon: 'delete',
    labelKey: 'common.delete',
    variant: 'error',
    dropAction: 'delete',
    dropEffect: 'move',
  },
};

/** `btn-*` treatment per variant (the vocabulary the strips already used). */
export const SELECTION_ACTION_CLASS: Record<SelectionActionMeta['variant'], string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  tertiary: 'btn-tertiary',
  error: 'btn-error',
};

/**
 * What every list exposes. `cancel`/`selectAll`/`deselectAll` are the three
 * verbs the strip, Escape and the keyboard all share; `run` dispatches the
 * list's own bulk actions; `applyTag` exists only where tags do (the sidebar
 * drag path hands over a tag by name rather than opening a dialog).
 *
 * The three `Focus`-named verbs are the KEYBOARD's way in, and they are
 * required rather than optional on purpose: multi-select used to be reachable
 * only by pointer (hold, marquee, a row's disc, the context menu) plus an
 * always-visible Select row that has since been retired, so a list that forgot
 * to implement them would be a list the keyboard cannot select in at all - and
 * an optional method that is silently absent is exactly the failure mode this
 * contract exists to prevent. They are also deliberately state-free: the cursor
 * is where DOM focus is (see `selection-row-cursor.ts`), so a list answers
 * "which row am I on" from `document.activeElement` and owns no second copy of
 * "where the keyboard is".
 */
export interface SelectionApi {
  /** Drop the selection without running an action (Escape, mailbox switch). */
  cancel: () => void;
  selectAll: () => void;
  deselectAll: () => void;
  /** Run one of the actions this list advertises in `state.actions`. */
  run: (action: SelectionActionId) => void | Promise<void>;
  /** Apply a named tag to the selection (tag-capable lists only). */
  applyTag?: (tag: string) => void | Promise<void>;
  /** Move the row cursor by `delta` (`-1` up, `1` down), clamped to the list. */
  moveFocus: (delta: -1 | 1) => void | Promise<void>;
  /**
   * Is the row cursor inside THIS list? The keyboard layer asks every published
   * list this question before choosing which one a keystroke belongs to, so a
   * second list being mounted (a split view mid-transition) cannot answer for
   * the list the user is actually standing in.
   */
  hasFocusedRow: () => boolean;
  /** Is the row under the cursor already ticked? */
  focusedIsSelected: () => boolean;
  /** Tick or untick the row under the cursor (idempotent, unlike a toggle). */
  setFocusedSelected: (selected: boolean) => void;
}

/**
 * What a list publishes about the selection it owns, so the SHELL can render the
 * one selection strip.
 *
 * The strip lives at shell level on purpose: inside a list it is clipped to the
 * list pane, so in split view (list + detail side by side) it is cramped to one
 * pane and cannot span the shell. The list therefore publishes the facts the
 * strip renders from and keeps owning the selection itself.
 */
export interface ListSelectionState {
  /** The strip is showing: at least one row is ticked. */
  active: boolean;
  count: number;
  /**
   * The actions THIS list offers, in the order the strip must show them. The
   * folder/tab decides it (inbox archives, Archived restores), and only the list
   * knows that - so the strip renders what it is told rather than guessing.
   */
  actions: readonly SelectionActionId[];
  /** Every row matching the current filters is already selected. */
  allMatched: boolean;
  /** How many rows match the filters (the select-all universe). */
  matchingTotal: number;
  /** False while a cross-mailbox search is active, when the universe is unknown. */
  universeCounted: boolean;
}

/**
 * A fresh inert state, for a `$bindable` default or a pre-mount stand-in.
 *
 * It MUST be a factory rather than a shared constant: a list mutates the state it
 * publishes in place, so one shared instance would show one list's selection in
 * every holder.
 */
export function createListSelectionState(
  actions: readonly SelectionActionId[] = []
): ListSelectionState {
  return {
    active: false,
    count: 0,
    actions,
    allMatched: false,
    matchingTotal: 0,
    universeCounted: false,
  };
}

/**
 * A fresh inert API. Same factory rule as the state: the object a list publishes
 * is mutated in place (`Object.assign`) once its list mounts, so a shared
 * constant would let whichever list wired last blank out every other holder - and
 * hide it, because the stub methods are valid no-ops either way.
 */
export function createSelectionApi(): SelectionApi {
  return {
    cancel: () => {},
    selectAll: () => {},
    deselectAll: () => {},
    run: () => {},
    moveFocus: () => {},
    hasFocusedRow: () => false,
    focusedIsSelected: () => false,
    setFocusedSelected: () => {},
  };
}
