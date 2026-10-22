/**
 * shared-vocabularies.ts - the app's shared string vocabularies, and the rule
 * that keeps the COMPILER their gate.
 *
 * WHY THIS FILE EXISTS. A shared vocabulary - a closed set of tokens that
 * several features agree on (icon names, view ids, …) - is declared once as a
 * union type, and the union is what makes a typo a compile error. The rule only
 * holds, though, for the declarations that NAME the union: any carrier written
 * as `string` (`{ view: string }`, `Record<string, …>`, `(view: string) =>`)
 * silently accepts a token the vocabulary does not have, and nothing catches it:
 * there is no runtime error, and a lookup miss renders as an empty cell, an
 * invisible glyph, or a blank pane.
 *
 * That is exactly how the icon catalog rename shipped five blank icons
 * (`trash` → `delete`, `bell` → `notifications`, `x` → `close`, `plus` → `add`,
 * `copy` → `contentCopy`) with no gate turning red - and why
 * `scripts/check-icon-references.ts` grew a field rule ("an icon field must be
 * declared `KnownIconName`") in the first place.
 *
 * This module GENERALIZES that rule. Instead of one gate hard-wiring the icon
 * field-name pattern and its exception list, every shared vocabulary is
 * registered here - its union type, its module, the field names that carry it,
 * the tokens that defeat the compiler, and the runtime validator its module
 * exports for untrusted input - and `scripts/check-vocabulary-fields.ts` enforces
 * the rule for ALL of them in one pass. Adding a vocabulary to the registry is
 * therefore a one-entry change, and no gate needs to learn a new name pattern to
 * cover it.
 *
 * THE TWO HALVES THE GATE ENFORCES
 *
 *   1. A CARRIER MUST NAME THE UNION. A field, prop, or parameter that carries a
 *      vocabulary token (`view`, `viewId`, `nextView`, `pageIcon`, …) must be
 *      declared with the vocabulary's union type - never `string`, never the
 *      open union a component's own deliberately-open prop uses. `string` is
 *      precisely what the compiler cannot check, so `{ view: string }` in a
 *      metadata table hands the compiler nothing to follow, while
 *      `{ view: View }` makes every value in that table - and every future one -
 *      a compile error when it is wrong.
 *
 *   2. A TABLE KEYED BY A VOCABULARY MUST SAY SO. A lookup table whose keys are
 *      demonstrably the vocabulary's tokens (`VIEW_LABEL_KEYS`, whose keys are
 *      view ids) must declare the key type (`Record<View, …>`, or
 *      `Record<Verdict | SomethingElse, …>`), not `Record<string, …>`. The
 *      annotation is the difference between "a missing or misspelled key is a
 *      compile error" and "a missing key is `undefined` at runtime" - the icon
 *      gate's own founding failure, in map form.
 *
 * WHAT IT DELIBERATELY DOES NOT COVER. Two neighbours that look similar and are
 * not this rule:
 *
 *   - **A trust boundary.** A payload read from storage, a URL param, or a
 *     message is a `string` until the vocabulary's validator (`isView`,
 *     `isAvatarTier`) narrows it - typing it `View` would be a lie the compiler
 *     happily accepts. Those declarations are named in
 *     `VOCABULARY_FIELD_EXCEPTIONS` with the reason, so the exception is visible
 *     beside the rule it carves out.
 *   - **A dynamically-keyed vocabulary.** Provider ids come from
 *     `providers.jsonc` at runtime, and `status` / `kind` / `mode` name a
 *     different set in every feature (an HTTP status, a DNS record type, an
 *     autofill step). Those fields are `string` because their vocabulary is not
 *     closed in the source at all, so they get no registry entry - a rule that
 *     guessed at them would be muted within a week.
 *
 * WHAT IS NOT REGISTERED YET (the neighbours that were measured, and why each
 * is a different task - an entry is cheap, so the cost of adding one is the
 * CONVERSIONS it demands, not the registry line):
 *
 *   - **`themeMode` / `ContrastLevel`** (`src/features/theme/theme-actions.ts`,
 *     3 tokens each). Their two `themeMode?: string` carriers are STORAGE READ
 *     SHAPES (`use-theme.svelte.ts`), so typing them `ThemeMode` would be the
 *     lie the trust-boundary rule exists to prevent; both need the
 *     `isThemeMode`-style narrowing the icon/view vocabularies already have
 *     before an entry would be honest. No table in `src` is keyed by them today.
 *   - **`AvatarTier`** (`src/utils/ui/avatar-size.ts`). Closed, with
 *     `isAvatarTier` - but it is DERIVED from the table's own keys
 *     (`keyof typeof AVATAR_TIERS`), so the "a table keyed by the vocabulary
 *     must name its key type" half would ask the union to type the very
 *     declaration it is made of, and the field name is not exclusive either:
 *     `EscapeTier` and `ActionBtnTier` are different closed sets that share the
 *     word `tier`.
 */

/** A closed set of string tokens several features agree on. */
export interface SharedVocabulary {
  /** Short id, as it appears in findings and exception rows (`icon`, `view`). */
  id: string;
  /** The union type that makes the compiler the gate. */
  type: string;
  /** The module that declares it (repo-relative, for the finding's hint). */
  module: string;
  /**
   * The `as const` array (or arrays - a union of two families names both) in
   * that module whose members the union is made of. Read to decide whether a
   * lookup table is keyed by this vocabulary.
   */
  membersArray: string | readonly string[];
  /**
   * The declaration names that carry a token of this vocabulary: fields, props,
   * parameters, and the same shapes nested in an object type literal. Anchored,
   * so a NEIGHBOUR that happens to end in the same word is not swept in - see
   * each entry's note about what it deliberately leaves out.
   */
  field: RegExp;
  /**
   * The names of what this field rule deliberately leaves out, spelled in the
   * finding's advice so a reader can tell a designed exclusion from a miss.
   */
  fieldExclusions: string;
  /**
   * Declared types that leave the compiler nothing to check BEYOND `string` /
   * `any` (always rejected) - i.e. an open union of the vocabulary's own name.
   */
  openTypes?: readonly string[];
  /** The runtime validator the module exports, for untrusted input. */
  validator: string;
  /** Why the vocabulary is shared, and what an untyped carrier costs. */
  why: string;
}

export const VOCABULARIES: readonly SharedVocabulary[] = [
  {
    id: 'icon',
    type: 'KnownIconName',
    module: 'src/ui/components/icons/icon-names.ts',
    membersArray: 'KNOWN_ICON_NAMES',
    field: /^(?:[a-z][A-Za-z0-9]*)?[Ii]con(?:Name)?$/,
    fieldExclusions:
      "`name` (too generic - a form input's `name` is not a glyph), `icons` (a list, not a name), and `iconClass` / `iconSize` / `iconColor` (style and geometry)",
    openTypes: ['IconName'],
    validator: 'KNOWN_ICON_NAMES',
    why: 'the catalog is read by string lookup, and an unknown name renders NOTHING (the component returns an empty string), so a typo or a name left behind by a catalog rename is an invisible glyph with no error anywhere',
  },
  {
    id: 'view',
    type: 'View',
    module: 'src/features/types/view-types.ts',
    membersArray: 'VIEW_LIST',
    field: /^(?:[a-z][A-Za-z0-9]*)?[Vv]iew(?:Id)?$/,
    fieldExclusions:
      "`views` (a list, not one destination) and the callback PROPERTY names a field rule meets (`setCurrentView: (view: string) => void` - the type is the callback, and it is the callback's own `view` parameter this rule judges)",
    validator: 'isView',
    why: 'a view id decides which pane the shell renders, and an unknown one reaches the `{:else}` fallback, which renders content for no id - a blank main pane with no error; the ids also cross the messaging boundary as strings, where only `isView()` can re-narrow them',
  },
  {
    id: 'addressStatus',
    type: 'AddressStatus',
    module: 'src/utils/types.ts',
    membersArray: 'ADDRESS_STATUSES',
    field: /^(?:[a-z][A-Za-z0-9]*)?[Aa]ccountStatus$/,
    fieldExclusions:
      '`status` (the DERIVED display status - `LifecycleStatus`, which also admits `expired`, and a name every feature uses for its own state), `state`, and `statusCode` (an HTTP response code, not an address)',
    validator: 'isAddressStatus',
    why: 'the persisted lifecycle decides whether an address is live: it is what autofill offers, what the list shows, and what archiving/deletion/expiry write. A value the compiler cannot check is a misspelling that reads as NEITHER archived NOR deleted - the comparison just fails, the address stays live, and a deleted inbox keeps being filled into forms. The table half is INERT for this vocabulary by construction: three members is below the six-token evidence floor, so a map keyed by these tokens can never be flagged and this entry rests entirely on the carrier rule',
  },
  {
    id: 'activityViewId',
    type: 'ActivityViewId',
    module: 'src/features/types/view-types.ts',
    membersArray: ['VIEW_LIST', 'ACTIVITY_DIALOG_KEYS'],
    field: /^(?:[a-z][A-Za-z0-9]*)?(?:[Vv]iew(?:Id)?|[Vv]isitId)$/,
    fieldExclusions:
      'the same neighbours the view vocabulary excludes, because this rule shares its field names: `views` (a list) and the callback property names (`setCurrentView` - its own `view` parameter is what is judged)',
    validator: 'isActivityViewId',
    why: 'the activity log is keyed by these ids, so every producer and every label lookup agrees on the same family: a pane (`View`) or one of its dialogs (`dialog:tag`). A producer that misspells one writes a visit count nobody can label, and the Activity label table is keyed by the family itself',
  },
];

/**
 * Carriers that are deliberately `string`, each named in code a reviewer reads
 * rather than in a ledger.
 *
 * The reason this list exists instead of a baseline file: these are not debt to
 * be paid down. A payload read from storage or a message IS a `string` until the
 * vocabulary's validator narrows it, and typing it `View` would be a lie the
 * compiler accepts. That makes an entry here a reviewed STATEMENT about a trust
 * boundary - which is why an entry that no longer matches a live untyped carrier
 * fails the gate, and the list may only shrink.
 */
export interface VocabularyFieldException {
  /** Repo-relative path of the file that declares the carrier. */
  file: string;
  /** The carrier's name, exactly as declared. */
  field: string;
  /** The vocabulary id this carrier would otherwise be flagged against. */
  vocabulary: string;
  /** Why `string` is the honest type here (and what narrows it). */
  reason: string;
}

export const VOCABULARY_FIELD_EXCEPTIONS: readonly VocabularyFieldException[] = [
  {
    file: 'src/utils/email/email-service.ts',
    field: 'icon',
    vocabulary: 'icon',
    reason:
      'provider-config schema `ui.icon` - dead config: nothing reads it, and both values written by the shipped providers (`envelope`, `flame`) name glyphs the catalog does not have',
  },
  {
    file: 'src/features/navigation/view-handoff.ts',
    field: 'openView',
    vocabulary: 'view',
    reason:
      'the handoff payload as a URL param, a session/local record and a forced argument is an untrusted string by definition; `isView()` narrows it (and rewrites the legacy `activity` alias) before it reaches `setCurrentView`',
  },
  {
    file: 'src/utils/types.ts',
    field: 'view',
    vocabulary: 'view',
    reason:
      'the `navigateView` wire shape: the background forwards an id it received in a message (including the legacy `activity` alias), and the receiving handoff is what narrows it with `isView()`',
  },
  {
    file: 'src/utils/types.ts',
    field: 'openView',
    vocabulary: 'view',
    reason:
      'the `navigateView` wire shape - the handoff payload field, untrusted until `isView()` narrows it',
  },
  {
    file: 'src/ui/blocks/layout/AppLayout.svelte',
    field: 'view',
    vocabulary: 'view',
    reason:
      'the `navigateView` listener casts an incoming message, which is untrusted at that point by construction; the value is narrowed inside `applyOpenViewHandoff`',
  },
  {
    file: 'src/ui/blocks/layout/AppLayout.svelte',
    field: 'openView',
    vocabulary: 'view',
    reason:
      'the `navigateView` listener’s message cast - the handoff payload field, untrusted until `isView()` narrows it',
  },
  {
    file: 'src/ui/views/ActivityView.svelte',
    field: 'viewId',
    vocabulary: 'activityViewId',
    reason:
      'the visit history is stored data written by earlier builds: an id this build no longer tracks must still render its label (or the localized unknown label), not fail',
  },
  {
    file: 'src/utils/i18n/view-display-names.ts',
    field: 'viewId',
    vocabulary: 'activityViewId',
    reason:
      'the stored-history lookup - the same untrusted ids the Activity view renders, resolved to `null` so the localized unknown label is what a stranger id gets',
  },
];

/** `string` and `any` accept any value, so neither leaves the compiler a check. */
const ALWAYS_UNTYPED = ['string', 'any'];

/**
 * Whitespace-normalized declared type, without trailing punctuation - the
 * verdict is about which NAMES a declaration admits, not about its layout.
 */
export function normalizeType(raw: string): string {
  return raw
    .replace(/[;,\s]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Is this declared type one the compiler has nothing to check for `vocabulary`?
 *
 * Split on `|` and look for an exact member, so `string`, `string | undefined`,
 * `View | null` and `KnownIconName | string` are untyped, while every
 * declaration the compiler CAN check - or that is not a name at all - is not:
 * `KnownIconName`, `View`, `ToastType` (Toast's own glyph vocabulary), `number`
 * (a pixel size), `'inbox' | 'mail'` (a literal union), `string[]` /
 * `Array<string>` (a list) and `Record<string, string>` (a map).
 *
 * A CAST is judged by what it ASSERTS. `{ icon: raw as string }` hands the
 * compiler the same nothing as `{ icon: string }`, and the asserted type is the
 * one after the LAST `as` (`unknown as string` is a `string`), which is what the
 * compiler itself reads; `raw as KnownIconName` names the vocabulary and is
 * checked, and a quoted literal type (`'raw as string'`) is not a cast at all.
 */
export function isUntypedType(type: string, vocabulary: SharedVocabulary | undefined): boolean {
  const untyped = new Set([...ALWAYS_UNTYPED, ...(vocabulary?.openTypes ?? [])]);
  const judged = assertedType(type) ?? type;
  return judged
    .split('|')
    .map((member) => member.trim())
    .some((member) => untyped.has(member));
}

/**
 * The type a cast asserts, or `null` when the text does not cast.
 *
 * A literal type is not an expression and cannot cast: `'raw as string'` is the
 * string-literal type, so it is left to the member test unchanged.
 */
function assertedType(type: string): string | null {
  const text = type.trim();
  if (text.startsWith("'") || text.startsWith('"') || text.startsWith('`')) return null;
  const at = text.lastIndexOf(' as ');
  if (at === -1) return null;
  return normalizeType(text.slice(at + 4));
}

/** One registered vocabulary by id - how a scanner names the one it follows. */
export function vocabularyById(id: string): SharedVocabulary | undefined {
  return VOCABULARIES.find((vocabulary) => vocabulary.id === id);
}

/**
 * Every vocabulary whose field rule claims this declaration name, in registry
 * order (see `vocabularyById` for the single-entry lookup a scanner uses when it
 * follows one vocabulary's values, like the icon binding half).
 *
 * More than one is normal: `viewId` carries a pane id (`View`) at a navigation
 * site and an activity id (`ActivityViewId`, which also admits `dialog:*`) at a
 * visit site, and the two vocabularies overlap ON PURPOSE - the wider one is a
 * superset, so naming either makes the compiler the gate for that carrier.
 */
export function vocabulariesForField(name: string): SharedVocabulary[] {
  return VOCABULARIES.filter((vocabulary) => vocabulary.field.test(name));
}

/** The members of a vocabulary's `as const` array, read from its module. */ export function vocabularyMembers(
  vocabulary: SharedVocabulary,
  moduleText: string
): Set<string> {
  const names = new Set<string>();
  const arrays =
    typeof vocabulary.membersArray === 'string'
      ? [vocabulary.membersArray]
      : vocabulary.membersArray;
  for (const array of arrays) {
    const body = new RegExp(`(?:export )?const ${array}\\s*=\\s*\\[([\\s\\S]*?)\\]`).exec(
      moduleText
    );
    for (const match of (body?.[1] ?? '').matchAll(/'([^']+)'/g)) {
      if (match[1]) names.add(match[1]);
    }
  }
  return names;
}

/** The exception that excuses this carrier, if one does. */
export function vocabularyExceptionFor(
  file: string,
  field: string,
  vocabulary: string
): VocabularyFieldException | undefined {
  return VOCABULARY_FIELD_EXCEPTIONS.find(
    (exception) =>
      exception.file === file && exception.field === field && exception.vocabulary === vocabulary
  );
}
