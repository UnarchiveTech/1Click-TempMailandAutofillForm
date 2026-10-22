/**
 * Unit tests for the icon-reference gate in scripts/check-icon-references.ts.
 *
 * The gate exists because `Icon`'s `name` prop is deliberately open - the
 * component accepts any string so an app-local composite needs no union edit -
 * and an unknown name renders NOTHING (`if (!svg) return ''`). So a typo, or a
 * name left behind by a catalog rename, is a silently invisible icon: no
 * compiler error, no runtime error, no other gate. The rename to upstream
 * Material Symbols names (`trash` → `delete`, `x` → `close`, `plus` → `add`,
 * `copy` → `contentCopy`) shipped five exactly that way.
 *
 * `catalogNames` is the pure reader of the component's own vocabulary (union +
 * path map + the runtime aliases it installs), `scanText` decides what a
 * reference is, and `diffBaseline` is the ratchet. Fixtures cover each shape and
 * - as importantly - what must NEVER be reported, because a gate that flags a
 * `ToastType` table's values or a comparison operand gets muted. The last
 * describe runs `scanRepository()` against the live tree, so `bun test` fails the
 * moment `bun run audit` would.
 *
 * The gate's second half - an icon FIELD must be declared `KnownIconName`, never
 * `string` or the open `IconName` - is pinned the same way: `scanIconFields`
 * decides what a field is, `isUntypedIconField` decides whether the compiler has
 * anything to check, and the live tree must carry no untyped field beyond the one
 * exception the script names (the provider-config schema's `ui.icon`).
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BASELINE_PATH,
  type BaselineRow,
  catalogNames,
  diffBaseline,
  formatBaseline,
  isFinding,
  parseBaseline,
  readBaseline,
  readCatalog,
  scanIconBindingFindings,
  scanIconBindings,
  scanRepository,
  scanRepositoryIconBindingFindings,
  scanText,
  vocabularyNames,
} from '../../../scripts/check-icon-references';
import { REPO_ROOT } from '../../../scripts/source-files';
import { stripComments } from '../../../scripts/source-lexer';

/** The catalog as a fixture component declares it, mirroring the real shape. */
const COMPONENT = [
  'export type KnownIconName =',
  "  | 'star'",
  "  | 'archive'",
  "  | 'close'",
  "  | 'add';",
  '',
  'const ICONS: Record<string, string> = {',
  "  star: '<svg/>',",
  "  archive: '<svg/>',",
  "  close: '<svg/>',",
  "  add: '<svg/>',",
  '};',
  '',
  '// Runtime alias: a legal reference backed by another entry.',
  'ICONS.legacyStar = ICONS.star;',
  '',
].join('\n');

/**
 * The vocabulary module's shape, as the real one declares it: the union step of
 * the catalog moved here so a plain `.ts` table can type its icon field against
 * it (a `.ts` file cannot import a type out of a `.svelte` file).
 */
const VOCABULARY = [
  'export const KNOWN_ICON_NAMES = [',
  "  'star',",
  "  'archive',",
  "  'chevronDown',",
  '] as const;',
  '',
  'export type KnownIconName = (typeof KNOWN_ICON_NAMES)[number];',
  '',
].join('\n');

/** Names of the unresolved references in a fixture (comments blanked first). */
function unresolved(source: string): string[] {
  const catalog = catalogNames(COMPONENT);
  return scanText(stripComments(source))
    .filter((ref) => isFinding(ref, catalog))
    .map((ref) => ref.name)
    .sort();
}

const rows = (...entries: Array<[string, string, string?]>): BaselineRow[] =>
  entries.map(([file, name, reason]) =>
    reason === undefined ? { file, name } : { file, name, reason }
  );

describe('what the catalog is', () => {
  test('the union, the path map and a runtime alias all count', () => {
    const names = catalogNames(COMPONENT);
    expect([...names].sort()).toEqual(['add', 'archive', 'close', 'legacyStar', 'star']);
  });

  test('the vocabulary module declares what `name` accepts', () => {
    // The union half, read from its own module: the component no longer carries
    // a `| 'name'` list, so reading only the component would lose them.
    expect([...vocabularyNames(VOCABULARY)].sort()).toEqual(['archive', 'chevronDown', 'star']);
    // A name the module admits but the map does not draw is kept - the gate's
    // job is to judge REFERENCES, and the catalog test judges the geometry.
    expect(vocabularyNames(VOCABULARY).has('chevronDown')).toBe(true);
    expect(catalogNames(COMPONENT).has('chevronDown')).toBe(false);
  });

  test('the live vocabulary and the live component together form the catalog', () => {
    const catalog = readCatalog();
    const vocabulary = vocabularyNames(
      readFileSync(join(REPO_ROOT, 'src/ui/components/icons/icon-names.ts'), 'utf8')
    );
    // Not vacuous, and every advertised name resolves.
    expect(vocabulary.size).toBeGreaterThan(60);
    for (const name of vocabulary) expect(catalog.has(name)).toBe(true);
    // The rename targets, both halves of each pair, so the gate can tell a
    // stale name from the catalog's current spelling.
    for (const name of ['close', 'add', 'contentCopy', 'delete', 'notifications', 'barChart']) {
      expect(catalog.has(name)).toBe(true);
    }
    for (const stale of ['trash', 'bell', 'x', 'plus', 'copy', 'alertTriangle']) {
      expect(catalog.has(stale)).toBe(false);
    }
    // `ICONS.gitHub = ICONS.github` is legal even though the vocabulary omits it.
    expect(catalog.has('gitHub')).toBe(true);
  });
});

describe('what a reference is', () => {
  test('an attribute is a reference, single- or double-quoted', () => {
    expect(unresolved('<Icon name="trash" />')).toEqual(['trash']);
    expect(unresolved("<Icon name='trash' />")).toEqual(['trash']);
    expect(unresolved('<Icon name="archive" />')).toEqual([]);
  });

  test('EVERY literal an expression can select is a reference', () => {
    // `name={done ? 'checkCircle' : 'add'}` asks for two names, so both are
    // checked - this is the shape three of the five shipped blanks had.
    expect(unresolved("<Icon name={done ? 'star' : 'trash'} />")).toEqual(['trash']);
    expect(unresolved("<Icon name={done ? 'star' : 'add'} />")).toEqual([]);
  });

  test('a literal an operator COMPARES against is not a reference', () => {
    // The FAB's glyph is guarded by `fabKind === 'createAddress'`; that literal
    // is a fabKind token, not a name this expression hands to `name`.
    const source = "<Icon name={open && kind === 'createAddress' ? 'close' : which} />";
    expect(unresolved(source)).toEqual([]);
  });

  test('a multi-line tag is one reference, not two', () => {
    expect(unresolved('<Icon\n  name="trash"\n  class="w-4 h-4"\n/>')).toEqual(['trash']);
  });

  test('a sibling component whose name starts with Icon is not scanned', () => {
    // `<IconGroup>` has no word boundary after `Icon`, so only the real
    // component is read.
    expect(unresolved('<IconGroup name="trash" />')).toEqual([]);
  });

  test('an icon: property is a reference only in a file that RENDERS Icon', () => {
    const table = "const shortcuts = [{ icon: 'trash', label: 'x' }];";
    expect(unresolved(`${table}\n<Icon name={row.icon} />`)).toEqual(['trash']);
    // A file that only DECLARES a vocabulary is out of scope - which is what
    // keeps `ICON_KEYWORD_MAPPING`'s ToastType values ('bell', 'moon', …) out.
    expect(unresolved(table)).toEqual([]);
  });

  test('comments are not code: a name mentioned in one is not a reference', () => {
    // The lexer blanks comment bodies - including HTML comments, which is what a
    // Svelte file's own comments are.
    expect(unresolved('<!-- was <Icon name="trash" /> here -->\n<Icon name="add" />')).toEqual([]);
    expect(unresolved('// <Icon name="trash" />')).toEqual([]);
    expect(unresolved('/* const x = { icon: "trash" }; */\n<Icon name={x.icon} />')).toEqual([]);
  });

  test('a reference is reported with the line it sits on', () => {
    const refs = scanText('<p>a</p>\n<p>b</p>\n<Icon name="trash" />');
    expect(refs).toEqual([{ name: 'trash', line: 3, kind: 'attribute' }]);
  });

  test('a literal held by a same-file binding is a reference (kind `binding`)', () => {
    // `const glyph = 'trash'` hides the typo from every other shape: the
    // expression carries no literal and there is no table to read.
    expect(scanText("const glyph = 'trash';\n<Icon name={glyph} />")).toEqual([
      { name: 'trash', line: 2, kind: 'binding' },
    ]);
    expect(unresolved("const glyph = 'trash';\n<Icon name={glyph} />")).toEqual(['trash']);
    // The line reported is the CALL SITE, which is where the reader acts.
    expect(unresolved("const glyph = 'add';\n<p>x</p>\n<Icon name={glyph} />")).toEqual([]);
  });

  test('only a literal a binding hands over whole is read', () => {
    // A concatenation or a template is not one name: reading a literal out of
    // it would invent a reference the catalog was never asked for.
    expect(unresolved("const glyph = 'tras' + suffix;\n<Icon name={glyph} />")).toEqual([]);
    expect(unresolved('const glyph = `trash`;\n<Icon name={glyph} />')).toEqual([]);
  });
});

/**
 * A declaration's TYPE rule is not this gate's any more: every carrier of a
 * shared vocabulary - the icon catalog's fields included - is judged by the
 * registry-driven `scripts/check-vocabulary-fields.ts`, whose own suite covers
 * the field shapes (see tests/unit/scripts/check-vocabulary-fields.test.ts).
 * What follows here is the VALUE half plus the one declaration this gate keeps:
 * the same-file local a `name={…}` hands over.
 */

/** The bindings of a fixture, spelled `<name>: <type>` (and `= <literal>`). */
function bindings(source: string): string[] {
  return scanIconBindings(source).map(
    (binding) =>
      `${binding.name}: ${binding.type ?? '?'}${binding.literal ? ` = ${binding.literal}` : ''}`
  );
}

/** The unchecked bindings handed to an `<Icon>`, spelled `name: type @decl->use`. */
function uncheckedBindings(source: string): string[] {
  return scanIconBindingFindings(source).map(
    (finding) => `${finding.name}: ${finding.type} @${finding.line}->${finding.usageLine}`
  );
}

describe('a same-file binding handed to `name`', () => {
  test('what a declaration pins: annotation, `as` cast, `$derived<T>`, literal', () => {
    const source = [
      'const a: string = raw;',
      'let b: KnownIconName = "add";',
      'const c: string;',
      'const d = raw as string;',
      'const e = raw as KnownIconName;',
      'const f = $derived<string>(raw);',
      'const g = $state<string>("");',
      'const h = $derived.by<string>(() => raw);',
      "const i = 'add';",
      "const j = 'add' as const;",
      'const k = raw || "add";',
      'const l = "";',
    ].join('\n');
    expect(bindings(source)).toEqual([
      'a: string',
      // An annotation does not hide the literal: the catalog must have it too.
      'b: KnownIconName = add',
      'c: string',
      'd: string',
      'e: KnownIconName',
      'f: string',
      'g: string',
      'h: string',
      'i: ? = add',
      'j: ? = add',
      'k: ?',
      'l: ?',
    ]);
  });

  test('only a declaration is a binding', () => {
    // Comments and string bodies are not code (the shared lexer blanks them).
    expect(scanIconBindings('// const glyph: string = raw;').length).toBe(0);
    expect(scanIconBindings("const doc = 'const glyph: string = raw';").map((b) => b.name)).toEqual(
      ['doc']
    );
    // A DESTRUCTURED binding is out of scope: its type lives in the annotation
    // object literal, which the field half reads when the name is icon-shaped.
    expect(
      scanIconBindings('let { icon = undefined as KnownIconName | undefined } = $props();').length
    ).toBe(0);
    expect(scanIconBindings('let { glyph }: { glyph?: string } = $props();').length).toBe(0);
    // A member assignment is not a declaration either.
    expect(scanIconBindings('options.icon = raw;').length).toBe(0);
  });

  test('the first declaration of a name is the one resolved', () => {
    expect(bindings('const glyph = "add";\nconst glyph = "trash";')).toEqual([
      'glyph: ? = add',
      'glyph: ? = trash',
    ]);
    // …and the finding goes with the first, which is what a reader scrolling
    // the script meets first.
    expect(
      uncheckedBindings(
        'const glyph: string = raw;\nconst glyph: KnownIconName = "add";\n<Icon name={glyph} />'
      )
    ).toEqual(['glyph: string @1->3']);
  });

  test('`string` and the open `IconName` are findings; inference is not', () => {
    // The widening that defeats the compiler, however it is written.
    for (const [declaration, type] of [
      ['const glyph: string = raw;', 'string'],
      ['let glyph: IconName = raw;', 'IconName'],
      ['let glyph: string;', 'string'],
      ['const glyph = raw as string;', 'string'],
      ['const glyph = raw as IconName;', 'IconName'],
      ['const glyph = $derived<string>(raw);', 'string'],
    ] as const) {
      expect(uncheckedBindings(`${declaration}\n<Icon name={glyph} />`)).toEqual([
        `glyph: ${type} @1->2`,
      ]);
    }
    // Every declaration the compiler CAN follow, or that is not a name at all.
    for (const declaration of [
      'const glyph: KnownIconName = "add";',
      'const glyph = $derived(header.icon);',
      'const glyph = $derived(cond ? "add" : "archive");',
      'const glyph = raw as KnownIconName;',
      "const glyph: 'add' | 'archive' = raw;",
      'const glyph: string[] = [];',
    ]) {
      expect(uncheckedBindings(`${declaration}\n<Icon name={glyph} />`)).toEqual([]);
    }
  });

  test('the binding must actually be handed to an `<Icon>`', () => {
    // A `string` local nobody renders is not this gate's business …
    expect(uncheckedBindings('const glyph: string = raw;')).toEqual([]);
    // …and neither is a name the file does not declare (another module, a
    // global) or one reached as a MEMBER (that is the property rule's half).
    expect(uncheckedBindings('const row: string = raw;\n<Icon name={row.icon} />')).toEqual([]);
    expect(uncheckedBindings('<Icon name={fromAnotherModule} />')).toEqual([]);
    // A ternary or a `||` still hands the binding over.
    expect(
      uncheckedBindings('const glyph: string = raw;\n<Icon name={open ? glyph : "add"} />')
    ).toEqual(['glyph: string @1->2']);
    expect(uncheckedBindings('const glyph: string = raw;\n<Icon name={glyph || "add"} />')).toEqual(
      ['glyph: string @1->2']
    );
    // The declaration and the call site can be in either order.
    expect(uncheckedBindings('<Icon name={glyph} />\nconst glyph: string = raw;')).toEqual([
      'glyph: string @2->1',
    ]);
  });

  test('an annotated binding still contributes its literal as a reference', () => {
    // Both verdicts are real: the annotation defeats the compiler, and the
    // literal is a name the catalog must have.
    const source = "const glyph: string = 'trash';\n<Icon name={glyph} />";
    expect(uncheckedBindings(source)).toEqual(['glyph: string @1->2']);
    expect(unresolved(source)).toEqual(['trash']);
  });
});

describe('against the live tree: bindings handed to an `<Icon>`', () => {
  test('a real local is resolved through a real call site', () => {
    // `Header.svelte` renders `<Icon name={effectivePageIcon} />` and declares
    // that local itself, so this ties both halves of the binding reader to a
    // live call site: if either stops matching, this test fails rather than the
    // verdict below going quietly empty.
    const text = readFileSync(join(REPO_ROOT, 'src/ui/blocks/layout/Header.svelte'), 'utf8');
    expect(text).toContain('<Icon name={effectivePageIcon}');
    const binding = scanIconBindings(text).find((row) => row.name === 'effectivePageIcon');
    expect(binding?.line).toBeGreaterThan(0);
    // It is inferred from typed sources (`pageIcon` is `KnownIconName`), which
    // is exactly the shape the compiler follows and the gate stays quiet about.
    expect(binding?.type).toBeUndefined();
    expect(scanIconBindingFindings(text)).toEqual([]);
  });

  test('no unchecked binding is handed to an `<Icon>`', () => {
    // The gate's own verdict on the live tree, through the gate's own code
    // path - a regression here is what `bun run audit` would report.
    expect(scanRepositoryIconBindingFindings()).toEqual([]);
    expect(scanRepository().some((ref) => ref.kind === 'binding')).toBe(false);
  });
});

describe('the baseline ratchet', () => {
  test('parse -> format -> parse is stable, sorted, and keeps reasons', () => {
    const original = rows(
      ['src/b.svelte', 'second'],
      ['src/a.svelte', 'first', 'add upstream `visibility`']
    );
    expect(parseBaseline(formatBaseline(original))).toEqual([
      { file: 'src/a.svelte', name: 'first', reason: 'add upstream `visibility`' },
      { file: 'src/b.svelte', name: 'second' },
    ]);
    // The `#` is cosmetic: a hand-written row and a regenerated one read alike.
    expect(parseBaseline('src/a.svelte\ttrash\tadd upstream `delete`\n')[0]?.reason).toBe(
      'add upstream `delete`'
    );
  });

  test('comments and blank lines are ignored, and a malformed row exempts nothing', () => {
    expect(parseBaseline('# header\n\nsrc/a.svelte\ttrash\n')).toEqual([
      { file: 'src/a.svelte', name: 'trash' },
    ]);
    // A row missing its name parses to nothing, so the reference it meant stays
    // a finding and is reported as NEW rather than silently excused.
    expect(parseBaseline('src/a.svelte\n')).toEqual([]);
  });

  test('a new finding is a violation; a row whose reference was fixed is stale', () => {
    const baseline = rows(['src/a.svelte', 'kept'], ['src/b.svelte', 'fixed']);
    const current = rows(['src/a.svelte', 'kept'], ['src/c.svelte', 'new']);
    const { added, stale } = diffBaseline(current, baseline);
    expect(added).toEqual([{ file: 'src/c.svelte', name: 'new' }]);
    expect(stale).toEqual([{ file: 'src/b.svelte', name: 'fixed' }]);
  });

  test('the reason is not part of a row’s identity', () => {
    const { added, stale } = diffBaseline(
      rows(['src/a.svelte', 'trash', 'reworded reason']),
      rows(['src/a.svelte', 'trash', 'original reason'])
    );
    expect(added).toEqual([]);
    expect(stale).toEqual([]);
  });
});

describe('against the live repository', () => {
  const catalog = readCatalog();
  const refs = scanRepository();
  const findings = refs.filter((ref) => isFinding(ref, catalog));

  test('the scanner reads the tree it claims to (it is not vacuously green)', () => {
    // Hundreds of references exist; a scanner that matched nothing would pass
    // every other assertion here.
    expect(refs.length).toBeGreaterThan(100);
    expect(refs.every((ref) => ref.file.startsWith('src/'))).toBe(true);
    expect(refs.every((ref) => ref.name.length > 0)).toBe(true);
    expect(refs.every((ref) => ref.line > 0)).toBe(true);
    // All three shapes are exercised by real call sites.
    const kinds = new Set(refs.map((ref) => ref.kind));
    expect(kinds.has('attribute')).toBe(true);
    expect(kinds.has('expression')).toBe(true);
    expect(kinds.has('property')).toBe(true);
  });

  test('renamed references and the shared dismiss icon resolve', () => {
    const inFile = (file: string) => refs.filter((ref) => ref.file === file).map((ref) => ref.name);
    // Surviving direct references resolve; shared close controls use IconButton.
    expect(catalog.has('close')).toBe(true);
    expect(inFile('src/ui/blocks/overlays/KeyboardShortcutsCheatSheet.svelte')).toContain('add');
    expect(inFile('src/ui/views/settings/DiagnosticsView.svelte')).toContain('barChart');
    for (const [file, name] of [
      ['src/ui/blocks/overlays/KeyboardShortcutsCheatSheet.svelte', 'plus'],
      ['src/ui/views/settings/DiagnosticsView.svelte', 'chart'],
    ] as const) {
      expect(refs.some((ref) => ref.file === file && ref.name === name)).toBe(false);
    }
  });

  test('the live tree has no finding beyond the baseline, and no stale row', () => {
    // The gate's own verdict, through the gate's own code path - a regression
    // here is the same failure `bun run audit` would report. With the ledger
    // EMPTY (every reference resolves today) an empty `added` is the strong
    // claim, not a vacuous one: the live tree carries no undefined reference.
    const baseline = readBaseline();
    const current: BaselineRow[] = findings.map((ref) => ({ file: ref.file, name: ref.name }));
    const { added, stale } = diffBaseline(current, baseline);
    expect(added).toEqual([]);
    expect(stale).toEqual([]);
    expect(findings).toEqual([]);
  });

  test('every baseline row is a real file and says why it is there', () => {
    const baseline = readBaseline();
    for (const row of baseline) {
      expect(existsSync(join(REPO_ROOT, row.file))).toBe(true);
      expect(readFileSync(join(REPO_ROOT, row.file), 'utf8')).toContain(row.name);
      // A row is an exception that has to be justified: the why column names the
      // upstream glyph that retires it, or the reason it cannot be retired. A row
      // with no why at all reads as unexamined debt, so it fails here.
      expect((row.reason ?? '').length).toBeGreaterThan(10);
    }
    expect(existsSync(BASELINE_PATH)).toBe(true);
  });
});
