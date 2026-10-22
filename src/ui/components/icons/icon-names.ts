/**
 * The icon-name vocabulary: every name `<Icon name="…">` accepts.
 *
 * This list lives in a plain `.ts` module rather than in the component, and the
 * reason is mechanical: a `.ts` file CANNOT import a type out of a `.svelte`
 * file. `tsc --noEmit -p ./tsconfig.ts-only.json` (the second half of
 * `bun run typecheck`) resolves `*.svelte` to an empty ambient module, so
 * `import type { KnownIconName } from '@/ui/components/icons/Icon.svelte'`
 * fails there with TS2614 - "Module '*.svelte' has no exported member
 * 'KnownIconName'" - even though `svelte-check`, which generates real types,
 * accepts it. A vocabulary that only the first of the two passes can see is a
 * vocabulary no shared table can be typed against.
 *
 * Why that matters: `bun run check-icon-references` matches a literal in a
 * translation-key-like position, so it sees an `<Icon name="typo">` in the
 * view that renders it, but it cannot follow `name={table.icon}` across a
 * module boundary. Typing such a table's field as `KnownIconName` moves that
 * check to the compiler, which does follow it. Icon.svelte imports this type
 * for its own `name` prop, so the component and the tables are typed from the
 * same declaration and cannot drift.
 *
 * The PATHS stay in Icon.svelte (its `ICONS` map): this module owns only the
 * vocabulary. Adding a glyph is therefore two edits - the name here, the
 * geometry there - and `tests/unit/components/icons/icon-catalog.test.ts`
 * fails if a name here has no geometry, or geometry exists that no name
 * admits to (`starOutline` excepted: it is the FILL0 half of `star`, swapped
 * in by the component rather than named by a call site).
 *
 * Order is cosmetic (the union is a set); it is grouped roughly by subject to
 * keep the diff of a new glyph local.
 */
export const KNOWN_ICON_NAMES = [
  // Shell + views
  'analytics',
  'archive',
  'automation',
  'autoRenew', // legacy alias: also a settings/storage key (upstream: autorenew)
  'barChart',
  'notifications',
  'notificationsOff',
  'check',
  'checkCircle',
  'checkBox',
  'checkBoxOutlineBlank',
  'schedule',
  'localActivity',
  'contentCopy',
  'database',
  'download',
  'upload',
  'downloadForOffline',
  'edit',
  'editSquare',
  'expand',
  'openInNew',
  'filter',
  'localFireDepartment',
  'forward',
  'globe',
  'github',
  'gridView',
  'dragHandle',
  'moreVert',
  'mic',
  // Browsers (hand-drawn brand marks, not Material Symbols)
  'chrome',
  'firefox',
  'edge',
  'safari',
  // Mail + identity
  'key',
  'inbox',
  'allInbox',
  'moreHoriz',
  'contactPage',
  'info',
  'layers',
  'link',
  'lock',
  'mail',
  'mark_email_read',
  'mark_email_unread',
  'person',
  'print',
  'monitor',
  'darkMode',
  'add',
  'qrCode2',
  'radioButtonChecked',
  'radioButtonUnchecked',
  'refresh',
  'search',
  'settings',
  'shield',
  'star',
  'lightMode',
  'tag',
  'threads',
  'delete',
  'unarchive',
  'warning',
  'wifiOff',
  'cloudOff',
  'keep',
  'keepOff',
  'close',
  // Added for references that previously rendered nothing (the
  // scripts/baselines/icon-reference.txt ledger): the password reveal/conceal pair, the
  // Markdown download row, and the HTML-rendering rows in Settings.
  'visibility',
  'visibilityOff',
  'description',
  'image',
  'code',
  'headphones',
  'videocam',
  'box',
  // One shared chevron path, rotated per direction (see CHEVRON_DIR).
  'chevron',
  'chevronDown',
  'chevronUp',
  'chevronLeft',
  'chevronRight',
  'back',
] as const;

/**
 * Every glyph name the catalog defines. Assigning a name outside this union to
 * an `icon` / `iconName` / `name` field is a compile error - which is the only
 * check that reaches a shared metadata table.
 */
export type KnownIconName = (typeof KNOWN_ICON_NAMES)[number];
