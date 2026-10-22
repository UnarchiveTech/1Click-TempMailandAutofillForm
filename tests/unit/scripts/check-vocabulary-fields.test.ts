/**
 * Unit tests for the shared-vocabulary gate - `scripts/check-vocabulary-fields.ts`
 * and the registry it reads, `scripts/shared-vocabularies.ts`.
 *
 * The rule this suite exists for is one sentence: a declaration that carries a
 * token of a shared vocabulary must NAME that vocabulary's union, so the compiler
 * - not a reviewer, and not a runtime lookup miss - is what catches the next
 * typo. It generalizes the icon catalog's own field rule (`an icon field must be
 * declared KnownIconName`) to every vocabulary the app agrees on, so the shapes
 * that matter here are:
 *
 *   - CARRIERS: `icon` / `iconName` / `…Icon` and `view` / `viewId` / `…View`,
 *     declared `string` / `any` / the open union (a finding) versus the
 *     vocabulary union or a literal union (checked), and the three shapes that
 *     used to read as unchecked-not-seen: a union broken across LINES, a CAST
 *     (`raw as string`), and a same-file ALIAS (`type Glyphs = string`);
 *   - TABLES: a lookup map whose keys are demonstrably a vocabulary's tokens,
 *     declared `Record<string, T>` (a finding) versus `Record<Vocab, T>`,
 *     `Partial<Record<Vocab, T>>`, a mapped type or a `satisfies` (checked);
 *   - BOUNDARIES: the trust-boundary carriers named in
 *     `VOCABULARY_FIELD_EXCEPTIONS` - and that a stale row fails, so the list can
 *     only shrink.
 *
 * The last describe runs the live tree through the live code path, so `bun test`
 * fails wherever `bun run audit` would.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  hasCheckedKeyType,
  isCarrierUntyped,
  readMemberships,
  resolveAliases,
  scanRepositoryCarriers,
  scanRepositoryKeyedTables,
  scanTypeAliases,
  scanTypeBodies,
  scanVocabularyCarriers,
  scanVocabularyKeyedTables,
  staleVocabularyExceptions,
  TABLE_MEMBER_RATIO,
  TABLE_MIN_MEMBERS,
  typeKeysChecked,
  untypedCarrierFindings,
  type VocabularyMembership,
} from '../../../scripts/check-vocabulary-fields';
import type { SharedVocabulary } from '../../../scripts/shared-vocabularies';
import {
  isUntypedType,
  normalizeType,
  VOCABULARIES,
  VOCABULARY_FIELD_EXCEPTIONS,
  vocabulariesForField,
  vocabularyById,
  vocabularyExceptionFor,
  vocabularyMembers,
} from '../../../scripts/shared-vocabularies';
import { REPO_ROOT } from '../../../scripts/source-files';

/** The carriers of a fixture, spelled `<field>: <type>`. */
function carriers(source: string): string[] {
  return scanVocabularyCarriers(source).map((carrier) => `${carrier.field}: ${carrier.type}`);
}

/**
 * A fixture's carriers both ways: `<field>: <type>`, and `→ <resolved>` when the
 * same-file aliases it names change the reading.
 */
function bothReadings(source: string): string[] {
  return scanVocabularyCarriers(source).map((carrier) =>
    carrier.resolvedType === carrier.type
      ? `${carrier.field}: ${carrier.type}`
      : `${carrier.field}: ${carrier.type} → ${carrier.resolvedType}`
  );
}

/**
 * A fixture's DERIVED carriers: the member each lookup resolves to, spelled
 * `field: type ⇢ Member.member = declared`. Empty for a carrier that is not a
 * lookup, so a fixture proves the derivation ran rather than the rule being
 * blind to lookups.
 */
function derivations(source: string): string[] {
  return scanVocabularyCarriers(source)
    .filter((carrier) => carrier.derivedType !== undefined)
    .map(
      (carrier) =>
        `${carrier.field}: ${carrier.type} ⇢ ${carrier.derivedVia} = ${carrier.derivedType}`
    );
}

/** The untyped carriers of a fixture, spelled `<field>: <type>` - the findings. */
function untyped(source: string, file = 'src/fixture.ts'): string[] {
  return untypedCarrierFindings(
    scanVocabularyCarriers(source).map((carrier) => ({ ...carrier, file }))
  ).map((finding) => `${finding.field}: ${finding.type}`);
}

/** The vocabulary ids a fixture's field names are claimed by. */
function claimedBy(field: string): string[] {
  return vocabulariesForField(field).map((vocabulary) => vocabulary.id);
}

/**
 * The registry entry with this id. A missing one fails every fixture in this
 * file rather than quietly making the rule's scope smaller.
 */
function vocabularyOrThrow(id: string): SharedVocabulary {
  const found = vocabularyById(id);
  if (!found) throw new Error(`the registry no longer carries a '${id}' vocabulary`);
  return found;
}

const icon = vocabularyOrThrow('icon');
const view = vocabularyOrThrow('view');

/** Memberships for a fixture, so table fixtures need no live modules. */
const FIXTURE_MEMBERSHIPS: VocabularyMembership[] = [
  { vocabulary: icon, members: new Set(['star', 'archive', 'close', 'add', 'mail', 'inbox']) },
  {
    vocabulary: view,
    members: new Set(['mailbox', 'addresses', 'settings', 'analytics', 'identities', 'loginInfo']),
  },
];

/**
 * Six view-keyed rows - the floor `TABLE_MIN_MEMBERS` needs for a finding, so a
 * fixture proves the rule fires rather than the floor being quietly lowered.
 */
const SIX_VIEW_KEYS = [
  "  mailbox: 'a',",
  "  addresses: 'b',",
  "  settings: 'c',",
  "  analytics: 'd',",
  "  identities: 'e',",
  "  loginInfo: 'f',",
];

/**
 * The vocabulary-keyed tables of a fixture, spelled `<name>: <type>` - both the
 * findings and, with `includeChecked`, the declarations the scanner READ and
 * accepted. The second half is what proves the first is not silence.
 */
function allKeyedTables(source: string, includeChecked = false): string[] {
  return scanVocabularyKeyedTables(source, FIXTURE_MEMBERSHIPS)
    .filter((table) => includeChecked || !table.checked)
    .map(
      (table) =>
        `${table.name}: ${table.type} (${table.vocabulary.id} ${table.matched}/${table.total})`
    );
}

/** The FINDINGS only: a table whose declaration does not name its key type. */
function keyedTables(source: string): string[] {
  return allKeyedTables(source);
}

describe('the vocabulary registry', () => {
  test('every entry names a real union, a member list, and a validator', () => {
    expect(VOCABULARIES.length).toBeGreaterThanOrEqual(3);
    for (const vocabulary of VOCABULARIES) {
      const path = join(REPO_ROOT, vocabulary.module);
      expect(existsSync(path)).toBe(true);
      const moduleText = readFileSync(path, 'utf8');
      // The union the finding tells a reader to declare must really be exported
      // there, or the advice sends them to a type that does not exist.
      expect(moduleText).toContain(`type ${vocabulary.type}`);
      // …and the runtime validator a boundary is supposed to use, EXPORTED -
      // a validator nothing can import narrows nothing. Two shapes are legal:
      // a predicate (`function isView(`) and the member array itself
      // (`const KNOWN_ICON_NAMES`), which IS the icon vocabulary's validator.
      expect(moduleText).toMatch(
        new RegExp(`export (?:function|const) ${vocabulary.validator}\\b`)
      );
      // The member list is what the table rule reads; empty would make it blind.
      expect(vocabularyMembers(vocabulary, moduleText).size).toBeGreaterThan(2);
      // A reason a reviewer can weigh: why the vocabulary is shared, and what an
      // untyped carrier costs.
      expect(vocabulary.why.length).toBeGreaterThan(80);
      expect(vocabulary.fieldExclusions.length).toBeGreaterThan(20);
    }
  });

  test('the icon vocabulary keeps the catalog’s own field-name rule', () => {
    const iconNames = ['icon', 'iconName', 'pageIcon', 'headerPageIcon', 'secondaryIcon'];
    for (const name of iconNames) expect(claimedBy(name)).toContain('icon');
    // The three neighbours the rule deliberately leaves out, because each would
    // flood it with fields that hold something else.
    for (const name of ['name', 'icons', 'iconClass', 'iconSize', 'iconColor']) {
      expect(claimedBy(name)).toEqual([]);
    }
  });

  test('the view vocabularies claim the view ids and leave the neighbours', () => {
    for (const name of ['view', 'viewId', 'nextView', 'activeView', 'currentView', 'openView']) {
      expect(claimedBy(name)).toContain('view');
    }
    // A LIST (`views`), a count, and a callback property: a field rule about
    // single ids has nothing to say about any of them.
    for (const name of ['views', 'viewCount', 'viewMode']) expect(claimedBy(name)).toEqual([]);
  });

  test('the address-status vocabulary claims the persisted lifecycle field', () => {
    // `accountStatus` is what archiving, deletion and expiry write, and what the
    // liveness comparisons read.
    expect(claimedBy('accountStatus')).toEqual(['addressStatus']);
    expect(claimedBy('AccountStatus')).toEqual(['addressStatus']);
    expect(claimedBy('previousAccountStatus')).toEqual(['addressStatus']);
    // Left out deliberately: the DERIVED display status is a different set
    // (`LifecycleStatus` also admits `expired`), it is the name every feature
    // uses for its own state, and a plural is a list rather than one token.
    for (const name of ['status', 'addressStatus', 'statusCode', 'accountStatuses']) {
      expect(claimedBy(name)).toEqual([]);
    }
  });

  test('`isUntypedType` rejects exactly what the compiler cannot follow', () => {
    for (const type of ['string', 'any', 'string | undefined', 'View | string', 'string | null']) {
      expect(isUntypedType(type, view)).toBe(true);
    }
    for (const type of ['View', 'View | null', "'inbox' | 'mail'", 'number', 'string[]']) {
      expect(isUntypedType(type, view)).toBe(false);
    }
    // The open union only defeats the compiler where it IS the prop's type: the
    // icon prop is deliberately open, a view field never is.
    expect(isUntypedType('IconName', icon)).toBe(true);
    expect(isUntypedType('IconName', view)).toBe(false);
    // A vocabulary that is not registered leaves only the universal tokens.
    expect(isUntypedType('string', undefined)).toBe(true);
    expect(isUntypedType('ToastType', undefined)).toBe(false);
  });

  test('`normalizeType` folds layout away, so the verdict is about names', () => {
    expect(normalizeType('  string | undefined ; ')).toBe('string | undefined');
    expect(normalizeType('KnownIconName')).toBe('KnownIconName');
  });

  test('the members ARE the vocabulary: read from the union’s own array', () => {
    const iconModule = readFileSync(
      join(REPO_ROOT, 'src/ui/components/icons/icon-names.ts'),
      'utf8'
    );
    const members = vocabularyMembers(icon, iconModule);
    expect(members.has('add')).toBe(true);
    expect(members.has('delete')).toBe(true);
    // A rename target: the retired spelling is not a member.
    expect(members.has('trash')).toBe(false);
  });
});

describe('a carrier must name its vocabulary', () => {
  test('an icon field, however it is spelled', () => {
    const source = [
      'type A = { icon: string };',
      'type B = { iconName?: string };',
      'type C = { pageIcon: string };',
      'type D = { headerPageIcon: string };',
      'type E = { secondaryIcon?: string };',
      // Not fields: a plural LIST, a style class, a measurement, and `name`
      // (too generic - a form input's `name` is not a glyph).
      'type F = { icons: string[]; iconClass: string; iconSize: number; name: string };',
    ].join('\n');
    expect(carriers(source)).toEqual([
      'icon: string',
      'iconName: string',
      'pageIcon: string',
      'headerPageIcon: string',
      'secondaryIcon: string',
    ]);
  });

  test('a view carrier, including the callback’s own parameter', () => {
    const source = [
      'type A = { view: string };',
      'type B = { viewId?: string };',
      'type C = { nextView: string };',
      // The outer declaration's type is the CALLBACK, which no union can name -
      // the parameter inside it is the carrier, and it is judged.
      'type D = { setCurrentView: (view: string) => void };',
    ].join('\n');
    expect(carriers(source)).toEqual([
      'view: string',
      'viewId: string',
      'nextView: string',
      'setCurrentView: (view: string',
      'view: string',
    ]);
  });

  test('a lifecycle carrier, declared either way', () => {
    const source = [
      'interface AddressRow {',
      '  accountStatus?: string;',
      '  previousAccountStatus: string | null;',
      '}',
      'interface Checked {',
      "  accountStatus?: 'active' | 'archived' | 'deleted';",
      '  previousAccountStatus: AddressStatus;',
      '}',
    ].join('\n');
    expect(untyped(source)).toEqual([
      'accountStatus: string',
      'previousAccountStatus: string | null',
    ]);
    // …and the checked pair is SEEN rather than skipped: the vocabulary's own
    // union and its literal spelling both satisfy the rule.
    expect(scanVocabularyCarriers(source).length).toBe(4);
  });

  test('`string` and `any` are findings; a union that names the vocabulary is not', () => {
    // Unchecked, however the widening is written.
    expect(untyped('type A = { icon: string };')).toEqual(['icon: string']);
    expect(untyped('type A = { icon?: string };')).toEqual(['icon: string']);
    expect(untyped('type A = { icon: string | null };')).toEqual(['icon: string | null']);
    expect(untyped('type A = { icon: any };')).toEqual(['icon: any']);
    expect(untyped('type A = { icon: IconName };')).toEqual(['icon: IconName']);
    // `KnownIconName | string` is still unchecked: the union admits any value.
    expect(untyped('type A = { icon: KnownIconName | string };')).toEqual([
      'icon: KnownIconName | string',
    ]);
    // Everything the compiler CAN follow, or that is not a name at all.
    for (const declaration of [
      'type A = { icon: KnownIconName };',
      'type A = { icon?: KnownIconName | undefined };',
      'type A = { icon: ToastType };', // the Toast glyph vocabulary
      'type A = { icon: number };', // a pixel size
      "type A = { icon: 'inbox' | 'mail' };", // a literal union
      'type A = { icon: string[] };', // a list, not a name
      'type A = { icon: Record<string, string> };', // a map, not a name
      'type A = { view: View };',
      'type A = { viewId: ActivityViewId };',
    ]) {
      expect(untyped(declaration)).toEqual([]);
      // …and each is still SEEN as a carrier, so "no finding" is not "the
      // scanner read nothing".
      expect(scanVocabularyCarriers(declaration).length).toBe(1);
    }
  });

  test('a union broken across lines is one declaration, not an empty type', () => {
    // The shape a formatter produces for a long union. Read line by line it was
    // an EMPTY type - neither checked nor flagged - so the `string` it carries
    // was invisible to the rule.
    expect(carriers('type A = {\n  icon:\n    | string\n    | undefined;\n};')).toEqual([
      'icon: | string | undefined',
    ]);
    expect(untyped('type A = {\n  icon:\n    | string\n    | undefined;\n};')).toEqual([
      'icon: | string | undefined',
    ]);
    // A union that names the vocabulary on a continuation line is checked, and
    // the trailing `;` belongs to the declaration rather than to the type.
    expect(untyped('type A = {\n  viewId:\n    | View\n    | null;\n};')).toEqual([]);
    expect(carriers('type A = {\n  viewId:\n    | View\n    | null;\n};')).toEqual([
      'viewId: | View | null',
    ]);
    // Also when only the FIRST line ends mid-union (`KnownIconName |`).
    expect(untyped('type A = { icon: KnownIconName |\n  string };')).toEqual([
      'icon: KnownIconName | string',
    ]);
    // A newline that does NOT continue the type still ends it: the next property
    // is a declaration of its own, not part of this type.
    expect(carriers('type A = {\n  icon: KnownIconName;\n  view: string;\n};')).toEqual([
      'icon: KnownIconName',
      'view: string',
    ]);
  });

  test('a CAST is judged by what it asserts', () => {
    // `as string` hands the compiler the same nothing as `string`, and the cast
    // is why the value went unchecked in the first place.
    expect(untyped('const M = { icon: raw as string };')).toEqual(['icon: raw as string']);
    expect(untyped("const M = { view: (raw as string) || 'autofill' };")).toEqual([
      'view: (raw as string',
    ]);
    // The LAST `as` is what the compiler reads.
    expect(untyped('const M = { view: raw as unknown as string };')).toEqual([
      'view: raw as unknown as string',
    ]);
    expect(untyped('type A = { icon: raw as string | undefined };')).toEqual([
      'icon: raw as string | undefined',
    ]);
    // A cast that names the vocabulary is checked, and a literal type is not a
    // cast at all (its ` as ` is inside the quotes).
    expect(untyped('const M = { icon: raw as KnownIconName };')).toEqual([]);
    expect(untyped('const M = { icon: raw as const };')).toEqual([]);
    expect(untyped("type A = { icon: 'raw as string' };")).toEqual([]);
  });

  test('a same-file ALIAS is followed to what it resolves to', () => {
    const alias = [
      'type GlyphName = string;',
      'type Glyphs = GlyphName;',
      'type Tokens = KnownIconName;',
      'type A = { icon: GlyphName; iconName: Glyphs; pageIcon: Tokens };',
    ].join('\n');
    expect(bothReadings(alias)).toEqual([
      'icon: GlyphName → string',
      'iconName: Glyphs → string',
      'pageIcon: Tokens → KnownIconName',
    ]);
    // The alias only moved the `string` off the line a reader looks at.
    expect(untyped(alias)).toEqual(['icon: GlyphName', 'iconName: Glyphs']);
    // The same alias through a `|` member, and a view alias for the other half.
    expect(untyped('type V = string;\ntype A = { view: V | null };')).toEqual(['view: V | null']);
    // A cycle terminates and flags nothing it cannot prove.
    expect(untyped('type A2 = B2;\ntype B2 = A2;\ntype A = { icon: A2 };')).toEqual([]);
    // An alias this file does not declare is left as written (a boundary: the
    // imported name could be the union).
    expect(untyped('type A = { icon: Imported };')).toEqual([]);
    expect(bothReadings('type A = { icon: Imported };')).toEqual(['icon: Imported']);
  });

  test('`scanTypeAliases` / `resolveAliases` are the pure core of that rule', () => {
    const aliases = scanTypeAliases(
      [
        'export type GlyphName = string;', // exported
        'type Union =\n  | string\n  | undefined;', // broken across lines
        'type Meta = {\n  icon: string;\n};', // an object type keeps its own `;`
        'type Pair<T> = [T, T];', // generic parameters
        'type CycleA = CycleB;',
        'type CycleB = CycleA;',
        'export type { GlyphName as ReExport };', // no `=`, not an alias
      ].join('\n')
    );
    expect(aliases.get('GlyphName')).toBe('string');
    expect(aliases.get('Union')).toBe('| string | undefined');
    expect(aliases.get('Meta')).toBe('{ icon: string; }');
    expect(aliases.get('Pair')).toBe('[T, T]');
    expect(aliases.has('ReExport')).toBe(false);
    expect(resolveAliases('GlyphName', aliases)).toBe('string');
    expect(resolveAliases('GlyphName | null', aliases)).toBe('string | null');
    expect(resolveAliases('CycleA', aliases)).toBe('CycleA');
    // A member that is not a bare name is not expanded, and text with nothing to
    // expand comes back byte-identical (a `||` is not a union).
    expect(resolveAliases('Array<GlyphName>', aliases)).toBe('Array<GlyphName>');
    expect(resolveAliases("pick() || 'sm'", aliases)).toBe("pick() || 'sm'");
    expect(resolveAliases('GlyphName', new Map())).toBe('GlyphName');
    // The verdict reads both forms, which is what `isCarrierUntyped` names.
    expect(isCarrierUntyped({ type: 'GlyphName', resolvedType: 'string' }, icon)).toBe(true);
    expect(isCarrierUntyped({ type: 'GlyphName', resolvedType: 'KnownIconName' }, icon)).toBe(
      false
    );
  });

  test('a DERIVED carrier is followed to the member it looks up', () => {
    // `Meta['view']` names `Meta`, not the vocabulary: the compiler checks the
    // LOOKUP, and what it lands on is declared somewhere else in the file - one
    // indirection away from the alias rule, which cannot see it.
    const lookup = ['interface Meta { view: string }', "type A = { nextView: Meta['view'] };"].join(
      '\n'
    );
    expect(derivations(lookup)).toEqual(["nextView: Meta['view'] ⇢ Meta.view = string"]);
    // The member is a carrier of its own here, and is flagged as one; the derived
    // reading is what also catches the shape where it is NOT - a member the field
    // rule does not claim (`destination`), reached by a name it does (`view`).
    expect(untyped(lookup)).toEqual(['view: string', "nextView: Meta['view']"]);
    expect(
      untyped(
        ['interface Meta { destination: string }', "type A = { view: Meta['destination'] };"].join(
          '\n'
        )
      )
    ).toEqual(["view: Meta['destination']"]);
    // …and a lookup that lands on the union is checked, and still SEEN - no
    // finding is not the same as the scanner having read nothing.
    const typed = ['interface Meta { view: View }', "type A = { nextView: Meta['view'] };"].join(
      '\n'
    );
    expect(derivations(typed)).toEqual(["nextView: Meta['view'] ⇢ Meta.view = View"]);
    expect(untyped(typed)).toEqual([]);
    expect(carriers(typed)).toContain("nextView: Meta['view']");
    // An alias of an alias resolves through both, and a transparent wrapper
    // (`Readonly<…>`, `NonNullable<…>`) changes nothing about the member.
    expect(
      derivations(
        [
          'type Meta = { view: string };',
          'type Alias = Meta;',
          "type A = { view: Alias['view'] };",
        ].join('\n')
      )
    ).toEqual(["view: Alias['view'] ⇢ Meta.view = string"]);
    expect(
      derivations(
        ['interface Meta { icon: string }', "type A = { icon: Readonly<Meta['icon']> };"].join('\n')
      )
    ).toEqual(["icon: Readonly<Meta['icon']> ⇢ Meta.icon = string"]);
  });

  test('`Pick` / `Omit` decide whether the looked-up member survives', () => {
    // The comma inside `Pick<Meta, 'pageIcon'>` is part of the type: read as a
    // declaration end it truncated the written type to `Pick<Meta`, hiding the
    // lookup behind it.
    const picked = [
      'interface Meta { pageIcon: string }',
      "type A = { icon: Pick<Meta, 'pageIcon'>['pageIcon'] };",
    ].join('\n');
    expect(carriers(picked)).toContain("icon: Pick<Meta, 'pageIcon'>['pageIcon']");
    expect(derivations(picked)).toEqual([
      "icon: Pick<Meta, 'pageIcon'>['pageIcon'] ⇢ Meta.pageIcon = string",
    ]);
    // `Pick` keeping the name resolves it; `Omit` dropping it does not (the
    // compiler rejects that lookup itself, which is not this rule's finding).
    expect(
      derivations(
        ['interface Meta { icon: string }', "type A = { icon: Omit<Meta, 'icon'>['icon'] };"].join(
          '\n'
        )
      )
    ).toEqual([]);
    expect(
      derivations(
        ['interface Meta { view: string }', "type A = { view: Omit<Meta, 'other'>['view'] };"].join(
          '\n'
        )
      )
    ).toEqual(["view: Omit<Meta, 'other'>['view'] ⇢ Meta.view = string"]);
    // A lookup naming SEVERAL members is the union of their types.
    expect(
      derivations(
        [
          'interface Meta { view: string; icon: string }',
          "type A = { view: Meta['view' | 'icon'] };",
        ].join('\n')
      )
    ).toEqual(["view: Meta['view' | 'icon'] ⇢ Meta.view + Meta.icon = string"]);
  });

  test('a derivation this file cannot finish reading is left alone', () => {
    // The base is declared in another module: the boundary, stated rather than
    // guessed - the same one the alias rule has.
    expect(derivations("type A = { view: Imported['view'] };")).toEqual([]);
    expect(untyped("type A = { view: Imported['view'] };")).toEqual([]);
    // A key the rule cannot reduce to literals (`Meta[Kind]`) says nothing about
    // which member is meant.
    expect(
      derivations(['interface Meta { view: string }', 'type A = { view: Meta[Kind] };'].join('\n'))
    ).toEqual([]);
    // …and a member the base does not declare is a compile error already.
    expect(
      derivations(
        ['interface Meta { icon: string }', "type A = { view: Meta['view'] };"].join('\n')
      )
    ).toEqual([]);
  });

  test('angle brackets are read where a generic can start, and nowhere else', () => {
    // A generic argument list is one type, commas included…
    expect(carriers('type A = { view: Foo<Bar, string> };')).toEqual(['view: Foo<Bar, string>']);
    // …while a comma between members still ends the declaration.
    expect(carriers('type A = { icon: KnownIconName, view: string };')).toEqual([
      'icon: KnownIconName',
      'view: string',
    ]);
    // A value-position `<` (a comparison) must not open a group that swallows
    // the rest of the statement: no space-free identifier precedes it.
    expect(untyped("const M = { view: a < b ? 'mailbox' : 'settings' };")).toEqual([]);
  });

  test('a name two vocabularies claim needs only ONE of them to be checked', () => {
    // `viewId` is a pane id at a navigation site and an activity id (which also
    // admits `dialog:*`) at a visit site, so either union makes the compiler the
    // gate - and only an unchecked carrier is a finding.
    expect(claimedBy('viewId')).toEqual(['view', 'activityViewId']);
    expect(untyped('type A = { viewId: View };')).toEqual([]);
    expect(untyped('type A = { viewId: ActivityViewId };')).toEqual([]);
    expect(untyped('type A = { viewId: string };')).toEqual(['viewId: string']);
  });

  test('a declaration quoted in a comment or a string body is not a carrier', () => {
    // The lexer decides what is code: both of these carry a real delimiter
    // before the name, so only the `inCode` mask keeps them out.
    expect(scanVocabularyCarriers('// { icon: string }').length).toBe(0);
    expect(scanVocabularyCarriers("const doc = '{ icon: string }';").length).toBe(0);
    expect(scanVocabularyCarriers('// { view: string }').length).toBe(0);
  });

  test('a carrier nested in a generic is still a declaration', () => {
    expect(carriers('type A = Record<string, { icon: string }>;')).toEqual(['icon: string']);
    expect(carriers('type A = Array<{ pageIcon: string }>;')).toEqual(['pageIcon: string']);
  });
});

describe('the named boundary exceptions', () => {
  test('an exception excuses its own carrier, and nothing else', () => {
    const exception = VOCABULARY_FIELD_EXCEPTIONS[0];
    expect(exception).toBeDefined();
    const excused = {
      file: exception?.file ?? '',
      field: exception?.field ?? '',
      type: 'string',
      resolvedType: 'string',
      line: 1,
    };
    expect(untypedCarrierFindings([excused])).toEqual([]);
    // …and it is NOT stale: the carrier it names is still declared, and still
    // untyped. (The other rows are stale in this one-carrier world, which is
    // what the next test pins.)
    expect(staleVocabularyExceptions([excused]).map((row) => row.field)).not.toContain(
      exception?.field
    );
    // Another file, another field, another vocabulary - none is excused.
    const fresh = {
      file: 'src/ui/views/NewView.svelte',
      field: 'leadingIcon',
      type: 'string',
      resolvedType: 'string',
      line: 4,
    };
    expect(untypedCarrierFindings([excused, fresh]).map((f) => f.field)).toEqual(['leadingIcon']);
  });

  test('a row is scoped to its vocabulary, not just to a name', () => {
    const exception = VOCABULARY_FIELD_EXCEPTIONS.find((row) => row.vocabulary === 'view');
    expect(exception).toBeDefined();
    // The row names the vocabulary it carves out: the same name under a
    // different vocabulary is not excused by it.
    expect(vocabularyExceptionFor(exception?.file ?? '', exception?.field ?? '', 'view')).toBe(
      exception
    );
    expect(
      vocabularyExceptionFor(exception?.file ?? '', exception?.field ?? '', 'activityViewId')
    ).toBeUndefined();
  });

  test('an exception whose carrier is now typed is STALE - the list may only shrink', () => {
    const exception = VOCABULARY_FIELD_EXCEPTIONS[0];
    const typed = {
      file: exception?.file ?? '',
      field: exception?.field ?? '',
      type: 'KnownIconName',
      resolvedType: 'KnownIconName',
      line: 1,
    };
    // An alias that RESOLVES to the untyped token counts as unchecked too, so a
    // row cannot be un-staled by writing the `string` behind an alias.
    const aliased = {
      file: exception?.file ?? '',
      field: exception?.field ?? '',
      type: 'GlyphName',
      resolvedType: 'string',
      line: 1,
    };
    expect(untypedCarrierFindings([aliased])).toEqual([]);
    expect(staleVocabularyExceptions([aliased])).not.toContain(exception);
    // Every row whose carrier is no longer untyped reads stale - including a row
    // that has no carrier at all in the set handed in.
    expect(staleVocabularyExceptions([typed])).toContain(exception);
  });
});

describe('a table keyed by a vocabulary must declare its key type', () => {
  test('the evidence is the keys: a vocabulary-keyed map is a finding', () => {
    const source = [
      'const LABELS: Record<string, string> = {',
      "  mailbox: 'nav.mailbox',",
      "  addresses: 'nav.addresses',",
      "  settings: 'nav.settings',",
      "  analytics: 'nav.activity',",
      "  identities: 'nav.identities',",
      "  loginInfo: 'nav.logins',",
      '};',
    ].join('\n');
    expect(keyedTables(source)).toEqual(['LABELS: Record<string, string> (view 6/6)']);
  });

  test('a checked declaration is SEEN, not silently skipped', () => {
    // The failure this pins: reading the type annotation's own braces as the
    // table (`Record<string, { icon: string }>`) made a real table read as no
    // table, so the rule could not have been told apart from a clean repo.
    const source = ['const LABELS: Record<View, string> = {', ...SIX_VIEW_KEYS, '};'].join('\n');
    expect(keyedTables(source)).toEqual([]);
    expect(allKeyedTables(source, true)).toEqual(['LABELS: Record<View, string> (view 6/6)']);
    const nestedType = [
      'const META: Record<string, { icon: string }> = {',
      ...SIX_VIEW_KEYS.map((key) => key.replace(/: '.*',/, ": { icon: 'mail' },")),
      '} satisfies Record<View, { icon: KnownIconName }>;',
    ].join('\n');
    expect(keyedTables(nestedType)).toEqual([]);
    expect(allKeyedTables(nestedType, true)).toEqual([
      'META: Record<string, { icon: string }> (view 6/6)',
    ]);
  });

  test('every declaration that names a key type passes', () => {
    const keys = SIX_VIEW_KEYS;
    for (const declaration of [
      'const LABELS: Record<View, string> = {',
      'const LABELS: Partial<Record<View, string>> = {',
      'const LABELS = {',
    ]) {
      const source = [declaration, ...keys, '} satisfies Record<View, string>;'].join('\n');
      expect(keyedTables(source)).toEqual([]);
    }
    // A named alias of the mapping is a declaration too, even though this
    // registry cannot see through it - the rule's claim is about `string`.
    expect(keyedTables(['const LABELS: ViewLabels = {', ...keys, '};'].join('\n'))).toEqual([]);
    // …and a mapped type is the third accepted spelling.
    expect(
      keyedTables(['const LABELS: { [k in View]: string } = {', ...keys, '};'].join('\n'))
    ).toEqual([]);
  });

  test('`Record<string, View>` is still `string`-keyed - the half in question', () => {
    // The second argument is the BODY's closing `}` (index 38 here, 16 below).
    expect(hasCheckedKeyType('const LABELS: Record<string, View> = {}', 38)).toBe(false);
    expect(hasCheckedKeyType('const LABELS: Record<View, string> = {}', 38)).toBe(true);
    expect(hasCheckedKeyType('const LABELS = {}', 16)).toBe(false);
  });

  test('the rule needs EVIDENCE: a table of something else is not a finding', () => {
    // Country codes, keywords, days: no vocabulary key is a majority here, so a
    // `Record<string, …>` stays exactly what it is.
    const source = [
      'const COUNTRY: Record<string, string> = {',
      "  US: 'United States',",
      "  DE: 'Germany',",
      "  FR: 'France',",
      "  JP: 'Japan',",
      "  BR: 'Brazil',",
      "  IN: 'India',",
      '};',
    ].join('\n');
    expect(keyedTables(source)).toEqual([]);
    // Below the membership floor, even a real vocabulary table is out of scope.
    const small = [
      'const TINY: Record<string, string> = {',
      "  mailbox: 'a',",
      "  addresses: 'b',",
      '};',
    ].join('\n');
    expect(keyedTables(small)).toEqual([]);
    expect(TABLE_MIN_MEMBERS).toBeGreaterThan(2);
    expect(TABLE_MEMBER_RATIO).toBeLessThanOrEqual(0.5);
  });

  test('nested keys are not the table’s keys, and a `;` ends the declaration', () => {
    // The key is `mailbox`; the nested `icon` is a value's field, and reading it
    // as a key would mis-count the evidence.
    const nested = [
      'const META: Record<string, { icon: string }> = {',
      "  mailbox: { icon: 'mail' },",
      "  addresses: { icon: 'mail' },",
      "  settings: { icon: 'settings' },",
      "  analytics: { icon: 'barChart' },",
      "  identities: { icon: 'badge' },",
      "  loginInfo: { icon: 'key' },",
      '};',
    ].join('\n');
    expect(keyedTables(nested)).toEqual(['META: Record<string, { icon: string }> (view 6/6)']);
    // A string constant followed by a table is not that table: the `;` closes
    // the statement, and the NEXT declaration's `{` must not be read as its
    // literal (the false finding that started this check).
    const neighbour = [
      "const PATH = '<svg/>';",
      'const LABELS: Record<string, string> = {',
      ...SIX_VIEW_KEYS,
      '};',
    ].join('\n');
    expect(keyedTables(neighbour)).toEqual(['LABELS: Record<string, string> (view 6/6)']);
  });

  test('`typeKeysChecked` judges the derived key sets', () => {
    // Checked: the key set is finite - literals, a `Pick` of literals, a mapped
    // type over a vocabulary, and a name this registry cannot resolve (the
    // boundary: the rule's claim is about `string`, not about this file).
    for (const type of [
      'Record<View, number>',
      "Record<View | 'dialog:tag', number>",
      "Pick<Record<string, number>, 'mailbox' | 'addresses'>",
      '{ [K in View]: number }',
      'Partial<Record<View, number>>',
      'SomeImportedMap',
      '{ mailbox: number }',
    ]) {
      expect(typeKeysChecked(type), type).toBe(true);
    }
    // Unchecked: the key set admits any string, however the erasure is spelled.
    for (const type of [
      '',
      'Record<string, number>',
      'Record<string | View, number>',
      'Record<View | string, number>',
      'Partial<Record<string, number>>',
      "Omit<Record<string, number>, 'x'>",
      '{ [K in string]: number }',
      '{ [k: string]: number }',
      `{ [K in \`dialog:\${string}\`]: number }`,
    ]) {
      expect(typeKeysChecked(type), type).toBe(false);
    }
    // A name is resolved through the file's own declarations, transitively.
    const bodies = scanTypeBodies(
      [
        'type StringKeyed = Record<string, number>;',
        'type Alias = StringKeyed;',
        'type Keys = keyof StringKeyed;',
        'type ViewKeys = Partial<Record<View, number>>;',
      ].join('\n')
    );
    expect(typeKeysChecked('StringKeyed', bodies)).toBe(false);
    expect(typeKeysChecked('Alias', bodies)).toBe(false);
    expect(typeKeysChecked('Keys', bodies)).toBe(false);
    expect(typeKeysChecked('ViewKeys', bodies)).toBe(true);
  });

  test('a DERIVED key type is judged, not left to review', () => {
    const table = (type: string, prefix = '') =>
      prefix + [`const T: ${type} = {`, ...SIX_VIEW_KEYS, '};'].join('\n');
    // The vocabulary keys are all there, so the table IS the view table - and
    // every one of these spellings leaves the compiler nothing to check.
    for (const type of [
      // `string` in the key position, in either order beside the union.
      'Record<string | View, number>',
      'Record<View | string, number>',
      // A mapped type over a domain that admits any key.
      '{ [K in string]: number }',
      // `Omit` over a string-keyed record stays string-keyed.
      "Omit<Record<string, number>, 'x'>",
    ]) {
      expect(keyedTables(table(type)), type).toEqual([`T: ${type} (view 6/6)`]);
    }
    // An ALIAS of an erasure is the same erasure: the name only moves the
    // `Record<string, …>` off the line a reader looks at.
    expect(
      keyedTables(table('StringKeyed', 'type StringKeyed = Record<string, number>;\n'))
    ).toEqual(['T: StringKeyed (view 6/6)']);
    expect(keyedTables(table('Keys', 'type Keys = keyof Record<string, number>;\n'))).toEqual([
      'T: Keys (view 6/6)',
    ]);
    // …and a mapped type over a string-keyed record's keys, through an
    // interface this file declares.
    expect(
      keyedTables(
        table('{ [K in keyof Meta]: number }', 'interface Meta { [k: string]: number }\n')
      )
    ).toEqual(['T: { [K in keyof Meta]: number } (view 6/6)']);
    // The same derived shapes, said the checked way, stay checked.
    for (const [type, prefix] of [
      ["Record<View | 'dialog:tag', number>", ''],
      ["Pick<Record<string, number>, 'mailbox' | 'addresses'>", ''],
      ['{ [K in View]: number }', ''],
      ['ViewKeys', 'type ViewKeys = Partial<Record<View, number>>;\n'],
      ['{ [K in keyof Meta]: number }', 'interface Meta { mailbox: number }\n'],
      // An imported name is the boundary, not a finding.
      ['ToolbarButtonVisibility', ''],
    ] as const) {
      expect(keyedTables(table(type, prefix)), type).toEqual([]);
      expect(allKeyedTables(table(type, prefix), true).length).toBe(1);
    }
  });

  test('the best vocabulary wins, so the advice names the widenest fix', () => {
    const source = [
      '    const VISITS: Record<string, number> = {',
      ...SIX_VIEW_KEYS.map((key) => key.replace(/'.*'/, '1')),
      '  star: 7,',
      '  archive: 8,',
      '};',
    ].join('\n');
    // Six view ids and two icon names: both vocabularies clear the floor, and the
    // advice must name the one with more evidence (`View` - `KnownIconName` would
    // reject the six view keys).
    expect(keyedTables(source)).toEqual(['VISITS: Record<string, number> (view 6/8)']);
  });
});

describe('against the live tree', () => {
  test('the scanner reads the tree it claims to (it is not vacuously green)', () => {
    const found = scanRepositoryCarriers();
    expect(found.length).toBeGreaterThan(200);
    expect(found.every((carrier) => carrier.file.startsWith('src/'))).toBe(true);
    expect(found.every((carrier) => carrier.line > 0)).toBe(true);
    // Both vocabularies are really exercised by live declarations, and the
    // tolerances the rule must keep are live too (`ToastType` is a second glyph
    // vocabulary, which is typed and therefore not a finding).
    const names = new Set(found.map((carrier) => carrier.field));
    expect(names.has('icon')).toBe(true);
    expect(names.has('view')).toBe(true);
    expect(names.has('accountStatus')).toBe(true);
    const types = new Set(found.map((carrier) => carrier.type));
    expect(types.has('KnownIconName')).toBe(true);
    expect(types.has('ToastType')).toBe(true);
    expect(types.has('View')).toBe(true);
    expect(types.has('AddressStatus')).toBe(true);
  });

  test('every live carrier came back with a type (a broken reader shows as empty)', () => {
    // This is the multi-line shape's live teeth: `AppLayout.svelte` declares
    // `openView:` with its value on the following lines, and the line-bounded
    // reader measured an EMPTY type there - a carrier the rule could neither
    // check nor flag. A reader that stops at the first newline again fails here.
    const carriers = scanRepositoryCarriers();
    expect(carriers.filter((carrier) => carrier.type === '')).toEqual([]);
    expect(carriers.every((carrier) => carrier.resolvedType.length > 0)).toBe(true);
  });

  test('no carrier is unchecked beyond the boundary exceptions named in the registry', () => {
    const found = scanRepositoryCarriers();
    expect(untypedCarrierFindings(found)).toEqual([]);
    expect(staleVocabularyExceptions(found)).toEqual([]);
  });

  test('every exception names a real file and a live carrier, with a reason', () => {
    const found = scanRepositoryCarriers();
    for (const exception of VOCABULARY_FIELD_EXCEPTIONS) {
      expect(existsSync(join(REPO_ROOT, exception.file))).toBe(true);
      expect(exception.reason.length).toBeGreaterThan(40);
      expect(VOCABULARIES.some((v) => v.id === exception.vocabulary)).toBe(true);
      // The carrier it excuses must really be declared there, or the row is
      // documenting a declaration that no longer exists.
      expect(
        found.some(
          (carrier) => carrier.file === exception.file && carrier.field === exception.field
        )
      ).toBe(true);
    }
  });

  test('every vocabulary-keyed table in the repo declares its key type', () => {
    // The gate's own verdict through the gate's own code path: the icon
    // component's own maps, the view-label table and any future one are checked
    // against their vocabulary's tokens.
    expect(scanRepositoryKeyedTables()).toEqual([]);
    // …and the rule really reads tables in this repo: a green run with zero
    // read tables would be the same silence the brace bug produced.
    const all = scanRepositoryKeyedTables({ includeChecked: true });
    expect(all.filter((table) => table.checked).length).toBeGreaterThan(0);
    expect(all.some((table) => table.matched >= TABLE_MIN_MEMBERS)).toBe(true);
    // …and the evidence itself is live: the memberships the rule reads resolve.
    for (const { vocabulary, members } of readMemberships()) {
      expect(members.size).toBeGreaterThan(2);
      expect(vocabulary.type.length).toBeGreaterThan(2);
    }
  });
});
