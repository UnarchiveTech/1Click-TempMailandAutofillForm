/**
 * check-vocabulary-fields.ts - "the compiler must be the gate" for EVERY shared
 * vocabulary, not just the icon catalog.
 *
 * WHY. A shared vocabulary is a closed set of tokens several features agree on
 * (`KnownIconName`, `View`, …), declared once as a union type. The union is what
 * turns a typo into a compile error - but only for the declarations that NAME
 * it. A carrier written `string` (`{ view: string }`, `(view: string) => void`,
 * `Record<string, string>` keyed by view ids) accepts a token the vocabulary
 * does not have, and nothing notices: a lookup miss is an empty cell, an
 * invisible glyph, or a blank pane. Measured, on this repo: the catalog rename
 * to upstream Material Symbols names shipped five blank icons that way, and the
 * shell's view id crossing the messaging boundary as `string` is the same hole
 * one layer down.
 *
 * WHAT IT CHECKS, for every vocabulary registered in `shared-vocabularies.ts`:
 *
 *   1. a CARRIER - a field, prop, or parameter whose name carries the
 *      vocabulary's tokens (`view`, `viewId`, `nextView`, `pageIcon`, …) - must
 *      be declared with the vocabulary's union type, not `string` / `any` / the
 *      open union the component's own prop uses;
 *   2. a TABLE keyed by a vocabulary (`VIEW_LABEL_KEYS`, whose keys are view
 *      ids) must declare that key type - `Record<View, …>`,
 *      `Partial<Record<View, …>>`, `{ [k in View]: … }`, or a `satisfies` of one
 *      - never `Record<string, …>`, where a missing or misspelled key is
 *      `undefined` at runtime rather than a compile error.
 *
 * The two halves answer the same question - does the compiler follow this
 * declaration to the vocabulary? - and they are graded the same way: an
 * annotated `View` (or `Record<View, …>`) passes, everything that erases the
 * vocabulary fails.
 *
 * WHAT IT CANNOT SEE, stated because the gate is a ratchet and not a proof:
 *
 *   - a vocabulary that is not registered (adding one is a registry entry, which
 *     is the point);
 *   - a carrier whose name the vocabulary's field pattern does not claim (the
 *     pattern is curated per vocabulary, and each entry spells out what it
 *     deliberately leaves out);
 *   - a derived declaration (`Pick<T, …>`, `Omit<T, …>`, `Record<K, V>`, a
 *     `keyof`, a mapped type) is FOLLOWED when every name it derives from is
 *     declared in the same file - a carrier through the member it looks up
 *     (`view: Meta['view']`), a table through the key type it derives
 *     (`{ [K in keyof StringKeyed]: T }`). What stays out of reach is the same
 *     boundary the alias rule has: a name declared in ANOTHER module, and a key
 *     expression this file cannot reduce to literals (`Meta[SomeKind]`);
 *   - an EXPRESSION in a claimed property (`{ view: pickView() }`,
 *     `{ icon: size || 'sm' }`): the gate reads declared TYPES, and an expression
 *     is not one - only a cast in it (`raw as string`) is judged, because a cast
 *     IS a type assertion;
 *   - a same-file alias is FOLLOWED (`type GlyphName = string` makes
 *     `{ icon: GlyphName }` a finding), but an alias declared in ANOTHER module
 *     is not: the gate reads one file's own declarations, and a name from
 *     elsewhere is judged on its written form alone;
 *   - a table whose keys only PARTLY name the vocabulary, below the membership
 *     threshold this script documents (a table that is mostly something else is
 *     not this rule's business);
 *   - a trust boundary. A payload from storage, a URL, or a message is a
 *     `string` until the vocabulary's validator narrows it, and typing it `View`
 *     would be a lie the compiler accepts. Those carriers are named in
 *     `VOCABULARY_FIELD_EXCEPTIONS` with their reason - code a reviewer reads,
 *     not a ledger row - and an entry that no longer matches a live untyped
 *     carrier fails, so the list may only shrink.
 *
 * Usage:
 *   bun scripts/check-vocabulary-fields.ts           # gate (exit 1 on findings)
 *   bun scripts/check-vocabulary-fields.ts --list    # every carrier + verdict
 */
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  isUntypedType,
  normalizeType,
  type SharedVocabulary,
  VOCABULARIES,
  VOCABULARY_FIELD_EXCEPTIONS,
  vocabulariesForField,
  vocabularyExceptionFor,
  vocabularyMembers,
} from './shared-vocabularies';
import { collectAbsoluteFiles, REPO_ROOT } from './source-files';
import { analyzeSource } from './source-lexer';

const SRC_DIR = join(REPO_ROOT, 'src');

/** How many of a table's keys must be vocabulary tokens before it is "keyed by" it. */
export const TABLE_MIN_MEMBERS = 6;
/**
 * …and what share of its keys that must be. Half, not all: a table may carry a
 * deliberate second family of keys beside the vocabulary's (`VIEW_LABEL_KEYS`
 * holds the view ids AND the `dialog:*` ids), and it is still the view table -
 * the point is that the view half stops being checkable when the annotation
 * erases it.
 */
export const TABLE_MEMBER_RATIO = 0.5;

// ── Carriers ────────────────────────────────────────────────────────────────

/** An icon/vocabulary-bearing declaration and the type it was declared with. */
export interface VocabularyCarrier {
  /** The declared name: `view`, `viewId`, `pageIcon`, … */
  field: string;
  /**
   * The declared type as written, whitespace-normalized: `string`, `View`,
   * `GlyphName` - a union broken across lines read as one union, and a cast
   * (`raw as string`) kept whole.
   */
  type: string;
  /**
   * The same type with the SAME-FILE aliases it names expanded (`GlyphName` →
   * `string`), equal to `type` when there is no alias to follow.
   *
   * Both readings are judged (`isCarrierUntyped`), because each catches a shape
   * the other misses: the written form is what sees `IconName` - the open union
   * whose expansion does not split into a bare `string` member - while the
   * expansion is what sees an alias that moved the `string` off the line a reader
   * looks at.
   */
  resolvedType: string;
  /**
   * The declared type of the MEMBER this carrier derives from, when the written
   * type is a derived one (`view: Meta['view']` → what `Meta.view` declares).
   *
   * Undefined for the ordinary carrier (`view: string`), and for a derivation
   * this file cannot follow - an imported `Meta`, a lookup keyed by something
   * other than literals (`Meta[Kind]`). Judged alongside the other two readings,
   * because a `string` one indirection away is exactly the erasure the rule is
   * about; `derivedVia` names the path so the finding sends a reader to the
   * declaration that has to change.
   */
  derivedType?: string;
  /** Where `derivedType` came from: `Meta.view`, `Meta.view + Meta.icon`. */
  derivedVia?: string;
  /** 1-based line of the declaration. */
  line: number;
}

/** A carrier with the file it was declared in. */
export type RepoVocabularyCarrier = VocabularyCarrier & { file: string };

/**
 * The `name:` of a declaration. The TYPE is read by `readTypeExpression`, not by
 * this pattern: the pattern is line-bounded - right for finding the name, wrong
 * for judging the type, because a union broken across lines
 * (`pageIcon:\n  | string\n  | undefined`) is ONE declaration whose first line is
 * empty. Read that way, the `string` it contains was never judged at all.
 *
 * Group 2 is therefore the type's first line only, and `typeStart` uses its
 * length to find where the type really begins. Comments are blanked through the
 * shared lexer, so a declaration quoted in prose or in a string body is not a
 * declaration.
 */
const DECLARATION = /(?:^|[\s,{;([])([A-Za-z_$][A-Za-z0-9_$]*)\??\s*:\s*([^;,\n}=)]*)/g;

/** Characters that end a type where it is written. */
const TYPE_TERMINATOR = new Set([';', ',', '=', ')', '}']);

/**
 * How a line may end and still continue into the next one: a union or
 * intersection bar, an open generic or argument list, an opening object type.
 */
const CONTINUES_LINE = /[|&<([{]$/;

/**
 * A type expression as written, continuation lines included.
 *
 * It ends at `;`, `,`, `=`, `)`, `}` - what a declaration's type is followed by
 * in this repo (`view: string;`, `{ view: string }`, `Record<string, string>`) -
 * or at a newline, UNLESS the text so far is empty or ends in `|`, `&`, `<`,
 * `(`, `[`, `{`, or the next line begins with `|` / `&`. Those are the shapes a
 * formatter emits for a long union, and they are the whole reason the type cannot
 * simply stop at the end of the line.
 *
 * With `body` (a `type X = …` alias), a `;` INSIDE a balanced `{ … }` / `( … )` /
 * `[ … ]` belongs to the type rather than ending it - where an object type keeps
 * its own members - and the body runs to the `;` at depth zero; inside an open
 * group a newline never ends it either.
 */
function readTypeExpression(text: string, from: number, body = false): string {
  let out = '';
  let depth = 0;
  let quote: string | null = null;
  for (let i = from; i < text.length; i += 1) {
    const char = text[i] ?? '';
    if (quote) {
      if (char === '\\') {
        out += char + (text[i + 1] ?? '');
        i += 1;
        continue;
      }
      if (char === quote) quote = null;
      out += char;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      out += char;
      continue;
    }
    if (char === '\n') {
      // Inside an open group (`{ … }`, `( … )`, `[ … ]`) a newline is never the
      // end of the type: an object type body keeps its own `;` and its own lines.
      if (depth > 0) {
        out += ' ';
        continue;
      }
      const nextEnd = text.indexOf('\n', i + 1);
      const next = text.slice(i + 1, nextEnd === -1 ? text.length : nextEnd);
      const sofar = out.trim();
      if (sofar !== '' && !CONTINUES_LINE.test(sofar) && !/^\s*[|&]/.test(next)) return out;
      out += ' ';
      continue;
    }
    if (char === '{' || char === '(' || char === '[') depth += 1;
    else if (char === '}' || char === ')' || char === ']') depth -= 1;
    // Angle brackets too, but ONLY where a generic can start (no space before
    // the `<`, no `=` after it): a type's own `,` is not its end
    // (`Pick<Meta, 'pageIcon'>['pageIcon']` used to read as `Pick<Meta`), while
    // `size < 12` in an expression must not open a group that eats the rest of
    // the statement. A `>` at depth 0 is a comparison, not a closer, and `=>`
    // closes nothing.
    else if (
      char === '<' &&
      /[A-Za-z0-9_$.>)\]]/.test(text[i - 1] ?? '') &&
      !/[=<]/.test(text[i + 1] ?? '')
    ) {
      depth += 1;
    } else if (char === '>' && depth > 0 && text[i - 1] !== '=') depth -= 1;
    // A `,` INSIDE an open group belongs to the type, not to the declaration's
    // end: `Pick<Meta, 'pageIcon'>['pageIcon']` used to read as `Pick<Meta`,
    // which hid both the second key and the lookup that carries the vocabulary.
    // The closers (`)`, `}`, `]`) still end the read where they always did - a
    // type written in a value position is followed by those, and this rule reads
    // the cast inside such a fragment (`(raw as string`).
    const endsType = TYPE_TERMINATOR.has(char) && !(char === ',' && depth > 0);
    if (body ? char === ';' && depth <= 0 : endsType) return out;
    out += char;
  }
  return out;
}

/** Where a declaration's type text starts, from the pattern's own match. */
function typeStart(match: RegExpExecArray): number {
  return (match.index ?? 0) + match[0].length - (match[2]?.length ?? 0);
}

/**
 * The same-file `type X = …` aliases, spelled as written (`GlyphName` →
 * `string`).
 *
 * Only THIS file's aliases are read: the gate judges one file's declarations, so
 * a name imported from elsewhere stays as written (see the header's "what it
 * cannot see").
 */
export function scanTypeAliases(source: string): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const match of source.matchAll(/\btype\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:<[^<>]*>)?\s*=/g)) {
    const name = match[1];
    if (!name || match.index === undefined) continue;
    const body = readTypeExpression(source, match.index + match[0].length, true);
    aliases.set(name, normalizeType(body));
  }
  return aliases;
}

/**
 * Expand the same-file aliases a type NAMES, transitively.
 *
 * `type GlyphName = string;` makes `{ icon: GlyphName }` the same unchecked field
 * as `{ icon: string }` - the alias only moved the `string` off the line a reader
 * looks at, and nothing in the compiler complains. Every `|` member that is a
 * bare alias name is replaced by the alias' own body, following an alias that
 * points at another (`type A = B; type B = string;`), with a visited-name guard
 * so a cycle terminates.
 *
 * Only a BARE name is expanded: a member that is an expression (`typeof X`, or a
 * `||` fallback in a property's value), a utility type (`Array<A>`), a literal, or
 * a name this file does not declare is left exactly as written and judged on its
 * own by the registry's `string` / open-type test. When nothing expanded, the text
 * is returned UNCHANGED - the split on `|` is how a union is read here, and a
 * `||` in an expression must not be rewritten by it.
 */
export function resolveAliases(
  type: string,
  aliases: ReadonlyMap<string, string>,
  seen: Set<string> = new Set()
): string {
  let changed = false;
  const resolved = type.split('|').map((member) => {
    const name = member.trim();
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) || seen.has(name)) return member;
    const body = aliases.get(name);
    if (body === undefined) return member;
    changed = true;
    seen.add(name);
    return resolveAliases(body, aliases, seen);
  });
  // Only a changed type is re-joined: a member that was left alone keeps the
  // original text byte for byte (a `||` in an expression is not a union this
  // rule may rewrite), and the expanded members are normalized so the reading is
  // `string | null` rather than `string |  null`.
  return changed ? resolved.map((member) => member.trim()).join(' | ') : type;
}

/** Is this name claimed by any vocabulary's field rule? */
function isClaimed(field: string): boolean {
  return vocabulariesForField(field).length > 0;
}

/**
 * The declarations inside one type expression, with the same-file aliases those
 * types name resolved.
 *
 * A field whose type is a CALLBACK (`setCurrentView: (view: string) => void`)
 * hides the real carrier in its parameter list: the outer name's type is the
 * function, which no vocabulary union can name, while the `view` the callback
 * will be handed is exactly what the compiler should check. The outer read
 * consumes that `view: string` (its type ran through the `(`), so the fragment is
 * re-scanned and its own declarations are judged - on the outer declaration's
 * line, since a type is ordinarily written on one.
 */
function carriersInText(
  text: string,
  line: number,
  aliases: ReadonlyMap<string, string>,
  bodies: ReadonlyMap<string, string>
): VocabularyCarrier[] {
  const carriers: VocabularyCarrier[] = [];
  for (const match of text.matchAll(DECLARATION)) {
    const field = match[1];
    if (!field || match.index === undefined) continue;
    const type = normalizeType(readTypeExpression(text, typeStart(match)));
    if (isClaimed(field)) {
      carriers.push({
        field,
        type,
        resolvedType: resolveAliases(type, aliases),
        ...derivedReading(type, bodies),
        line,
      });
    }
    // The callback's own parameters. The fragment is always SHORTER than the text
    // it came from, so this cannot recurse forever.
    if (type.includes('(') && type.length < text.length) {
      carriers.push(...carriersInText(type, line, aliases, bodies));
    }
  }
  return carriers;
}

/**
 * The derived reading of a carrier's type, spread into the carrier - empty for
 * the ordinary case (no lookup in the type), so a carrier that is not derived
 * carries no `derivedType` at all rather than an `undefined` placeholder.
 */
function derivedReading(
  type: string,
  bodies: ReadonlyMap<string, string>
): { derivedType: string; derivedVia: string } | Record<string, never> {
  const derived = derivedCarrierType(type, bodies);
  return derived ? { derivedType: derived.type, derivedVia: derived.via } : {};
}

/**
 * Every vocabulary-shaped declaration in one file's source.
 *
 * Comments are blanked through the shared lexer, so a declaration quoted in
 * prose or in a string body is not a declaration; `inCode` classifies the
 * NAME's own bytes, so a field-shaped string body is not read as one either.
 */
export function scanVocabularyCarriers(source: string): VocabularyCarrier[] {
  const { code, inCode } = analyzeSource(source);
  const aliases = scanTypeAliases(code);
  // The file's own type declarations, so a DERIVED carrier (`view: Meta['view']`)
  // can be followed to the member it looks up (see the derived section).
  const bodies = scanTypeBodies(code);
  const carriers: VocabularyCarrier[] = [];
  for (const match of code.matchAll(DECLARATION)) {
    const field = match[1];
    if (!field || match.index === undefined) continue;
    const at = match.index + match[0].indexOf(field);
    if (!inCode[at]) continue;
    const line = lineOf(code, at);
    const type = normalizeType(readTypeExpression(code, typeStart(match)));
    if (isClaimed(field)) {
      carriers.push({
        field,
        type,
        resolvedType: resolveAliases(type, aliases),
        ...derivedReading(type, bodies),
        line,
      });
    }
    // The callback's own parameters (see `carriersInText`).
    if (type.includes('(') && type.length < code.length) {
      carriers.push(...carriersInText(type, line, aliases, bodies));
    }
  }
  return carriers;
}

/** A carrier the compiler cannot follow to ANY vocabulary that claims its name. */
export interface RepoVocabularyCarrierFinding extends RepoVocabularyCarrier {
  /** Every vocabulary whose field rule claims the name, in registry order. */
  vocabularies: readonly SharedVocabulary[];
}

/**
 * The carriers the compiler cannot follow.
 *
 * A carrier is a finding only when EVERY vocabulary that claims its name is
 * left unchecked by the declared type - naming any one of their unions makes
 * the compiler the gate, so `viewId: ActivityViewId` is as checked as
 * `viewId: View`. An exception (a trust boundary, named in code) excuses it.
 */
export function untypedCarrierFindings(
  carriers: readonly RepoVocabularyCarrier[]
): RepoVocabularyCarrierFinding[] {
  const findings: RepoVocabularyCarrierFinding[] = [];
  for (const carrier of carriers) {
    const vocabularies = vocabulariesForField(carrier.field);
    if (vocabularies.length === 0) continue;
    if (!vocabularies.every((vocabulary) => isCarrierUntyped(carrier, vocabulary))) continue;
    if (vocabularies.some((v) => vocabularyExceptionFor(carrier.file, carrier.field, v.id))) {
      continue;
    }
    findings.push({ ...carrier, vocabularies });
  }
  return findings;
}

/**
 * Does this carrier leave `vocabulary`'s check unavailable?
 *
 * Any reading is enough, because each sees a shape the others do not: the type AS
 * WRITTEN (`IconName`, the open union whose expansion does not split into a bare
 * `string` member; a cast, judged by what it asserts), the type with its
 * same-file aliases EXPANDED (`type GlyphName = string` → `GlyphName`), and the
 * type DERIVED through a lookup (`view: Meta['view']`, where `Meta.view` is what
 * is unchecked - `derivedType`, absent when the type is not a lookup this file
 * can follow).
 */
export function isCarrierUntyped(
  carrier: Pick<VocabularyCarrier, 'type' | 'resolvedType'> & { derivedType?: string },
  vocabulary: SharedVocabulary | undefined
): boolean {
  return (
    isUntypedType(carrier.type, vocabulary) ||
    isUntypedType(carrier.resolvedType, vocabulary) ||
    (carrier.derivedType !== undefined && isUntypedType(carrier.derivedType, vocabulary))
  );
}

/** Exceptions that no longer match a live untyped carrier: they may only shrink. */
export function staleVocabularyExceptions(
  carriers: readonly RepoVocabularyCarrier[]
): typeof VOCABULARY_FIELD_EXCEPTIONS {
  return VOCABULARY_FIELD_EXCEPTIONS.filter((exception) => {
    const vocabulary = VOCABULARIES.find((entry) => entry.id === exception.vocabulary);
    return !carriers.some(
      (carrier) =>
        carrier.file === exception.file &&
        carrier.field === exception.field &&
        isCarrierUntyped(carrier, vocabulary)
    );
  });
}

// ── Vocabulary-keyed tables ─────────────────────────────────────────────────

/** The `const`/`let`/`var` declarator that starts at `from`, as text. */
function declaratorAt(text: string, from: number): string {
  const end = text.indexOf('\n', from);
  return text.slice(from, end === -1 ? text.length : end);
}

/**
 * The index of the `=` that assigns to the declaration starting at `from`, or -1
 * when the statement has no initializer.
 *
 * The initializer is what decides which brace belongs to the DECLARATION: in
 * `const META: Record<string, { icon: string }> = { … }` the type annotation
 * carries a balanced `{ … }` of its own, and reading the FIRST `{` measured the
 * TYPE instead of the table (it balances and returns), so the region stopped
 * before the `=` and a table like that read as no table at all. Only a `=` at
 * depth 0 counts, and `=>` / `===` / `>=` are not initializers.
 */
function initializerIndex(text: string, from: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from; i < text.length; i += 1) {
    const char = text[i] ?? '';
    if (quote) {
      if (char === '\\') {
        i += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
      continue;
    }
    if (char === ')' || char === ']' || char === '}') {
      depth -= 1;
      continue;
    }
    // The statement ended with no assignment: `const x: Foo;` has no literal.
    if (char === ';') return -1;
    if (char === '=' && depth === 0) {
      const prev = text[i - 1] ?? '';
      const next = text[i + 1] ?? '';
      if (
        prev === '=' ||
        prev === '!' ||
        prev === '<' ||
        prev === '>' ||
        next === '=' ||
        next === '>'
      )
        continue;
      return i;
    }
  }
  return -1;
}

/**
 * The index of the `}` that closes the `{` at `at`, or `at` when unbalanced.
 *
 * Quoted braces do not count, and a nested literal's closing brace is not the
 * body's: `{ a: { b: 1 } }` ends at the OUTER brace. This is what tells the
 * body apart from a later brace on the same line - a `satisfies Record<View,
 * { icon: KnownIconName }>` clause has braces of its own after the body, and
 * reading the last `}` on the line as the body's end hid the `satisfies` from
 * the check that was supposed to see it.
 */
function braceEnd(text: string, at: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = at; i < text.length; i += 1) {
    const char = text[i] ?? '';
    if (quote) {
      if (char === '\\') {
        i += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return at;
}

/**
 * The whole declaration that starts at `from`, through the object literal it
 * assigns and the rest of that closing line.
 *
 * A `satisfies` clause - the other way a table names its key type - sits AFTER
 * the braces, on the closing line, so a first-line slice would miss it and flag
 * a table that is in fact checked.
 */
function declarationRegion(text: string, from: number): string {
  const equals = initializerIndex(text, from);
  const brace = text.indexOf('{', equals === -1 ? from : equals + 1);
  // A `{` AFTER the statement ends (`;`) belongs to the NEXT declaration - a
  // string constant followed by a table would otherwise be read as that table.
  const statementEnd = text.indexOf(';', from);
  if (brace === -1 || (statementEnd !== -1 && statementEnd < brace)) {
    return text.slice(from, statementEnd === -1 ? from : statementEnd + 1);
  }
  const lineEnd = text.indexOf('\n', braceEnd(text, brace));
  return text.slice(from, lineEnd === -1 ? text.length : lineEnd);
}

/**
 * Does this declaration give its keys a type the compiler can check?
 *
 * Any named annotation counts (`: Record<View, T>`, `: ToolbarButtonVisibility`,
 * `satisfies Partial<Record<View, T>>`) - the rule's claim is about `string`, not
 * about this registry: a table keyed by a vocabulary OTHER than a registered one
 * is already checked by whatever type it names, and demanding our type instead
 * would be a false finding as well as a wrong fix. Only a key set that admits any
 * string (`Record<string, …>`, `{ [k: string]: … }`, `{ [K in string]: … }`,
 * `Record<string | View, …>`) - or no declaration at all - leaves a missing or
 * misspelled entry to be `undefined` at runtime.
 *
 * The verdict is `typeKeysChecked`'s, so a DERIVED key type is judged by what it
 * derives: `Pick<Record<string, T>, 'a' | 'b'>` is checked (those literals are
 * the key set), `Omit<Record<string, T>, 'a'>` is not, and a same-file alias of
 * one of them is followed like any other (`bodies`).
 */
export function hasCheckedKeyType(
  region: string,
  objectEnd: number,
  bodies: ReadonlyMap<string, string> = new Map()
): boolean {
  // EITHER declaration is enough. A table may carry a loose annotation and a
  // tight `satisfies` (`const M: Record<string, { icon: string }> = {…} satisfies
  // Record<View, …>`): the annotation types the binding, the `satisfies` checks
  // the literal's keys, and a misspelled key is an error because of it.
  return declaredKeyTypes(region, objectEnd).some((type) => typeKeysChecked(type, bodies));
}

/**
 * The keys of the object literal that starts at `at`, at its TOP level only.
 *
 * Top level matters: `{ settings: { icon: 'settings' } }` is keyed by
 * `settings`, and reading the nested `icon` as a key would mis-count the match.
 */ function objectKeys(text: string, at: number): string[] {
  const keys: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  /** At a position where a key can start: just after `{` or a top-level `,`. */
  let keyStart = false;
  for (let i = at; i < text.length; i += 1) {
    const char = text[i] ?? '';
    if (quote) {
      if (char === '\\') {
        i += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      // A quoted key at depth 1: read it whole, then require a `:`.
      if (depth === 1 && keyStart) {
        keyStart = false;
        const close = text.indexOf(char, i + 1);
        if (close !== -1 && /^\s*:/.test(text.slice(close + 1)))
          keys.push(text.slice(i + 1, close));
      }
      continue;
    }
    if (char === '{') {
      depth += 1;
      keyStart = depth === 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      keyStart = false;
      if (depth === 0) return keys;
      continue;
    }
    if (char === ',' && depth === 1) {
      keyStart = true;
      continue;
    }
    if (keyStart && depth === 1 && !/\s/.test(char)) {
      keyStart = false;
      const bare = /^([A-Za-z_$][A-Za-z0-9_$]*)\s*:/.exec(text.slice(i));
      if (bare?.[1]) keys.push(bare[1]);
    }
  }
  return keys;
}

/** A lookup table whose keys are a vocabulary's tokens. */
export interface VocabularyKeyedTable {
  /** The declaration's name. */
  name: string;
  /** The vocabulary its keys belong to. */
  vocabulary: SharedVocabulary;
  /** How many of its keys are that vocabulary's tokens. */
  matched: number;
  /** How many keys it declares in total. */
  total: number;
  /** The type as written (`Record<string, string>`), or `(inferred)`. */
  type: string;
  /**
   * `true` when the declaration names its key type (`Record<View, T>`,
   * `satisfies Record<View, T>`) - the verdict, reported rather than swallowed:
   * a scanner that only returned the failures could not tell "this table is
   * checked" apart from "this table was never read", and that silence is how a
   * table whose type carries braces of its own (`Record<string, { icon: string }>`)
   * read as no table at all.
   */
  checked: boolean;
  /** 1-based line of the declaration. */
  line: number;
}

/** A vocabulary-keyed table whose declaration does not name the key type. */
export type RepoVocabularyKeyedTable = VocabularyKeyedTable & {
  file: string;
  /** The whole declarator, for the finding's advice. */
  declaration: string;
};

export interface VocabularyMembership {
  vocabulary: SharedVocabulary;
  members: ReadonlySet<string>;
}

/**
 * Every vocabulary-keyed lookup table in one file's source, CHECKED AND
 * UNCHECKED alike (`checked` is the verdict). A table is "keyed by" a vocabulary
 * when enough of its keys are that vocabulary's tokens (the thresholds above),
 * which is evidence rather than a name guess: a table of English keywords or
 * country codes is not a view table, however it is named.
 */
export function scanVocabularyKeyedTables(
  source: string,
  memberships: readonly VocabularyMembership[]
): VocabularyKeyedTable[] {
  const { code, inCode } = analyzeSource(source);
  // The file's own types, so a key type named or derived here can be followed.
  const bodies = scanTypeBodies(code);
  const tables: VocabularyKeyedTable[] = [];
  for (const match of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
    const name = match[1];
    if (!name || match.index === undefined) continue;
    const at = match.index + match[0].indexOf(name);
    if (!inCode[at]) continue;
    const region = declarationRegion(code, match.index);
    const initializer = region.indexOf('=');
    if (initializer === -1) continue;
    // The body starts after the initializer, never at the type annotation's own
    // braces (`Record<string, { icon: string }>`), and never past the statement's
    // `;` - where the NEXT declaration's literal begins.
    const brace = code.indexOf('{', match.index + initializer + 1);
    if (brace === -1 || brace > match.index + region.length) continue;
    const keys = objectKeys(code, brace);
    if (keys.length === 0) continue;
    // The BEST vocabulary only: a table keyed by `View | dialog:*` ids matches
    // both the pane family and the wider activity family, and reporting the same
    // table twice would name the narrower - and therefore wrong - fix first.
    const best = memberships
      .map(({ vocabulary, members }) => ({
        vocabulary,
        matched: keys.filter((key) => members.has(key)).length,
      }))
      .filter(
        ({ matched }) => matched >= TABLE_MIN_MEMBERS && matched / keys.length >= TABLE_MEMBER_RATIO
      )
      .sort((a, b) => b.matched - a.matched)[0];
    if (!best) continue;
    // The BODY's closing brace, not the last `}` on the line: a `satisfies`
    // clause after it carries braces of its own, and they are what says the
    // keys are typed.
    const objectEnd = braceEnd(code, brace) - match.index;
    tables.push({
      name,
      vocabulary: best.vocabulary,
      matched: best.matched,
      total: keys.length,
      type:
        normalizeType(region.slice(match[0].length, initializer).replace(/^:/, '')) || '(inferred)',
      checked: hasCheckedKeyType(region, objectEnd, bodies),
      line: lineOf(code, at),
    });
  }
  return tables;
}

// ── Derived type expressions ────────────────────────────────────────────────

/**
 * `Pick`, `Omit`, `Record`, `keyof` and a mapped type do not DECLARE a type;
 * they derive one, and the vocabulary lives in the argument they name
 * (`Pick<Meta, 'view'>['view']`, `{ [K in keyof Meta]: Meta[K] }`). Two holes
 * follow, one per half of the rule, and both are closed here:
 *
 *   - a CARRIER written as a lookup (`view: Meta['view']`) names `Meta`, not the
 *     vocabulary, so the declared type reads as checked while the member it comes
 *     from is a `string` - the erasure one indirection away, where the alias rule
 *     (`scanTypeAliases`) cannot see it;
 *   - a TABLE whose key type is derived (`Record<string | View, T>`,
 *     `{ [K in keyof StringKeyed]: T }`, `Pick<StringKeyed, 'a' | 'b'>`) needs the
 *     derived key set judged, including the case the old `Record<string,` text
 *     match got wrong in the SAFE direction: `Pick<Record<string, T>, 'a' | 'b'>`
 *     IS checked, because those two literals are the key set.
 *
 * Only THIS file's declarations are read (`scanTypeBodies`), so a derivation
 * through a name declared in another module stays the documented boundary - the
 * same one the alias rule has, for the same reason: the imported name could be
 * the union, and guessing either way would be worse than saying so.
 */

/** Wrappers that describe a type without changing its members or its keys. */
const TRANSPARENT_WRAPPERS = new Set(['Readonly', 'Required', 'Partial', 'NonNullable', 'Awaited']);

/** Key types that admit ANY string, so no key can be missed at compile time. */
const WIDE_KEY_MEMBERS = new Set(['string', 'number', 'symbol']);

/** A type with redundant outer parentheses removed (`(string)` → `string`). */
function stripParens(type: string): string {
  let text = normalizeType(type);
  while (text.startsWith('(') && text.endsWith(')')) {
    // Only when the parens really pair: `(A) | (B)` must stay a union.
    let depth = 0;
    let paired = true;
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (char === '(') depth += 1;
      else if (char === ')') {
        depth -= 1;
        if (depth === 0 && i < text.length - 1) {
          paired = false;
          break;
        }
      }
    }
    if (!paired) break;
    text = normalizeType(text.slice(1, -1));
  }
  return text;
}

/**
 * Split a type on its TOP-LEVEL `|` / `&` only.
 *
 * A naive split is what makes `Record<View | string, T>` look like two members
 * neither of which mentions `Record` - the inner union is one argument, and the
 * erasing `string` inside it is the whole answer.
 */
function splitTopLevel(type: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < type.length; i += 1) {
    const char = type[i] ?? '';
    if (quote) {
      current += char;
      if (char === '\\') {
        current += type[i + 1] ?? '';
        i += 1;
      } else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      current += char;
      continue;
    }
    if (char === '<' || char === '{' || char === '[' || char === '(') depth += 1;
    else if (char === '>' && type[i - 1] === '=') {
      // The `>` of a function type's `=>`, not a closing angle bracket.
      current += char;
      continue;
    } else if (char === '>' || char === '}' || char === ']' || char === ')') depth -= 1;
    else if (depth === 0 && (char === '|' || char === '&')) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => normalizeType(part)).filter((part) => part !== '');
}

/** A generic application's base name and its arguments, or `null` when it is not one. */
function splitGeneric(type: string): { base: string; args: string[] } | null {
  const match = /^([A-Za-z_$][A-Za-z0-9_$.]*)\s*</.exec(type);
  const base = match?.[1];
  if (!base) return null;
  const args: string[] = [];
  let current = '';
  let depth = 0;
  let quote: string | null = null;
  for (let i = match[0].length - 1; i < type.length; i += 1) {
    const char = type[i] ?? '';
    if (quote) {
      current += char;
      if (char === '\\') {
        current += type[i + 1] ?? '';
        i += 1;
      } else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      current += char;
      continue;
    }
    if (char === '<') {
      depth += 1;
      if (depth === 1) {
        current = '';
        continue;
      }
    } else if (char === '>' && type[i - 1] !== '=') {
      depth -= 1;
      if (depth === 0) {
        args.push(normalizeType(current));
        return { base, args };
      }
    } else if (char === ',' && depth === 1) {
      args.push(normalizeType(current));
      current = '';
      continue;
    }
    current += char;
  }
  return null;
}

/**
 * A type's trailing indexed access split into its base and its keys
 * (`Meta['view']` → `Meta` + `'view'`), or `null` when the type is not one.
 *
 * Read from the END: the brackets that matter are the ones closing the whole
 * expression, and the ones inside the base (`Record<string, T>['a']`) are not the
 * lookup's.
 */
function indexedAccess(type: string): { base: string; keys: string } | null {
  if (!type.endsWith(']')) return null;
  let depth = 0;
  let quote: string | null = null;
  let open = -1;
  for (let i = type.length - 1; i >= 0; i -= 1) {
    const char = type[i] ?? '';
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === ']') depth += 1;
    else if (char === '[') {
      depth -= 1;
      if (depth === 0) {
        open = i;
        break;
      }
    }
  }
  if (open <= 0) return null;
  const base = normalizeType(type.slice(0, open));
  const keys = normalizeType(type.slice(open + 1, -1));
  if (!base || !keys) return null;
  return { base, keys };
}

/**
 * The member NAMES a key expression selects, or `null` when they cannot be read.
 *
 * `'view' | 'icon'` is the ordinary shape; a same-file alias to such a union is
 * followed (`type Lookup = 'view' | 'icon'`), because that is the same
 * indirection the alias rule already closes. Anything else - an imported key
 * union, `keyof SomethingElse`, a computed key - is `null`, and the caller treats
 * it as unreadable rather than guessing which names it holds.
 */
function literalNames(keys: string, bodies: ReadonlyMap<string, string>): Set<string> | null {
  const names = new Set<string>();
  for (const part of splitTopLevel(keys)) {
    const literal = /^(['"])(.*)\1$/.exec(part) ?? /^`([^`$]*)`$/.exec(part);
    if (literal?.[2] !== undefined) {
      names.add(literal[2]);
      continue;
    }
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(part)) {
      const body = bodies.get(part);
      if (body === undefined) return null;
      const nested = literalNames(body, bodies);
      if (nested === null) return null;
      for (const name of nested) names.add(name);
      continue;
    }
    return null;
  }
  return names.size > 0 ? names : null;
}

/** The declared type of one member of an object type body, as written. */
function memberType(body: string, field: string): string | null {
  const text = stripParens(body).replace(/^\{/, '').replace(/\}$/, '');
  for (const match of text.matchAll(DECLARATION)) {
    if (match[1] !== field || match.index === undefined) continue;
    const type = normalizeType(readTypeExpression(text, typeStart(match)));
    if (type) return type;
  }
  return null;
}

/**
 * The members a derived expression keeps, and the declaration each comes from.
 *
 * `keys` is the set of member names the lookup selects; a wrapper is unwrapped, a
 * `Pick` narrows that set and an `Omit` removes from it - which is why an `Omit`
 * that drops the looked-up name yields nothing (the compiler rejects the lookup
 * itself, and that is not this rule's finding) - and the first name that does
 * resolve supplies the members. A name this file does not declare - the common
 * case, since most metadata lives in another module - returns `null`: the
 * boundary, stated rather than guessed.
 */
function derivedMembers(
  text: string,
  keys: ReadonlySet<string>,
  bodies: ReadonlyMap<string, string>,
  seen: Set<string>
): { type: string; via: string } | null {
  const base = stripParens(text);
  if (!base) return null;
  const parts = splitTopLevel(base);
  if (parts.length > 1) {
    // An intersection of types: whichever member declares the name answers.
    for (const part of parts) {
      const found = derivedMembers(part, keys, bodies, seen);
      if (found) return found;
    }
    return null;
  }
  const generic = splitGeneric(base);
  if (generic) {
    const [first, second] = generic.args;
    if (first === undefined) return null;
    if (TRANSPARENT_WRAPPERS.has(generic.base)) return derivedMembers(first, keys, bodies, seen);
    if ((generic.base === 'Pick' || generic.base === 'Omit') && second !== undefined) {
      const named = literalNames(second, bodies);
      if (named === null) return null;
      const kept = new Set(
        [...keys].filter((key) => (generic.base === 'Pick' ? named.has(key) : !named.has(key)))
      );
      if (kept.size === 0) return null;
      return derivedMembers(first, kept, bodies, seen);
    }
    // `Record<…>`, `Map<…>`, a function type: not a member lookup to follow.
    return null;
  }
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(base) || seen.has(base)) return null;
  const body = bodies.get(base);
  if (body === undefined) return null;
  seen.add(base);
  const types: string[] = [];
  const via: string[] = [];
  for (const key of keys) {
    const member = memberType(body, key);
    if (member === null) continue;
    types.push(member);
    via.push(`${base}.${key}`);
  }
  if (types.length > 0) {
    return { type: [...new Set(types)].join(' | '), via: via.join(' + ') };
  }
  // `type Meta = OtherMeta` - an alias of an alias, followed the same way.
  return derivedMembers(body, keys, bodies, seen);
}

/**
 * The declaration a CARRIER's derived type comes from, when it is a lookup
 * (`Meta['view']`, `Pick<Meta, 'view'>['view']`, `Readonly<Meta['view']>`).
 *
 * Returns `null` for every ordinary carrier - the overwhelmingly common case,
 * and the reason the whole calculation is skipped unless the type contains a
 * bracket - and for a lookup this file cannot finish reading.
 */
export function derivedCarrierType(
  type: string,
  bodies: ReadonlyMap<string, string>
): { type: string; via: string } | null {
  const text = normalizeType(type);
  if (!text.includes('[')) return null;
  const wrapper = splitGeneric(text);
  if (wrapper && TRANSPARENT_WRAPPERS.has(wrapper.base)) {
    const inner = wrapper.args[0];
    return inner === undefined ? null : derivedCarrierType(inner, bodies);
  }
  const lookup = indexedAccess(text);
  if (!lookup) return null;
  const keys = literalNames(lookup.keys, bodies);
  if (keys === null) return null;
  return derivedMembers(lookup.base, keys, bodies, new Set());
}

/**
 * Is this KEY expression a set of names the compiler checks?
 *
 * A literal (`'view'`) and a name this file cannot resolve are checked; `string`,
 * `number` and a template literal type are not, because a key missing from a
 * `Record<string, …>` is `undefined` at runtime rather than an error. Unknown
 * names are deliberately trusted: the rule's claim is about `string`, not about
 * this registry, so a key union from another module is not this gate's finding.
 */
function keyExpressionChecked(expr: string, bodies: ReadonlyMap<string, string>): boolean {
  const text = stripParens(expr);
  if (!text) return false;
  // Before the name lookup: `string` is a token, not a same-file type, and the
  // whole question is whether the key set IS that token.
  if (WIDE_KEY_MEMBERS.has(text)) return false;
  if (/^keyof\b/.test(text)) return typeKeysChecked(text.replace(/^keyof\s*/, ''), bodies);
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(text)) {
    const body = bodies.get(text);
    return body === undefined ? true : keyExpressionChecked(body, bodies);
  }
  return splitTopLevel(text).every((member) => {
    if (WIDE_KEY_MEMBERS.has(member)) return false;
    // `` `dialog:${string}` `` admits any tail, so no key can be checked.
    return !member.startsWith('`');
  });
}

/**
 * Are the KEYS of this type a set the compiler checks?
 *
 * The derived shapes, each answered by the part that decides its key set: a
 * wrapper passes through, `Record<K, V>` is K's verdict, `Pick<X, K>`'s keys ARE
 * K (while `Omit<X, K>`'s are X's), a mapped type takes its domain, an index
 * signature takes its key type, and an object type literal's own named members
 * are a finite set. A union or intersection is judged by EVERY member, because
 * `T[k]` is unchecked wherever ANY of them admits `k`.
 */
export function typeKeysChecked(
  rawType: string,
  bodies: ReadonlyMap<string, string> = new Map()
): boolean {
  const text = stripParens(rawType);
  if (!text) return false;
  // A key set that admits any string is unchecked however it is spelled,
  // including as the bare type (`Record<string, …>`, `{ [k in string]: … }`).
  if (WIDE_KEY_MEMBERS.has(text)) return false;
  // `keyof X` selects exactly X's keys, so X's verdict is the answer.
  if (/^keyof\b/.test(text)) return typeKeysChecked(text.replace(/^keyof\s*/, ''), bodies);
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(text)) {
    const body = bodies.get(text);
    return body === undefined ? true : typeKeysChecked(body, bodies);
  }
  const parts = splitTopLevel(text);
  if (parts.length > 1) return parts.every((part) => typeKeysChecked(part, bodies));
  const generic = splitGeneric(text);
  if (generic) {
    const [first, second] = generic.args;
    if (first === undefined) return true;
    if (TRANSPARENT_WRAPPERS.has(generic.base)) return typeKeysChecked(first, bodies);
    if (generic.base === 'Record') return keyExpressionChecked(first, bodies);
    if (generic.base === 'Pick' && second !== undefined)
      return keyExpressionChecked(second, bodies);
    if (generic.base === 'Omit') return typeKeysChecked(first, bodies);
  }
  const mapped = /\{\s*(?:readonly\s+)?\[[^\]]*?\bin\b\s+([^\]]+)\]/.exec(text);
  if (mapped?.[1]) {
    // A `as` clause remaps the keys; its domain is what the keys come from.
    return keyExpressionChecked(mapped[1].replace(/\s+as\s+[\s\S]*$/, ''), bodies);
  }
  const indexSignature = /\{\s*\[[^\]]*?\s*:\s*([^\]]+)\]/.exec(text);
  if (indexSignature?.[1]) return keyExpressionChecked(indexSignature[1], bodies);
  // An object type literal's own members are its key set - finite, and checked.
  // Everything else (`Map<…>`, a generic we do not model) is not this rule's
  // business, exactly like a named annotation it cannot resolve.
  return true;
}

/**
 * Every key type a table's declaration names, as written - empty when it names
 * none.
 *
 * Two spellings exist in this repo and BOTH are read: the annotation
 * (`const T: Record<View, X> = {…}`) and a `satisfies` clause after the body
 * (`const T = {…} satisfies Partial<Record<View, X>>`), which sits on the closing
 * line rather than in the head. Returning both is what lets either one make the
 * keys checked (see `hasCheckedKeyType`).
 */
function declaredKeyTypes(region: string, objectEnd: number): string[] {
  const declared: string[] = [];
  const equals = region.indexOf('=');
  const head = equals === -1 ? region : region.slice(0, equals);
  const colon = head.indexOf(':');
  if (colon !== -1) {
    const annotation = normalizeType(head.slice(colon + 1));
    if (annotation) declared.push(annotation);
  }
  const satisfies = /\bsatisfies\s+([\s\S]+)$/.exec(region.slice(objectEnd))?.[1];
  const clause = satisfies === undefined ? '' : normalizeType(satisfies);
  if (clause) declared.push(clause);
  return declared;
}

/**
 * Every type DECLARED in one file, by name: `type X = …` aliases and
 * `interface X { … }` bodies.
 *
 * The derived rule needs the object types and not only the aliases: `Meta['view']`
 * is usually a member of an `interface`, and an interface is exactly the shape
 * `scanTypeAliases` does not read (an alias rule has no reason to).
 */
export function scanTypeBodies(source: string): Map<string, string> {
  const bodies = new Map(scanTypeAliases(source));
  for (const match of source.matchAll(/\binterface\s+([A-Za-z_$][A-Za-z0-9_$]*)[^{]*\{/g)) {
    const name = match[1];
    if (!name || match.index === undefined) continue;
    const open = match.index + match[0].length - 1;
    const close = braceEnd(source, open);
    if (close <= open) continue;
    bodies.set(name, normalizeType(source.slice(open, close + 1)));
  }
  return bodies;
}

// ── Live tree ───────────────────────────────────────────────────────────────

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

function sourceFiles(): string[] {
  return collectAbsoluteFiles(SRC_DIR, ['.ts', '.svelte']);
}

/** Every vocabulary-shaped carrier in `src`, resolved and unresolved alike. */
export function scanRepositoryCarriers(): RepoVocabularyCarrier[] {
  const carriers: RepoVocabularyCarrier[] = [];
  for (const file of sourceFiles()) {
    const repoPath = relative(REPO_ROOT, file).replace(/\\/g, '/');
    for (const carrier of scanVocabularyCarriers(readFileSync(file, 'utf8'))) {
      carriers.push({ ...carrier, file: repoPath });
    }
  }
  return carriers;
}

/** The vocabulary memberships, read from each vocabulary's own module. */
export function readMemberships(): VocabularyMembership[] {
  return VOCABULARIES.map((vocabulary) => ({
    vocabulary,
    members: vocabularyMembers(
      vocabulary,
      readFileSync(join(REPO_ROOT, vocabulary.module), 'utf8')
    ),
  }));
}

/**
 * Every vocabulary-keyed table in `src`, checked and unchecked alike. The
 * default is the FINDINGS (unchecked tables); `includeChecked` is how a caller
 * proves the rule is reading real tables rather than seeing none.
 */
export function scanRepositoryKeyedTables(
  options: { includeChecked?: boolean } = {}
): RepoVocabularyKeyedTable[] {
  const memberships = readMemberships();
  const tables: RepoVocabularyKeyedTable[] = [];
  for (const file of sourceFiles()) {
    const repoPath = relative(REPO_ROOT, file).replace(/\\/g, '/');
    const text = readFileSync(file, 'utf8');
    for (const table of scanVocabularyKeyedTables(text, memberships)) {
      if (table.checked && !options.includeChecked) continue;
      const start = text.indexOf(`const ${table.name}`);
      tables.push({
        ...table,
        file: repoPath,
        declaration:
          start === -1
            ? (declaratorAt(text, 0).trim() ?? '')
            : declarationRegion(text, start).trim(),
      });
    }
  }
  return tables;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function main(): void {
  const list = process.argv.includes('--list');

  const memberships = readMemberships();
  const carriers = scanRepositoryCarriers();
  const findings = untypedCarrierFindings(carriers);
  const stale = staleVocabularyExceptions(carriers);
  // One pass, both views of it: the findings that fail the gate, and the total
  // the verdict was reached on (a rule that reads no table at all could not be
  // told apart from a clean repo without the second).
  const allTables = scanRepositoryKeyedTables({ includeChecked: true });
  const tables = allTables.filter((table) => !table.checked);

  if (list) {
    for (const vocabulary of VOCABULARIES) {
      const count = carriers.filter((carrier) =>
        vocabulariesForField(carrier.field).some((v) => v.id === vocabulary.id)
      ).length;
      console.log(
        `${vocabulary.id}: ${vocabulary.type} from ${vocabulary.module} - ` +
          `${memberships.find((m) => m.vocabulary.id === vocabulary.id)?.members.size ?? 0} member(s), ` +
          `${count} carrier(s)`
      );
    }
    console.log(
      `\nCarriers (${carriers.length}) - a carrier must be declared with its vocabulary's type:`
    );
    for (const carrier of carriers) {
      const vocabularies = vocabulariesForField(carrier.field);
      // The same two-reading verdict the gate reaches, so the listing and the
      // finding cannot disagree about a carrier.
      const typed = vocabularies.some((vocabulary) => !isCarrierUntyped(carrier, vocabulary));
      const excused = vocabularies.some((v) =>
        vocabularyExceptionFor(carrier.file, carrier.field, v.id)
      );
      const verdict = typed ? 'typed' : excused ? 'EXCEPTED' : 'UNTYPED';
      const expansion = carrier.resolvedType === carrier.type ? '' : ` → ${carrier.resolvedType}`;
      // The derived reading too: a lookup's verdict is decided by a declaration
      // in another part of the file, and the listing is where that is visible.
      const derivation =
        carrier.derivedType === undefined
          ? ''
          : ` ⇢ ${carrier.derivedVia} = ${carrier.derivedType}`;
      console.log(
        `${carrier.file}:${carrier.line}\t[${verdict}] ${carrier.field}: ${carrier.type}${expansion}${derivation}` +
          `  (${vocabularies.map((v) => v.id).join(' | ')})`
      );
    }
    console.log(
      `\nVocabulary-keyed tables (${allTables.length} read, ${tables.length} without a key type):`
    );
    for (const table of allTables) {
      console.log(
        `${table.file}:${table.line}\t[${table.checked ? 'typed' : 'UNTYPED'}] ${table.name}: ` +
          `${table.type} - ${table.matched}/${table.total} keys are ${table.vocabulary.type} tokens`
      );
    }
    console.log(`\n${findings.length} untyped carrier(s); ${stale.length} stale exception(s).`);
    return;
  }

  if (findings.length > 0) {
    console.error(
      `Carrier(s) the compiler cannot follow to their vocabulary (${findings.length}):`
    );
    for (const finding of findings) {
      const candidates = finding.vocabularies
        .map((vocabulary) => `${vocabulary.type}\t(${vocabulary.module})`)
        .join('\n      or ');
      // A carrier hidden behind an alias is shown BOTH ways: the written name is
      // what a reader must edit, and the expansion is the reason the rule fired.
      const expansion =
        finding.resolvedType === finding.type
          ? ''
          : `  - same-file aliases expand it to: ${finding.resolvedType}`;
      // A derived carrier's `string` is declared somewhere else in the file, so
      // the finding names the path as well as the value: the fix may be there.
      const derivation =
        finding.derivedType === undefined
          ? ''
          : `  - derived from ${finding.derivedVia}, which is declared ${finding.derivedType}`;
      console.error(
        `  ${finding.file}:${finding.line}  ${finding.field}: ${finding.type}` +
          `${expansion}${derivation}\n      → declare ${candidates}`
      );
    }
    console.error(
      '\nA shared vocabulary is only a gate where a declaration NAMES its union.\n' +
        '`string` accepts a token the vocabulary does not have, and nothing catches\n' +
        'it: a lookup miss is an empty cell, an invisible glyph, or a blank pane -\n' +
        'not a compile error. Type the carrier with the vocabulary (or narrow the\n' +
        'raw value through its validator at the edge, and name the boundary in\n' +
        'VOCABULARY_FIELD_EXCEPTIONS with its reason).'
    );
  }

  if (tables.length > 0) {
    console.error(`\nTable(s) keyed by a vocabulary without a key type (${tables.length}):`);
    for (const table of tables) {
      console.error(
        `  ${table.file}:${table.line}  ${table.name}: ${table.type}  ` +
          `(${table.matched}/${table.total} keys are ${table.vocabulary.type} tokens)\n` +
          `      ${table.declaration}`
      );
    }
    console.error(
      `\nThese tables are keyed by a vocabulary, so declare the key type:\n` +
        `  Record<${tables[0]?.vocabulary.type ?? 'Vocab'}, T>            // exhaustive: a missing key is a compile error\n` +
        `  Partial<Record<${tables[0]?.vocabulary.type ?? 'Vocab'}, T>>   // sparse by design\n` +
        `  {...} satisfies Record<${tables[0]?.vocabulary.type ?? 'Vocab'}, T>\n` +
        '`Record<string, T>` says any string is a key, so a missing or misspelled\n' +
        "entry is `undefined` at runtime instead of an error - the icon gate's own\n" +
        'founding failure, in map form.'
    );
  }

  if (stale.length > 0) {
    console.error(
      `\nStale vocabulary exception(s) - no live untyped carrier matches them (${stale.length}):`
    );
    for (const exception of stale) {
      console.error(`  ${exception.file}\t${exception.field}\t# ${exception.reason}`);
    }
    console.error(
      'Remove the row from VOCABULARY_FIELD_EXCEPTIONS in scripts/shared-vocabularies.ts: the list may only shrink.'
    );
  }

  if (findings.length > 0 || tables.length > 0 || stale.length > 0) process.exit(1);

  console.log(
    `Every carrier of a shared vocabulary names its union (${carriers.length} carrier(s) ` +
      `across ${VOCABULARIES.length} vocabular${VOCABULARIES.length === 1 ? 'y' : 'ies'}; ` +
      `${VOCABULARY_FIELD_EXCEPTIONS.length} named boundary exception(s)), and every ` +
      `vocabulary-keyed table declares its key type (${allTables.length} table(s) read).`
  );
}

// CLI entry only - unit tests import the pure core above.
if (import.meta.main) main();
