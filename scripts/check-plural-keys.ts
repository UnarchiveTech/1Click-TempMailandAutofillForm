#!/usr/bin/env bun
/**
 * Plural-key checker
 *
 * The dictionaries pair every counted message with a plural variant named
 * `<key>Plural`, and seven call sites used to "select" the pair with
 * `$t(base, { default: pluralKey })`. That selects nothing: svelte-i18n consults
 * `default` **only when the key is missing**, so every one of those messages
 * rendered the SINGULAR - "5 address", "1 messages" - in all eight locales, and
 * no gate could see it, because both keys exist, both are referenced, and the
 * plural was simply unreachable. The two other gates cover the pair's ends
 * (`check-translations`: every locale carries it; `check-locale-key-references`:
 * it exists in `en.json`) but neither can see a plural no count can ever reach.
 *
 * This gate reads `pluralMessage(...)` / `pluralKey(...)` call sites - the pair is
 * named as two literals there, `oneKey` / `otherKey` - and fails when:
 *
 *   1. `default:` holds a key-shaped literal. A `default` is a fallback MESSAGE for
 *      a missing key, so a key name there can never render: it either duplicates a
 *      real key (which is read instead - the plural no-op above) or prints its own
 *      raw text when the base key is absent.
 *   2. a call's pair is not two static literals - no gate can prove a pair that
 *      only exists at runtime, so the pair must be spelled out.
 *   3. a half of the pair is not a key in `en.json` (typo'd or renamed leaf).
 *   4. the halves are identical - the "plural" is the singular, so the second form
 *      is unreachable again.
 *   5. `otherKey` is not `<oneKey>Plural` - the naming contract the dictionaries,
 *      `check-unused-locales` (which trusts a referenced base) and translators all
 *      rely on.
 *   6. the halves declare different `{slots}` - one rendering silently drops a
 *      value the other passes (e.g. a plural that lost `{size}`).
 *   7. a count-sensitive key in the curated registry that has no complete pair
 *      or no statically checked call site. This closes the gap where a message
 *      carried `{n}` / `{count}` but had no plural half for the scanner to find.
 *   8. a `<key>Plural` key in `en.json` that NO call site pairs - shipped text no
 *      count can reach, the exact class of bug this gate exists for.
 *
 * Detection runs on the shared `./source-lexer` classification (comment bodies
 * blanked, strings intact both ways), wrapped in the `inCode` guard, so a call or a
 * `default:` quoted in a comment, a doc example or a fixture string is never a
 * finding - the module comment in `src/utils/i18n/i18n-plural.ts` spells out a full
 * example pair and must stay invisible to this check.
 *
 * Run: bun run check-plural-keys
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractArgs, splitTopLevel } from './check-locale-key-references';
import { collectSourceFiles, repoAbsolute } from './source-files';
import { analyzeSource } from './source-lexer';

// ─── Configuration ────────────────────────────────────────────────────────────

const ROOT = join(import.meta.dir, '..');
const EN_FILE = join(ROOT, 'src', 'locales', 'en.json');

/** Scanned roots - the code that can hand a key to a formatter. */
const SCAN_DIRS = ['src'];

/** File types that can hold a call site (the walk's extension filter). */
const CODE_EXTS = ['.ts', '.svelte', '.js', '.mjs'];

/**
 * The module that DEFINES the selector - its own `pluralKey(keys, n)` is the
 * implementation, not a call site, and the pair it takes comes from its caller.
 * (Its doc comment spells out a full example pair; comments are blanked, so that
 * example is invisible here either way.)
 */
const SKIP_FILES = new Set(['src/utils/i18n/i18n-plural.ts']);

/* * The calls that take a `{ oneKey, otherKey }` pair as one of their arguments. */
const PAIR_CALLS = ['pluralMessage', 'pluralKey'] as const;

/** `{one}|{two}` slots of a message. */
const SLOT_RE = /\{(\w+)\}/g;

/** A key looks like `namespace.leaf` - lowercase first segment, dot-separated. */
const KEY_SHAPE_RE = /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)+$/;

/** The plural half's name: `<oneKey>Plural`. */
const PLURAL_SUFFIX = 'Plural';

/** Count-sensitive messages whose missing pair previously escaped every gate. */
const REQUIRED_COUNTED_ONE_KEYS = [
  'time.secondsAgo',
  'time.minutesAgo',
  'time.hoursAgo',
  'activity.timeMinutesAgo',
  'activity.timeHoursAgo',
  'activity.timelineEvents',
  'toasts.emailsArchived',
  'toasts.emailsDeleted',
  'toasts.emailsRestored',
  'toasts.emailsNoLongerAvailable',
] as const;

// ─── Pure core (unit-tested on fixtures) ──────────────────────────────────────

export interface PluralCallSite {
  /** 1-based line of the call. */
  line: number;
  /** The `oneKey` literal, or null when it is not statically readable. */
  oneKey: string | null;
  /** The `otherKey` literal, or null when it is not statically readable. */
  otherKey: string | null;
}

export interface KeyedDefault {
  line: number;
  key: string;
}

export interface PluralFinding {
  path: string;
  line: number;
  /** Stable rule id - the same id appears in every locale-independent report. */
  rule:
    | 'keyed-default'
    | 'dynamic-pair'
    | 'missing-key'
    | 'identical-halves'
    | 'suffix'
    | 'slots'
    | 'unreachable'
    | 'single-form-counted';
  detail: string;
}

function lineOf(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (source[i] === '\n') line += 1;
  return line;
}

/** Literal value of `name: 'x'` inside a fragment, or null. */
function propLiteral(fragment: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*:\\s*(['"])((?:[^'"\\\\]|\\\\.)*)\\1`).exec(fragment);
  return match?.[2] ?? null;
}

/** Every `pluralMessage`/`pluralKey` call site in one file, with its pair. */
export function findPluralCalls(raw: string): PluralCallSite[] {
  const { code, inCode } = analyzeSource(raw);
  const found: PluralCallSite[] = [];
  for (const name of PAIR_CALLS) {
    const callRe = new RegExp(`(?:^|[^\\w$.])${name}\\s*\\(`, 'gm');
    for (const match of code.matchAll(callRe)) {
      const open = match.index + match[0].length - 1;
      // A call quoted in a string is a description of the call, not a call.
      if (inCode[open] !== 1) continue;
      // The pair is whatever argument CARRIES the halves - `pluralMessage` takes the
      // formatter first, `pluralKey` takes the pair first - so neither call's
      // argument order is baked into the gate.
      const pair =
        splitTopLevel(extractArgs(code, open)).find(
          (part) => propLiteral(part, 'oneKey') !== null || propLiteral(part, 'otherKey') !== null
        ) ?? '';
      found.push({
        line: lineOf(code, open),
        oneKey: propLiteral(pair, 'oneKey'),
        otherKey: propLiteral(pair, 'otherKey'),
      });
    }
  }
  return found.sort((a, b) => a.line - b.line);
}

/**
 * Every `default:` literal shaped like a translation key. A `default` is the
 * fallback MESSAGE for a MISSING key, so this position can never carry the key whose
 * text should ship.
 */
export function findKeyedDefaults(raw: string): KeyedDefault[] {
  const { code, inCode } = analyzeSource(raw);
  const found: KeyedDefault[] = [];
  for (const match of code.matchAll(/\bdefault\s*:\s*(['"])((?:[^'"\\]|\\.)*)\1/g)) {
    if (inCode[match.index] !== 1) continue;
    const key = match[2];
    if (!KEY_SHAPE_RE.test(key)) continue;
    found.push({ line: lineOf(code, match.index), key });
  }
  return found;
}

/** The `{slot}` names a message declares, sorted. */
export function slotsOf(message: string): string[] {
  const slots = new Set<string>();
  SLOT_RE.lastIndex = 0;
  for (let m = SLOT_RE.exec(message); m !== null; m = SLOT_RE.exec(message)) slots.add(m[1]);
  return [...slots].sort();
}

export interface PluralRegistry {
  /** `<path>` → its call sites (path is repo-relative POSIX). */
  sites: Array<PluralCallSite & { path: string }>;
  defaults: Array<KeyedDefault & { path: string }>;
  /** `en.json`: key → the `{slots}` it declares. */
  keys: Map<string, string[]>;
}

/**
 * The gate's rules, pure over the registry - so a fixture can prove each one fires
 * without touching the real dictionaries.
 */
export function checkPluralRegistry(registry: PluralRegistry): PluralFinding[] {
  const findings: PluralFinding[] = [];
  const { keys } = registry;

  for (const { path, line, key } of registry.defaults) {
    findings.push({
      path,
      line,
      rule: 'keyed-default',
      detail:
        `default: '${key}' - svelte-i18n reads default only when the key is MISSING, ` +
        'so this key can never render. Select a key by its count instead.',
    });
  }

  const paired = new Set<string>();
  for (const { path, line, oneKey, otherKey } of registry.sites) {
    if (oneKey === null || otherKey === null) {
      findings.push({
        path,
        line,
        rule: 'dynamic-pair',
        detail:
          'the { oneKey, otherKey } pair must be two string literals - a runtime pair cannot be checked',
      });
      continue;
    }

    const missing = [oneKey, otherKey].filter((key) => !keys.has(key));
    if (missing.length > 0) {
      for (const key of missing) {
        findings.push({
          path,
          line,
          rule: 'missing-key',
          detail: `'${key}' is not a key in src/locales/en.json - a miss renders the raw key text`,
        });
      }
      continue;
    }

    if (oneKey === otherKey) {
      findings.push({
        path,
        line,
        rule: 'identical-halves',
        detail: `both halves are '${oneKey}' - the plural form can never be reached`,
      });
      continue;
    }

    if (otherKey !== `${oneKey}${PLURAL_SUFFIX}`) {
      findings.push({
        path,
        line,
        rule: 'suffix',
        detail: `otherKey '${otherKey}' is not '${oneKey}${PLURAL_SUFFIX}' - the dictionaries name the plural half with the ${PLURAL_SUFFIX} suffix`,
      });
    }

    const oneSlots = keys.get(oneKey) ?? [];
    const otherSlots = keys.get(otherKey) ?? [];
    if (oneSlots.join(',') !== otherSlots.join(',')) {
      findings.push({
        path,
        line,
        rule: 'slots',
        detail:
          `the halves declare different slots - '${oneKey}' has {${oneSlots.join('}, {')}} ` +
          `and '${otherKey}' has {${otherSlots.join('}, {')}}`,
      });
    }

    paired.add(otherKey);
  }

  for (const oneKey of REQUIRED_COUNTED_ONE_KEYS) {
    const otherKey = `${oneKey}${PLURAL_SUFFIX}`;
    if (keys.has(oneKey) && (!keys.has(otherKey) || !paired.has(otherKey))) {
      findings.push({
        path: 'src/locales/en.json',
        line: 0,
        rule: 'single-form-counted',
        detail:
          `'${oneKey}' is count-sensitive and must ship as a statically paired ` +
          `'${oneKey}' / '${otherKey}' message used through pluralKey/pluralMessage`,
      });
    }
  }

  for (const [key] of keys) {
    if (!key.endsWith(PLURAL_SUFFIX)) continue;
    if (paired.has(key)) continue;
    findings.push({
      path: 'src/locales/en.json',
      line: 0,
      rule: 'unreachable',
      detail: `'${key}' no call site pairs with a singular - no count can reach this text`,
    });
  }

  return findings;
}

// ─── Repository scan ──────────────────────────────────────────────────────────

export function flattenKeys(
  obj: Record<string, unknown>,
  prefix = '',
  out = new Map<string, string[]>()
): Map<string, string[]> {
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(full, slotsOf(value));
    else if (value !== null && typeof value === 'object') {
      flattenKeys(value as Record<string, unknown>, full, out);
    }
  }
  return out;
}

/** The whole registry: every call site and keyed `default:` in the scanned tree. */
export function collectRegistry(): PluralRegistry {
  const registry: PluralRegistry = {
    sites: [],
    defaults: [],
    keys: flattenKeys(JSON.parse(readFileSync(EN_FILE, 'utf8')) as Record<string, unknown>),
  };
  // Repo-relative paths out of the shared lister, which skips exactly what
  // `.gitignore` covers - so this gate and `bun run check` see the same tree.
  for (const path of collectSourceFiles({ dirs: SCAN_DIRS, extensions: CODE_EXTS })) {
    if (SKIP_FILES.has(path)) continue;
    const raw = readFileSync(repoAbsolute(path), 'utf8');
    for (const site of findPluralCalls(raw)) registry.sites.push({ path, ...site });
    for (const entry of findKeyedDefaults(raw)) registry.defaults.push({ path, ...entry });
  }
  return registry;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const useColour = process.stdout.isTTY;
const red = (s: string) => (useColour ? `\x1b[31m${s}\x1b[0m` : s);
const green = (s: string) => (useColour ? `\x1b[32m${s}\x1b[0m` : s);
const bold = (s: string) => (useColour ? `\x1b[1m${s}\x1b[0m` : s);

function main(): void {
  if (!existsSync(EN_FILE)) {
    console.error(red(`Source locale file not found: ${EN_FILE}`));
    process.exit(1);
  }

  const registry = collectRegistry();
  const findings = checkPluralRegistry(registry);
  const pluralKeys = [...registry.keys.keys()].filter((key) => key.endsWith(PLURAL_SUFFIX));
  const paired = new Set(registry.sites.map((site) => site.otherKey).filter(Boolean));

  console.log(bold('\n=== Plural Keys ==='));
  console.log(
    `  en.json keys    : ${bold(String(registry.keys.size))} (${pluralKeys.length} plural)`
  );
  console.log(
    `  Plural sites    : ${bold(String(registry.sites.length))} · paired plurals: ${bold(String(paired.size))}`
  );
  console.log(
    `  Findings        : ${findings.length > 0 ? red(String(findings.length)) : green('0')}`
  );

  if (findings.length === 0) {
    console.log(`\n${green(bold('  Every plural pair is complete, distinct and reachable. ✓'))}\n`);
    process.exit(0);
  }

  console.log('');
  for (const finding of findings) {
    const where = finding.line > 0 ? `${finding.path}:${finding.line}` : finding.path;
    console.log(red(`  ${finding.rule}  ${where}`));
    console.log(`      ${finding.detail}`);
  }
  console.log(
    red(
      '\n  A plural message picks its key by COUNT, through pluralMessage() in\n' +
        '  src/utils/i18n/i18n-plural.ts - never through `default:`, which svelte-i18n\n' +
        '  reads only for a key that does not exist.\n'
    )
  );
  process.exit(1);
}

if (import.meta.main) main();
