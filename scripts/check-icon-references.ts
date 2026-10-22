/**
 * check-icon-references.ts - flags an `<Icon>` reference the catalog does not
 * define.
 *
 * WHY. `Icon`'s `name` prop is deliberately open (`IconName = KnownIconName |
 * (string & Record<never, never>)`) so an app-local composite can be added
 * without a union edit - and an unknown name renders NOTHING (`if (!svg)
 * return ''`). So a typo, or a name left behind by a catalog rename, is a
 * silently blank glyph: no compiler error, no runtime error, no gate. The
 * catalog rename that took `trash` → `delete`, `bell` → `notifications`,
 * `x` → `close`, `plus` → `add` and `copy` → `contentCopy` left five call
 * sites behind exactly that way - three of them in the new onboarding
 * checklist, one in the shortcuts cheat sheet, one in the diagnostics perf
 * panel - and every one of them rendered an invisible icon.
 *
 * WHAT IT CHECKS. Three shapes, all of which name a catalog entry literally:
 *
 *   1. `<Icon … name="…">` and `<Icon … name={…}>` - the attribute, or every
 *      string literal inside the expression (`name={done ? 'checkCircle' :
 *      'add'}` is two references, and both must exist).
 *   2. an `icon:` / `iconName:` property literal, in a file that RENDERS
 *      `<Icon>` - the same-file metadata table a template drives through
 *      `name={row.icon}` (the cheat sheet's `fixedShortcuts`, the settings
 *      tag list). Files that only DECLARE a vocabulary are out of scope, which
 *      is what keeps this gate quiet about `ICON_KEYWORD_MAPPING`, whose
 *      values are `ToastType` members (`'bell'`, `'moon'`, …) fed to Toast -
 *      a different vocabulary that happens to share the word.
 *   3. a string literal that reaches `name` through a SAME-FILE BINDING:
 *      `const glyph = 'trash'; … <Icon name={glyph} />`. Shapes 1 and 2 both
 *      miss it - the expression carries no literal, and there is no table -
 *      yet the glyph is exactly as invisible to the compiler as a typo in the
 *      attribute, because `name` accepts any string.
 *
 * The catalog is read from the component itself (its `KnownIconName` union and
 * its path map), plus any runtime alias it installs (`ICONS.gitHub =
 * ICONS.github`), so adding a glyph to `Icon.svelte` is all it takes to make it
 * a legal reference here - the gate can never disagree with the component it
 * guards.
 *
 * AND THE WITHIN-FILE LOCAL - `name={someVar}` where `someVar` is declared HERE.
 *
 * Shapes 1-3 all see a name written at the call site. This shape closes the last
 * same-file indirection: a bare identifier handed to `name` is resolved against
 * the file's own `const` / `let` / `var` declarations, and the declaration's
 * type decides whether the compiler has anything to check.
 *
 *   - `const glyph: string = …` / `: IconName` / `= $derived<string>(…)` /
 *     `= raw as string` - a FINDING. This is the widening that defeats the
 *     compiler: `string` accepts a typo, and `IconName` is the open union the
 *     component's own prop uses. The fix is a declaration that names the
 *     catalog (`const glyph: KnownIconName = narrow(raw)`), which makes the
 *     compiler reject the next typo.
 *   - no annotation at all (`const glyph = $derived(header.icon)`) - no finding:
 *     the type is inferred from sources that are themselves typed, so the
 *     compiler sees the whole chain.
 *   - an annotated `KnownIconName`, or a literal initializer - no typing finding;
 *     the literal is checked against the catalog like any other reference
 *     (shape 3).
 *
 * THE DECLARATION HALF (fields, props, parameters, and tables keyed by the
 * vocabulary) IS NOT HERE. It is generalized in
 * `scripts/check-vocabulary-fields.ts`, which reads every shared vocabulary from
 * `scripts/shared-vocabularies.ts` - the icon catalog among them, so a FIELD
 * that carries an icon name is judged by exactly the same rule, and against
 * exactly the same tokens, as one that carries a view id. `ICON_VOCABULARY`
 * below is that registry entry, which is what keeps this gate's binding half and
 * that gate's field half from disagreeing about what counts as unchecked.
 *
 * WHAT IT CANNOT SEE (stated, because the gate is a ratchet, not a proof)
 *
 *  - **A name that arrives from another module.** `name={someTable.icon}` is
 *    resolved only when the table lives in the same file as the `<Icon>`. The
 *    fix for a shared table is to type its field as `KnownIconName`, which makes
 *    the compiler the gate for that table's values - and which
 *    `check-vocabulary-fields` requires every such table to do.
 *  - **A binding whose type the file does not write down.** A `$props()`
 *    destructuring (`let { glyph }: { glyph?: string } = $props()`) is judged by
 *    the field rule, which reads the annotation object literal - so a prop named
 *    `icon` / `iconName` / `…Icon` is covered there; one named something else is
 *    not. Likewise `= computeGlyph()` (the type lives in another file's
 *    signature) and a second binding of the same name further down the script
 *    (the first declaration is the one resolved).
 *  - **A computed name.** `name={prefix + 'Star'}` has no literal to check.
 *  - **References outside `src`.** A visual probe under `tests/` or a one-off
 *    script that queries a rendered glyph by name is not scanned; the names it
 *    queries are the ones this gate already proves exist.
 *
 * Ratchet: `scripts/baselines/icon-reference.txt` lists `<path><TAB><name><TAB># why` rows
 * for the reviewed exceptions - a reference whose glyph the catalog does not
 * ship yet (an upstream name that must be added with its real path, not
 * guessed). It is PRESERVED across `--update` rather than regenerated, because
 * a row's reason is the one thing a regeneration cannot reconstruct. A new
 * finding fails the build, and a row whose reference was fixed also fails, so
 * the list may only shrink.
 *
 * No declaration half of this gate has a baseline: a field is judged by the
 * vocabulary gate (whose exceptions are named in the registry) and a local by
 * this one, and in both cases the fix is a declaration that names the catalog.
 *
 * Usage:
 *   bun scripts/check-icon-references.ts            # gate (exit 1 on findings)
 *   bun scripts/check-icon-references.ts --list     # every reference + verdict
 *   bun scripts/check-icon-references.ts --update   # rewrite the baseline
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { isUntypedType, normalizeType, vocabularyById } from './shared-vocabularies';
import { collectAbsoluteFiles, REPO_ROOT } from './source-files';
import { analyzeSource, stripComments } from './source-lexer';

const SRC_DIR = join(REPO_ROOT, 'src');
const ICON_COMPONENT = join(REPO_ROOT, 'src/ui/components/icons/Icon.svelte');
/** The vocabulary module - where the union now lives (see its header). */
const ICON_VOCABULARY = join(REPO_ROOT, 'src/ui/components/icons/icon-names.ts');
export const BASELINE_PATH = join(REPO_ROOT, 'scripts', 'baselines', 'icon-reference.txt');

/**
 * How a reference names the icon.
 *
 * `binding` is the one shape whose literal is not written beside the `<Icon>`:
 * it sits in a same-file `const` / `let` / `var` initializer that the tag's
 * `name={…}` hands over (see `scanIconBindings`).
 */
export type IconRefKind = 'attribute' | 'expression' | 'property' | 'binding';

export interface IconReference {
  /** The name the call site asks for. */
  name: string;
  /** 1-based line of the reference, in the file. */
  line: number;
  kind: IconRefKind;
}

/** One baseline row: a reviewed reference whose glyph is not in the catalog. */
export type BaselineRow = { file: string; name: string; reason?: string };

/**
 * The vocabulary the `KNOWN_ICON_NAMES` array declares - what `name` ACCEPTS.
 *
 * Read from its own module rather than from the component, because that is where
 * the component gets it (Icon.svelte re-exports the type from here) and because
 * a `.ts` metadata table is typed against exactly this list. The gate and the
 * compiler therefore agree on one declaration.
 */
export function vocabularyNames(moduleText: string): Set<string> {
  const names = new Set<string>();
  const array = /export const KNOWN_ICON_NAMES = \[([\s\S]*?)\] as const/.exec(moduleText);
  for (const match of (array?.[1] ?? '').matchAll(/'([A-Za-z0-9_]+)'/g)) {
    if (match[1]) names.add(match[1]);
  }
  return names;
}

/**
 * What the component itself DRAWS: its path map's keys plus the runtime aliases
 * (`ICONS.gitHub = ICONS.github`) it installs, which are legal references backed
 * by another entry. A name in the map but not the vocabulary is a defect the
 * vocabulary half cannot see, which is why both are read.
 *
 * The key class includes `_`: excluding it silently skipped the two
 * underscore-named entries (`mark_email_read` / `mark_email_unread`).
 */
export function catalogNames(componentText: string): Set<string> {
  const names = new Set<string>();
  for (const match of componentText.matchAll(/^ {2}\| '([A-Za-z0-9_]+)'$/gm)) {
    if (match[1]) names.add(match[1]);
  }
  for (const match of componentText.matchAll(/^ {2}([A-Za-z0-9_]+):/gm)) {
    if (match[1]) names.add(match[1]);
  }
  for (const match of componentText.matchAll(/\bICONS\.([A-Za-z0-9_]+)\s*=\s*ICONS\./g)) {
    if (match[1]) names.add(match[1]);
  }
  return names;
}

/**
 * The `<Icon …>` tag that starts at `start`, by walking to the `>` that closes
 * it - brace- and quote-aware, so `name={done ? 'add' : 'check'}` and a
 * multi-line attribute list are one tag rather than two.
 */
function readTag(text: string, start: number): { tag: string; end: number } {
  let braceDepth = 0;
  let quote: string | null = null;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i] ?? '';
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') braceDepth += 1;
    else if (ch === '}') braceDepth = Math.max(0, braceDepth - 1);
    else if (ch === '>' && braceDepth === 0) return { tag: text.slice(start, i + 1), end: i + 1 };
  }
  return { tag: text.slice(start), end: text.length };
}

/**
 * The literals one `{…}` expression can SELECT - `{a ? 'x' : 'y'}` yields x and
 * y, while `{open && kind === 'createAddress' ? 'chevronDown' : icon}` yields
 * only chevronDown: the literal an operator COMPARES against is a vocabulary
 * token on the other side of the comparison, not a value this expression can
 * hand to `name`. (That exact shape - a `fabKind === 'createAddress'` guard in
 * front of the FAB's glyph - is why this rule exists.)
 */
function literalsIn(expression: string): string[] {
  const found: string[] = [];
  for (const match of expression.matchAll(/'([A-Za-z0-9_-]*)'|"([A-Za-z0-9_-]*)"/g)) {
    const value = match[1] ?? match[2] ?? '';
    if (!value || match.index === undefined) continue;
    if (/(?:===|!==|==|!=)\s*$/.test(expression.slice(0, match.index))) continue;
    found.push(value);
  }
  return found;
}

function lineAt(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

/** Every `<Icon …>` tag in a file, as text, with where it starts. */
function iconTags(text: string): Array<{ tag: string; index: number }> {
  const tags: Array<{ tag: string; index: number }> = [];
  for (const start of text.matchAll(/<Icon\b/g)) {
    if (start.index === undefined) continue;
    tags.push({ tag: readTag(text, start.index).tag, index: start.index });
  }
  return tags;
}

/**
 * Every `name={…}` expression in a file's `<Icon>` tags, with its line.
 *
 * Shared by the two readers of that expression - the literals it can select
 * (shape 1) and the same-file identifiers it hands over (shapes 3 and 4) - so
 * the two can never disagree about where a `<Icon>` tag's expression ends.
 */
function nameExpressions(text: string): Array<{ expression: string; line: number }> {
  const found: Array<{ expression: string; line: number }> = [];
  for (const { tag, index } of iconTags(text)) {
    const expression = /(?:^|\s)name\s*=\s*\{([\s\S]*?)\}(?=\s|\/>|>)/.exec(tag);
    if (expression?.[1]) found.push({ expression: expression[1], line: lineAt(text, index) });
  }
  return found;
}

/**
 * The bare identifiers an expression hands over.
 *
 * A MEMBER is not one: in `name={row.icon}` the glyph comes from `row`, and
 * whether `row` is a table this file declares is the property rule's business
 * (shape 2) - resolving `row` itself would be meaningless. Keywords (`null`,
 * `undefined`, `as`, `true`, …) are not identifiers here either.
 */
function identifiersIn(expression: string): string[] {
  const found: string[] = [];
  for (const match of expression.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) {
    const index = match.index ?? 0;
    const after = index + match[0].length;
    if (expression[index - 1] === '.' || expression[after] === '.') continue;
    if (EXPRESSION_KEYWORDS.has(match[0])) continue;
    found.push(match[0]);
  }
  return found;
}

/** Tokens that look like identifiers in an expression but name nothing. */
const EXPRESSION_KEYWORDS = new Set([
  'true',
  'false',
  'null',
  'undefined',
  'this',
  'as',
  'typeof',
  'in',
  'instanceof',
  'new',
  'void',
]);

/**
 * Every icon reference in one file's (comment-stripped) source.
 *
 * `rendersIcon` gates the property rule: only a file that actually renders the
 * component is judged on its `icon:` metadata, which is what keeps a
 * `ToastType` table out of scope.
 */
export function scanText(text: string): IconReference[] {
  const refs: IconReference[] = [];
  const rendersIcon = /<Icon\b/.test(text);
  // Only a file that renders the component can hand a binding over.
  const bindings = rendersIcon ? bindingsByName(text) : new Map<string, IconBinding>();

  for (const { tag, index } of iconTags(text)) {
    const attribute = /(?:^|\s)name\s*=\s*"([A-Za-z0-9_-]*)"/.exec(tag);
    if (attribute?.[1]) {
      refs.push({ name: attribute[1], line: lineAt(text, index), kind: 'attribute' });
    } else {
      const single = /(?:^|\s)name\s*=\s*'([A-Za-z0-9_-]*)'/.exec(tag);
      if (single?.[1]) {
        refs.push({ name: single[1], line: lineAt(text, index), kind: 'attribute' });
      }
    }
  }

  // Shape 3, plus the literals the expression itself can select (shape 1):
  // both read the same `name={…}` expression, so neither can disagree about
  // where a tag's expression ends.
  for (const { expression, line } of nameExpressions(text)) {
    for (const name of literalsIn(expression)) {
      refs.push({ name, line, kind: 'expression' });
    }
    for (const identifier of identifiersIn(expression)) {
      const literal = bindings.get(identifier)?.literal;
      if (literal) refs.push({ name: literal, line, kind: 'binding' });
    }
  }

  if (rendersIcon) {
    for (const match of text.matchAll(
      /(?:^|[\s,({])(?:icon|iconName)\s*:\s*'([A-Za-z0-9_-]+)'|(?:^|[\s,({])(?:icon|iconName)\s*:\s*"([A-Za-z0-9_-]+)"/gm
    )) {
      const name = match[1] ?? match[2];
      if (name && match.index !== undefined) {
        refs.push({ name, line: lineAt(text, match.index), kind: 'property' });
      }
    }
  }

  return refs;
}

export type RepoReference = IconReference & { file: string };

/**
 * The live catalog: the vocabulary module's names (what `name` accepts) plus the
 * component's own path keys and aliases (what it actually draws).
 */
export function readCatalog(): Set<string> {
  const names = vocabularyNames(readFileSync(ICON_VOCABULARY, 'utf8'));
  for (const name of catalogNames(readFileSync(ICON_COMPONENT, 'utf8'))) names.add(name);
  return names;
}

/**
 * Every icon reference in `src` - resolved and unresolved alike. The verdict is
 * `isFinding`, exactly as `scanRepository`/`isFinding` split in the sibling
 * gates: a scanner that only returned findings could be green while reading
 * nothing, and the live tests below assert this list is not empty for that
 * reason.
 */
export function scanRepository(): RepoReference[] {
  const refs: RepoReference[] = [];
  for (const file of collectAbsoluteFiles(SRC_DIR, ['.ts', '.svelte'])) {
    const repoPath = relative(REPO_ROOT, file).replace(/\\/g, '/');
    for (const ref of scanText(stripComments(readFileSync(file, 'utf8')))) {
      refs.push({ ...ref, file: repoPath });
    }
  }
  return refs;
}

/** Is this reference a name the catalog cannot resolve (an invisible glyph)? */
export function isFinding(ref: IconReference, catalog: ReadonlySet<string>): boolean {
  return !catalog.has(ref.name);
}

// ── The icon vocabulary's DECLARATION rules live in the general gate ────────
//
// A FIELD that carries an icon name must be declared `KnownIconName` - and so
// must a carrier of every other shared vocabulary (`View`, `ActivityViewId`, …).
// That half belongs to one registry rather than to this file:
// `scripts/shared-vocabularies.ts` names each vocabulary (its union, the field
// names that carry it, the tokens that defeat the compiler, its runtime
// validator) and `scripts/check-vocabulary-fields.ts` enforces it for all of
// them, so a new vocabulary is a registry entry rather than a new scanner.
//
// What stays HERE is the half this gate owns: the VALUES a call site names - the
// `name` attribute, the literals an expression selects, the `icon:` table
// literal, and the same-file binding a `name={…}` hands over. `ICON_VOCABULARY`
// is the registry entry those bindings are judged against, so the two halves
// cannot disagree about what counts as unchecked.

const ICON_VOCAB = vocabularyById('icon');

// ── Icon BINDINGS: the same-file local a call site hands over ────────────────

/**
 * A same-file `const` / `let` / `var` a `<Icon name={…}>` in the same file can
 * hand over, with what its declaration says about the value.
 *
 * The field-name rule does not apply here: `glyph`, `localGlyphPlain` and
 * `fabIcon` are all in scope, because what identifies a binding as icon-bearing
 * is not its NAME - it is the `<Icon name={…}>` that hands it over.
 */
export interface IconBinding {
  /** The identifier: `glyph`, `fabIcon`, … */
  name: string;
  /**
   * The type the declaration PINS the value to, whitespace-normalized - its
   * annotation, an `as <T>` cast on the initializer, or a `$derived<T>` /
   * `$state<T>` type argument. Absent when the declaration leaves the type to
   * inference, which is judged differently (the inferred sources are typed).
   */
  type?: string;
  /** A bare string-literal initializer (`const glyph = 'trash'`). */
  literal?: string;
  /** 1-based line of the declaration. */
  line: number;
}

/** A same-file binding handed to `name` that the compiler has nothing to check. */
export interface IconBindingFinding {
  /** The identifier, as the `<Icon>` names it. */
  name: string;
  /** The declared type that defeats the compiler (`string`, `IconName`, …). */
  type: string;
  /** 1-based line of the declaration. */
  line: number;
  /** 1-based line of the `<Icon name={…}>` that hands the binding over. */
  usageLine: number;
}

/** An {@link IconBindingFinding} with the file it was declared in. */
export type RepoIconBindingFinding = IconBindingFinding & { file: string };

/**
 * A declaration. The type group is GREEDY so it reaches the `=` (a lazy one
 * would stop at the empty match and never see the annotation at all), and every
 * group stops at `;` / newline so a declaration cannot swallow the statement
 * after it.
 */
const DECLARATOR =
  /\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::\s*([^=;\n]*))?(?:=\s*([^;\n]*))?/g;
/** `x as KnownIconName` - the type an initializer pins by assertion. */
const AS_CAST = /\bas\s+([^;\n]+?)\s*$/;
/** `$derived<T>(…)` / `$derived.by<T>(…)` / `$state<T>(…)`. */
const GENERIC_CALL = /^\$(?:derived(?:\.by)?|state)\s*<\s*([^>]+?)\s*>/;
/** Exactly a quoted string, optionally `as const` - not a concatenation. */
const BARE_LITERAL = /^['"]([A-Za-z0-9_-]*)['"]\s*(?:as\s+const)?$/;

/** The type an initializer pins by assertion (`x as T`) or type argument. */
function pinnedType(initializer: string): string | undefined {
  const cast = AS_CAST.exec(initializer);
  const castType = cast?.[1] ? normalizeType(cast[1]) : '';
  // `x as const` is a WIDENING, not a declared type - it pins nothing.
  if (castType && castType !== 'const') return castType;
  const generic = GENERIC_CALL.exec(initializer);
  return generic?.[1] ? normalizeType(generic[1]) : undefined;
}

/**
 * The literal a declaration assigns, when it assigns exactly one.
 *
 * Deliberately strict: `'a' + suffix` and `` `${prefix}Icon` `` are not one
 * name, so reading a literal out of them would invent a reference. A bare
 * literal hands the value over whole, which is the case shape 3 exists for.
 */
function bareLiteral(initializer: string): string | undefined {
  return BARE_LITERAL.exec(initializer)?.[1] || undefined;
}

/**
 * Every `const` / `let` / `var` declaration in one file (comments blanked
 * through the shared lexer, so a declaration quoted in prose or in a string body
 * is not a declaration).
 */
export function scanIconBindings(source: string): IconBinding[] {
  const { code, inCode } = analyzeSource(source);
  const bindings: IconBinding[] = [];
  for (const match of code.matchAll(DECLARATOR)) {
    const name = match[1];
    if (!name || match.index === undefined) continue;
    const at = match.index + match[0].indexOf(name);
    if (!inCode[at]) continue;
    const initializer = match[3]?.trim() ?? '';
    const annotation = match[2] ? normalizeType(match[2]) : undefined;
    const literal = bareLiteral(initializer);
    const type = annotation || pinnedType(initializer);
    bindings.push({
      name,
      ...(type ? { type } : {}),
      ...(literal ? { literal } : {}),
      line: lineAt(code, at),
    });
  }
  return bindings;
}

/**
 * The file's bindings by identifier - the FIRST declaration of a name wins, so
 * a later shadow of the same name is not resolved (a documented boundary: the
 * gate reads the declaration a reader meets while scrolling the script).
 */
function bindingsByName(text: string): Map<string, IconBinding> {
  const map = new Map<string, IconBinding>();
  for (const binding of scanIconBindings(text)) {
    if (!map.has(binding.name)) map.set(binding.name, binding);
  }
  return map;
}

/**
 * Same-file bindings handed to a `name={…}` whose declared type is unchecked -
 * the widening that defeats the compiler (`string`, the open `IconName`).
 *
 * A declaration that pins `KnownIconName`, or leaves the type to inference from
 * typed sources, is NOT a finding: those are the two shapes the compiler can
 * follow to the catalog. There is deliberately no baseline for this verdict
 * (mirroring the field half): the fix is a declaration that names the catalog,
 * and a ledger row would let the next one be added quietly.
 */
export function scanIconBindingFindings(source: string): IconBindingFinding[] {
  const bindings = bindingsByName(source);
  const findings: IconBindingFinding[] = [];
  for (const { expression, line } of nameExpressions(source)) {
    for (const identifier of identifiersIn(expression)) {
      const binding = bindings.get(identifier);
      if (!binding?.type || !isUntypedType(binding.type, ICON_VOCAB)) continue;
      findings.push({ name: identifier, type: binding.type, line: binding.line, usageLine: line });
    }
  }
  return findings;
}

/** Every unchecked binding handed to an `<Icon>` anywhere in `src`. */
export function scanRepositoryIconBindingFindings(): RepoIconBindingFinding[] {
  const findings: RepoIconBindingFinding[] = [];
  for (const file of collectAbsoluteFiles(SRC_DIR, ['.ts', '.svelte'])) {
    const repoPath = relative(REPO_ROOT, file).replace(/\\/g, '/');
    for (const finding of scanIconBindingFindings(stripComments(readFileSync(file, 'utf8')))) {
      findings.push({ ...finding, file: repoPath });
    }
  }
  return findings;
}

export function readBaseline(): BaselineRow[] {
  return existsSync(BASELINE_PATH) ? parseBaseline(readFileSync(BASELINE_PATH, 'utf8')) : [];
}

export function parseBaseline(text: string): BaselineRow[] {
  const rows: BaselineRow[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [file, name, ...rest] = trimmed.split('\t');
    if (!file || !name) continue;
    const reason = rest.join('\t').trim().replace(/^#\s*/, '');
    rows.push(reason ? { file, name, reason } : { file, name });
  }
  return rows;
}

export function formatBaseline(rows: readonly BaselineRow[]): string {
  return `${[...rows]
    .sort((a, b) => `${a.file}\t${a.name}`.localeCompare(`${b.file}\t${b.name}`))
    .map((row) => `${row.file}\t${row.name}${row.reason ? `\t# ${row.reason}` : ''}`)
    .join('\n')}\n`;
}

export function diffBaseline(
  findings: readonly BaselineRow[],
  baseline: readonly BaselineRow[]
): { added: BaselineRow[]; stale: BaselineRow[] } {
  const key = (row: BaselineRow) => `${row.file}\t${row.name}`;
  const listed = new Set(baseline.map(key));
  const found = new Set(findings.map(key));
  return {
    added: findings.filter((row) => !listed.has(key(row))),
    stale: baseline.filter((row) => !found.has(key(row))),
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const BASELINE_HEADER = `# Icon-reference baseline - a ratchet: rows may only disappear.
# Format: <path><TAB><icon name>[<TAB># why]
# Each row is a reference to a glyph the catalog in
# src/ui/components/icons/Icon.svelte does not define, so it renders NOTHING
# (see scripts/check-icon-references.ts). A row is either a rename that was
# missed (map it to the catalog's current name) or a glyph that must still be
# added with its real upstream path - and the why column must say which, which
# --update preserves. A new finding that is not listed here fails the gate, and
# a row whose reference was fixed also fails, so the list can only shrink.
#
# This ledger is currently EMPTY: every reference in the repo resolves. A row is
# owed only when a glyph genuinely has no catalog entry AND adding one is not the
# fix (no upstream glyph matches, or the call site is being retired) - a missing
# upstream glyph is fixed by adding it to Icon.svelte with its real Material
# Symbols path, not by a row here. When a row is unavoidable, its why column must
# name the upstream glyph that retires it or the reason it cannot be retired.
#
# This ledger holds UNDEFINED REFERENCES only - the values a call site names. The
# DECLARATION halves (an icon FIELD, or a same-file local, declared \`string\` /
# the open \`IconName\` instead of \`KnownIconName\`) have NO baseline on purpose,
# so a new table or local cannot be added untyped and then excused with a row:
# fields are judged by scripts/check-vocabulary-fields.ts (the icon vocabulary is
# registered there, and its single exception - the provider-config schema's
# \`ui.icon\` - is named in VOCABULARY_FIELD_EXCEPTIONS in
# scripts/shared-vocabularies.ts), while a local handed to \`name={…}\` is judged
# by this gate and can only be fixed by naming the catalog. A literal that reaches
# \`name\` through a binding IS a reference (kind \`binding\`) and is listed here
# like any other.
#
# Refresh (after shrinking) with:
#   bun scripts/check-icon-references.ts --update
`;

function main(): void {
  const update = process.argv.includes('--update');
  const list = process.argv.includes('--list');

  const catalog = readCatalog();
  const findings = scanRepository().filter((ref) => isFinding(ref, catalog));
  const bindings = scanRepositoryIconBindingFindings();

  if (list) {
    const rows = readBaseline();
    const listed = new Set(rows.map((row) => `${row.file}\t${row.name}`));
    for (const ref of findings) {
      const verdict = listed.has(`${ref.file}\t${ref.name}`) ? 'BASELINED' : 'NEW';
      console.log(`${ref.file}:${ref.line}\t[${verdict}] ${ref.name} (${ref.kind})`);
    }
    console.log(
      `\nCatalog: ${catalog.size} name(s). References the catalog rejects: ` +
        `${findings.length} (${rows.length} baselined).`
    );
    console.log(`\nIcon bindings handed to <Icon name={…}> (${bindings.length} unchecked):`);
    for (const finding of bindings) {
      console.log(
        `${finding.file}:${finding.line}\t[UNTYPED] ${finding.name}: ${finding.type} ` +
          `(handed over at line ${finding.usageLine})`
      );
    }
    return;
  }

  const baseline = readBaseline();
  const reasonByKey = new Map(baseline.map((row) => [`${row.file}\t${row.name}`, row.reason]));
  const rows: BaselineRow[] = findings.map((ref) => {
    const reason = reasonByKey.get(`${ref.file}\t${ref.name}`);
    return reason ? { file: ref.file, name: ref.name, reason } : { file: ref.file, name: ref.name };
  });
  const { added, stale } = diffBaseline(rows, baseline);

  if (update) {
    writeFileSync(BASELINE_PATH, BASELINE_HEADER + formatBaseline(rows));
    console.log(
      `icon-reference baseline updated: ${rows.length} row(s) ` +
        `(${stale.length} removed, ${added.length} added).`
    );
    // `--update` owns the reference ledger only - it must not become a way to
    // leave the gate green while an unchecked binding is still a finding.
    if (bindings.length > 0) {
      console.error(
        `\n${bindings.length} unchecked icon binding(s) remain - \`--update\` cannot fix ` +
          'those. Run the gate without --update to see them.'
      );
      process.exit(1);
    }
    return;
  }

  if (added.length > 0) {
    console.error(`Icon reference(s) the catalog does not define (${added.length} new):`);
    for (const row of added) {
      for (const ref of findings.filter((f) => f.file === row.file && f.name === row.name)) {
        console.error(`  ${row.file}:${ref.line}  ${ref.name} (${ref.kind})`);
      }
    }
    console.error(
      '\nAn unknown name renders NOTHING (Icon returns an empty string), so this\n' +
        'is an invisible icon rather than a failed build. Either:\n' +
        '  - use the catalog’s current spelling of the glyph (a rename such as\n' +
        '    `trash` → `delete`, `x` → `close`, `plus` → `add`, `copy` →\n' +
        '    `contentCopy`), or\n' +
        '  - add the glyph to src/ui/components/icons/Icon.svelte with its real\n' +
        '    upstream Material Symbols path (a name the icon-catalog test accepts).\n' +
        'Never silence a finding by adding a row: read the catalog first.'
    );
  }

  if (stale.length > 0) {
    console.error(`\nStale baseline row(s) - these references now resolve (${stale.length}):`);
    for (const row of stale) console.error(`  ${row.file}\t${row.name}`);
    console.error('Run `bun scripts/check-icon-references.ts --update` to drop them.');
  }

  if (bindings.length > 0) {
    console.error(
      `\nBinding(s) handed to an <Icon> with a type the compiler cannot check (${bindings.length}):`
    );
    for (const finding of bindings) {
      console.error(
        `  ${finding.file}:${finding.line}  ${finding.name}: ${finding.type}  ` +
          `(handed over by <Icon name={${finding.name}}> at line ${finding.usageLine})`
      );
    }
    console.error(
      '\nA same-file binding handed to `<Icon name={…}>` must name the catalog,\n' +
        'because `name` accepts any string - an unknown one renders NOTHING:\n' +
        '\n' +
        '  const glyph: KnownIconName = narrow(raw);   // the compiler now checks it\n' +
        '  const glyph = $derived(header.icon);        // inferred from typed sources\n' +
        '\n' +
        '`string` and the open `IconName` are exactly what the compiler cannot check,\n' +
        'so a typo reached through the binding is as invisible as one in the\n' +
        'attribute. There is no baseline for this verdict: type the declaration (or\n' +
        'narrow the raw value into one) rather than excusing it.'
    );
  }

  if (added.length > 0 || stale.length > 0 || bindings.length > 0) process.exit(1);

  console.log(
    `Every icon reference resolves against the catalog (checked ${catalog.size} ` +
      `name(s); ${findings.length} reviewed exception(s)), and no binding handed to ` +
      '<Icon name={…}> is unchecked. (The icon vocabulary’s declaration rule - every ' +
      'icon FIELD must be typed - is enforced by `bun run check-vocabulary-fields`.)'
  );
}

// CLI entry only - unit tests import the pure core above.
if (import.meta.main) main();
