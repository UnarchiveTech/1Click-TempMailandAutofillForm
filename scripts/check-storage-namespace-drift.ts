#!/usr/bin/env bun
/**
 * check-storage-namespace-drift.ts
 *
 * Cross-checks the storage schema documented in audit/AUDIT_REPORT.md §6.4
 * ("browser.storage.local (persistent)" vs "browser.storage.session
 * (ephemeral)") against the ACTUAL write sites in src/, so the documentation
 * and the code cannot silently disagree about which namespace a key lives in.
 *
 * Pipeline:
 *   1. Parse §6.4 - the backticked keys under each namespace bullet become the
 *      DOCUMENTED claims. A trailing `*` marks a prefix pattern
 *      (`selectedInstance_*`). No hand-maintained copy: editing the report
 *      edits the claims.
 *   2. Scan src/ (TS + Svelte <script>) with the TypeScript compiler API and
 *      collect every storage write (`browser|chrome).storage.(local|session)
 *      .set(...)` / `.remove(...)`, plus the storage layer's retrying wrapper
 *      `writeWithRetry({...})`, which defaults to local but honors an explicit
 *      `{ area: browser.storage.session }` option).
 *      Key arguments are resolved through string
 *      literals, arrays, `const NAME = '...'` declarations (FILE-LOCAL
 *      declarations shadow the global pool so a shared name like `KEY` always
 *      resolves to the declaring file's value), and `prefix_${...}` templates
 *      (recorded as a prefix pattern).
 *   3. Report:
 *        ERROR  (exit 1) - a documented key is SET in the opposite namespace.
 *        UNDOCUMENTED (exit 1) - a written key claimed by neither §6.4 nor the
 *               StorageKey union in src/utils/storage/storage-keys.ts (gate enforced
 *               by `bun run audit` and the pre-commit hook).
 *        STALE  (warning) - a documented key is never written anywhere.
 *        REMOVE-ONLY (info) - a key is only removed in the other namespace
 *               (legacy cleanup is tolerated).
 *
 * Usage: bun scripts/check-storage-namespace-drift.ts
 */

import { join } from 'node:path';
import ts from 'typescript';
import { collectAbsoluteFiles } from './source-files';

const SRC_DIR = join(process.cwd(), 'src');
const REPORT_PATH = join(process.cwd(), 'audit/AUDIT_REPORT.md');
const STORAGE_KEYS_PATH = join(process.cwd(), 'src/utils/storage/storage-keys.ts');

type Area = 'local' | 'session';

interface Claims {
  local: { exact: Set<string>; patterns: string[] };
  session: { exact: Set<string>; patterns: string[] };
}

export interface Inventory {
  setKeys: Map<Area, Set<string>>;
  setPatterns: Map<Area, string[]>;
  removeKeys: Map<Area, Set<string>>;
}

export function createInventory(): Inventory {
  return {
    setKeys: new Map([
      ['local', new Set<string>()],
      ['session', new Set<string>()],
    ]),
    setPatterns: new Map([
      ['local', [] as string[]],
      ['session', [] as string[]],
    ]),
    removeKeys: new Map([
      ['local', new Set<string>()],
      ['session', new Set<string>()],
    ]),
  };
}

/** ------------------------------------------------------------------ */
/* 1. Parse the documented schema out of AUDIT_REPORT.md §6.4.          */
/** ------------------------------------------------------------------ */

async function parseReportClaims(): Promise<Claims | null> {
  const report = await Bun.file(REPORT_PATH).text();
  const sectionStart = report.indexOf('### 6.4 Storage Schema');
  if (sectionStart === -1) {
    console.error(`audit: '### 6.4 Storage Schema' not found in ${REPORT_PATH}`);
    return null;
  }
  const rest = report.slice(sectionStart);
  // Stop at the next top-level section (## or ###) - but 6.4's own bullets
  // are nested under "### 6.4", so slice to the following "### 6.5".
  const nextSection = rest.search(/\n### 6\.5\b/);
  const section = nextSection === -1 ? rest : rest.slice(0, nextSection);

  const localHeader = section.indexOf('**browser.storage.local**');
  const sessionHeader = section.indexOf('**browser.storage.session**');
  if (localHeader === -1 || sessionHeader === -1 || sessionHeader < localHeader) {
    console.error('audit: could not find both storage-namespace bullets in §6.4');
    return null;
  }

  const tokens = (bulletLines: string[]): { exact: Set<string>; patterns: string[] } => {
    const exact = new Set<string>();
    const patterns: string[] = [];
    for (const line of bulletLines) {
      for (const m of line.matchAll(/`([^`]+)`/g)) {
        const key = m[1].trim();
        if (!key) continue;
        if (key.endsWith('*')) patterns.push(key.slice(0, -1));
        else exact.add(key);
      }
    }
    return { exact, patterns };
  };

  const bulletLines = (start: number, end: number): string[] => {
    const lines: string[] = [];
    for (const line of section.slice(start, end).split('\n')) {
      if (/^\s*-\s+/.test(line)) lines.push(line);
    }
    return lines;
  };

  // Local section: bullets between the local header and the session header.
  // Session section: bullets between the session header and the next bold
  // marker (e.g. "**Internal fields...**") or the section end.
  const localLines = bulletLines(localHeader, sessionHeader);
  const afterSession = section.slice(sessionHeader + '**browser.storage.session**'.length);
  const sessionSectionEnd =
    afterSession.search(/\n\*\*[^*]/) === -1
      ? section.length
      : sessionHeader + '**browser.storage.session**'.length + afterSession.search(/\n\*\*[^*]/);
  const sessionLines = bulletLines(sessionHeader, sessionSectionEnd);

  return { local: tokens(localLines), session: tokens(sessionLines) };
}

/** ------------------------------------------------------------------ */
/* 2. Inventory every storage write site in src/.                       */
/** ------------------------------------------------------------------ */

export interface ConstEntry {
  value: string;
  file: string;
}

async function collectFiles(dir: string): Promise<string[]> {
  // The shared lister, so this gate audits exactly the files `bun run check` sees.
  return collectAbsoluteFiles(dir, ['.ts', '.tsx', '.js', '.jsx', '.svelte']);
}

/** Segment list: whole text for TS/JS, each <script> block for Svelte. */
export function segmentsOfText(
  text: string,
  isSvelte: boolean
): { text: string; offset: number }[] {
  if (!isSvelte) return [{ text, offset: 0 }];
  const segments: { text: string; offset: number }[] = [];
  for (const m of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
    const contentStart = (m.index ?? 0) + m[0].indexOf('>') + 1;
    segments.push({ text: m[1], offset: contentStart });
  }
  return segments;
}

async function segmentsOf(file: string): Promise<{ text: string; offset: number }[]> {
  const text = await Bun.file(file).text();
  return segmentsOfText(text, file.endsWith('.svelte'));
}

/**
 * Per-file `const X = 'value'` declarations, keyed by the declaring file.
 *
 * Resolution must be FILE-LOCAL: a global name→value map is wrong the moment
 * two files declare the same name (`KEY`, `SETTINGS_KEY`, …) - whichever file
 * the scanner happens to visit last wins, so a write in file A using `[KEY]`
 * resolves to file B's value and the REAL key silently vanishes from the
 * inventory (exactly how `smartAutofillSettings` was masked by another file's
 * `KEY`). The caller merges the global pool as a fallback for imported
 * constants, then lets the current file's own declarations SHADOW it.
 */
export function collectConstants(
  fileTexts: ReadonlyMap<string, string>
): Map<string, Map<string, ConstEntry>> {
  const byFile = new Map<string, Map<string, ConstEntry>>();
  for (const [file, fileText] of fileTexts) {
    const local = new Map<string, ConstEntry>();
    for (const { text } of segmentsOfText(fileText, file.endsWith('.svelte'))) {
      const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const scan = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node)) {
          const init = node.initializer;
          const value = init && ts.isStringLiteral(init) ? init.text : undefined;
          if (ts.isIdentifier(node.name) && value !== undefined) {
            local.set(node.name.text, { value, file });
          }
        }
        ts.forEachChild(node, scan);
      };
      scan(sf);
    }
    byFile.set(file, local);
  }
  return byFile;
}

/**
 * Per-file const resolution: the global fallback pool first, then THIS file's
 * own `const NAME = '...'` declarations shadow it - so a common name like
 * `KEY` always resolves to the declaring file's value and can't hide an
 * undocumented write behind another file's same-named constant.
 */
export function resolveConstsForFile(
  file: string,
  constsByFile: Map<string, Map<string, ConstEntry>>,
  globalPool: Map<string, ConstEntry>
): Map<string, ConstEntry> {
  const consts = new Map(globalPool);
  for (const [name, entry] of constsByFile.get(file) ?? []) consts.set(name, entry);
  return consts;
}

function resolveKeyExpr(
  node: ts.Expression | undefined,
  consts: Map<string, ConstEntry>,
  out: { exact: Set<string>; patterns: string[] }
): void {
  if (!node) return;
  if (ts.isStringLiteral(node)) {
    out.exact.add(node.text);
    return;
  }
  if (ts.isIdentifier(node)) {
    const resolved = consts.get(node.text);
    if (resolved) out.exact.add(resolved.value);
    return;
  }
  if (ts.isNoSubstitutionTemplateLiteral(node)) {
    out.exact.add(node.text);
    return;
  }
  if (ts.isTemplateExpression(node)) {
    if (node.head.isUnterminated) return;
    if (node.head.text && node.templateSpans.length === 0) {
      out.exact.add(node.head.text);
      return;
    }
    // `prefix_${...}rest` - record the literal head as a prefix pattern when
    // the substitution starts right after a `_`-terminated literal.
    const headText = node.head.text;
    if (headText.endsWith('_')) out.patterns.push(headText);
    return;
  }
  if (ts.isPropertyAccessExpression(node)) {
    const base = consts.get(node.name.text);
    if (base) out.exact.add(base.value);
    return;
  }
}

function addObjectKeys(
  obj: ts.ObjectLiteralExpression,
  consts: Map<string, ConstEntry>,
  out: { exact: Set<string>; patterns: string[] }
): void {
  for (const prop of obj.properties) {
    if (ts.isPropertyAssignment(prop)) {
      // `key: v` (plain identifier or string) vs `[KEY]: v` / `['key']: v`
      // (computed - the name is wrapped in ComputedPropertyName).
      if (ts.isComputedPropertyName(prop.name)) {
        resolveKeyExpr(prop.name.expression, consts, out);
      } else if (ts.isIdentifier(prop.name)) {
        out.exact.add(prop.name.text);
      } else if (ts.isStringLiteral(prop.name)) {
        out.exact.add(prop.name.text);
      }
    } else if (ts.isShorthandPropertyAssignment(prop)) {
      // `{ pendingGestureTokens }` - the shorthand NAME is the storage key.
      out.exact.add(prop.name.text);
    }
  }
}

/**
 * Object literals assigned to variables (`const viewPayload = {...}`) whose
 * keys are later passed to a storage write via the identifier - the scanner
 * resolves the identifier to those keys.
 */
function collectObjectLiterals(sf: ts.SourceFile): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const literalKeys = (node: ts.Node): Set<string> | null => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const init = node.initializer;
      const obj = ts.isParenthesizedExpression(init) ? init.expression : init;
      if (ts.isObjectLiteralExpression(obj)) {
        const keys = new Set<string>();
        for (const prop of obj.properties) {
          if (ts.isPropertyAssignment(prop)) {
            // Computed names are wrapped in ComputedPropertyName, so plain
            // identifier/string names are never computed.
            if (ts.isIdentifier(prop.name)) keys.add(prop.name.text);
            else if (ts.isStringLiteral(prop.name)) keys.add(prop.name.text);
          } else if (ts.isShorthandPropertyAssignment(prop)) {
            keys.add(prop.name.text);
          }
        }
        return keys.size > 0 ? keys : null;
      }
    }
    return null;
  };

  // Pass 1: object-literal declarations (`const viewPayload = {...}`).
  const walk = (node: ts.Node): void => {
    const keys = literalKeys(node);
    if (keys && ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      map.set(node.name.text, keys);
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);

  // Pass 2: later mutations (`viewPayload.openExtensionTarget = 'popup'`).
  const walkMutations = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      ts.isIdentifier(node.left.expression)
    ) {
      const existing = map.get(node.left.expression.text);
      if (existing) existing.add(node.left.name.text);
    }
    ts.forEachChild(node, walkMutations);
  };
  walkMutations(sf);
  return map;
}

export function scanSegment(
  text: string,
  consts: Map<string, ConstEntry>,
  inventory: Inventory
): void {
  const sf = ts.createSourceFile('seg.ts', text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const objectRegistry = collectObjectLiterals(sf);
  const areaOf = (base: ts.Expression): Area | null => {
    const t = base.getText(sf);
    if (/(?:browser|chrome)\.storage\.local$/.test(t)) return 'local';
    if (/(?:browser|chrome)\.storage\.session$/.test(t)) return 'session';
    return null;
  };
  /** Record the keys of one write call, resolving its first argument. */
  const addWrite = (area: Area, isSet: boolean, first: ts.Expression | undefined): void => {
    const target = isSet ? inventory.setKeys : inventory.removeKeys;
    const patterns = isSet ? inventory.setPatterns : null;
    const out = { exact: new Set<string>(), patterns: [] as string[] };
    if (first) {
      if (ts.isObjectLiteralExpression(first)) addObjectKeys(first, consts, out);
      else if (ts.isArrayLiteralExpression(first)) {
        for (const el of first.elements) {
          if (ts.isStringLiteral(el)) out.exact.add(el.text);
          else if (ts.isIdentifier(el)) {
            const resolved = consts.get(el.text);
            if (resolved) out.exact.add(resolved.value);
            else for (const k of objectRegistry.get(el.text) ?? []) out.exact.add(k);
          }
        }
      } else if (ts.isIdentifier(first)) {
        const resolved = consts.get(first.text);
        if (resolved) out.exact.add(resolved.value);
        else for (const k of objectRegistry.get(first.text) ?? []) out.exact.add(k);
      } else {
        resolveKeyExpr(first, consts, out);
      }
    }
    const keySet = target.get(area);
    if (keySet) for (const k of out.exact) keySet.add(k);
    const patternList = patterns?.get(area);
    if (patternList) for (const p of out.patterns) patternList.push(p);
  };

  const walk = (node: ts.Node): void => {
    // The storage layer's retrying wrapper is the SAME `storage.local.set` one
    // layer down - inventoried as a local write so routing a site through it
    // cannot retire the key here while the write keeps happening. The
    // serializing read-modify-write helper is the other half of that layer: it
    // takes the key as its FIRST argument and writes it whole, so a key whose
    // only writer is `updateStoredObject('K', …)` is just as written as one
    // spelled `writeWithRetry({ K: … })` - without this, migrating a site to
    // the serialized pair silently dropped the key out of the inventory (a
    // documented key then read as "never written", the STALE half of this gate).
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      (node.expression.text === 'writeWithRetry' || node.expression.text === 'updateStoredObject')
    ) {
      let area: Area = 'local';
      const options = node.arguments[1];
      if (
        node.expression.text === 'writeWithRetry' &&
        options &&
        ts.isObjectLiteralExpression(options)
      ) {
        const areaOption = options.properties.find(
          (property) => ts.isPropertyAssignment(property) && property.name.getText(sf) === 'area'
        );
        if (areaOption && ts.isPropertyAssignment(areaOption))
          area = areaOf(areaOption.initializer) ?? 'local';
      }
      addWrite(area, true, node.arguments[0]);
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      if (method === 'set' || method === 'remove') {
        const area = areaOf(node.expression.expression);
        if (area) addWrite(area, method === 'set', node.arguments[0]);
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
}

/** ------------------------------------------------------------------ */
/* 3. Compare claims vs inventory.                                      */
/** ------------------------------------------------------------------ */

function matchesAny(
  keyOrPattern: string,
  area: Area,
  inventory: Inventory,
  kind: 'set' | 'remove'
): boolean {
  const keys =
    (kind === 'set' ? inventory.setKeys.get(area) : inventory.removeKeys.get(area)) ??
    new Set<string>();
  if (keyOrPattern.endsWith('*')) {
    const prefix = keyOrPattern.slice(0, -1);
    for (const k of keys) if (k.startsWith(prefix)) return true;
    return false;
  }
  return keys.has(keyOrPattern);
}

async function main(): Promise<void> {
  const claims = await parseReportClaims();
  if (!claims) process.exit(1);

  const files = await collectFiles(SRC_DIR);
  const fileEntries = await Promise.all(
    files.map(async (file) => [file, await Bun.file(file).text()] as const)
  );
  const constsByFile = collectConstants(new Map(fileEntries));

  // Global fallback pool for identifiers a file does not declare itself
  // (genuine cross-file/imported constants). Last-wins is fine HERE because a
  // file's own declarations are always merged on top per-file below.
  const globalConsts = new Map<string, ConstEntry>();
  for (const local of constsByFile.values()) {
    for (const [name, entry] of local) globalConsts.set(name, entry);
  }

  const inventory = createInventory();

  for (const file of files) {
    const consts = resolveConstsForFile(file, constsByFile, globalConsts);
    for (const { text } of await segmentsOf(file)) scanSegment(text, consts, inventory);
  }

  // Keys documented in the code-level StorageKey union count as documented
  // (exact members plus template-type patterns like `selectedInstance_${string}`).
  const storageKeysText = await Bun.file(STORAGE_KEYS_PATH).text();
  const documentedInCode = new Set<string>();
  const documentedInCodePatterns: string[] = [];
  for (const m of storageKeysText.matchAll(/^\s*\| '([^']+)';?$/gm)) documentedInCode.add(m[1]);
  // Template-type patterns may span one union line (ProviderStorageKey) or
  // appear as dedicated members - collect every `prefix_${string}` shape.
  for (const m of storageKeysText.matchAll(/`([A-Za-z0-9_]+_)\$\{string}/g)) {
    documentedInCodePatterns.push(m[1]);
  }

  const errors: string[] = [];
  const undocTotal = (): number =>
    (undocumented.get('local') ?? new Set()).size + (undocumented.get('session') ?? new Set()).size;
  const stale: string[] = [];
  const removeOnly: string[] = [];
  const mirrored: string[] = [];
  const undocumented = new Map<Area, Set<string>>();

  for (const area of ['local', 'session'] as Area[]) {
    const other: Area = area === 'local' ? 'session' : 'local';
    const claim = claims[area];
    const claimAll = [...claim.exact, ...claim.patterns.map((p) => `${p}*`)];
    const coveredByCode = (key: string): boolean => {
      if (key.endsWith('*')) {
        const prefix = key.slice(0, -1);
        return documentedInCodePatterns.some((p) => prefix.startsWith(p) || p.startsWith(prefix));
      }
      return documentedInCode.has(key) || documentedInCodePatterns.some((p) => key.startsWith(p));
    };
    for (const key of claimAll) {
      const setHere = matchesAny(key, area, inventory, 'set');
      const setOther = matchesAny(key, other, inventory, 'set');
      if (setOther && !setHere) {
        // Written only in the OPPOSITE namespace - the doc's placement is
        // wrong. (Keys written in BOTH areas - mirrored handoffs - pass.)
        errors.push(`${key} documented in ${area} but only ever SET in ${other}`);
      } else if (setOther && setHere) {
        mirrored.push(`${key} (documented ${area}) is also SET in ${other}`);
      } else if (!setHere && !setOther) {
        const removedHere = matchesAny(key, area, inventory, 'remove');
        const removedOther = matchesAny(key, other, inventory, 'remove');
        if (!removedHere && !removedOther) {
          // Still documented in the StorageKey union → code-level doc is fine;
          // the write may go through an un-resolvable helper.
          if (!coveredByCode(key)) {
            stale.push(`${key} (documented ${area}) is never written or removed`);
          }
        } else if (!coveredByCode(key)) {
          // Union-covered keys may be set via helpers (safeStorageSet etc.)
          // that the scanner cannot see - don't cry wolf.
          removeOnly.push(`${key} (documented ${area}) is only removed - never set`);
        }
      } else if (matchesAny(key, other, inventory, 'remove')) {
        removeOnly.push(`${key} (documented ${area}) is removed in ${other} (legacy cleanup?)`);
      }
    }

    // Undocumented: actual keys claimed by NEITHER §6.4 (either area - dual
    // keys need only one home) NOR the StorageKey union.
    const actual = new Set(inventory.setKeys.get(area) ?? []);
    for (const p of inventory.setPatterns.get(area) ?? []) actual.add(`${p}*`);
    for (const k of inventory.removeKeys.get(area) ?? []) actual.add(k);
    const known = new Set([
      ...claim.exact,
      ...claims[other].exact,
      ...claim.patterns.map((p) => `${p}*`),
      ...claims[other].patterns.map((p) => `${p}*`),
      ...documentedInCode,
    ]);
    const knownPatterns = [
      ...claim.patterns,
      ...claims[other].patterns,
      ...documentedInCodePatterns,
    ];
    const undoc = new Set<string>();
    for (const k of actual) {
      const covered = known.has(k) || knownPatterns.some((p) => k.startsWith(p));
      if (!covered && !k.startsWith('_')) undoc.add(k);
    }
    undocumented.set(area, undoc);
  }

  const printSet = (label: string, set: Set<string>): void => {
    if (set.size === 0) return;
    const sorted = [...set].sort();
    console.error(`\n${label} (${sorted.length}):`);
    for (const k of sorted.slice(0, 40)) console.error(`  ${k}`);
    if (sorted.length > 40) console.error(`  …and ${sorted.length - 40} more`);
  };

  printSet(
    'UNDOCUMENTED local writes (not in §6.4 or StorageKey union)',
    undocumented.get('local') ?? new Set()
  );
  printSet(
    'UNDOCUMENTED session writes (not in §6.4 or StorageKey union)',
    undocumented.get('session') ?? new Set()
  );

  if (mirrored.length) {
    console.error(`\nDUAL-AREA SETS (${mirrored.length}):`);
    for (const r of mirrored) console.error(`  ${r}`);
  }
  if (removeOnly.length) {
    console.error(`\nREMOVE-ONLY / other-namespace removals (${removeOnly.length}):`);
    for (const r of removeOnly) console.error(`  ${r}`);
  }
  if (stale.length) {
    console.error(`\nSTALE DOC CLAIMS (${stale.length}):`);
    for (const s of stale) console.error(`  ${s}`);
  }
  if (errors.length || undocTotal() > 0) {
    if (errors.length) {
      console.error(`\nNAMESPACE DRIFT (${errors.length}):`);
      for (const e of errors) console.error(`  ✗ ${e}`);
    }
    if (undocTotal() > 0) {
      console.error(`\nUNDOCUMENTED WRITTEN KEYS (${undocTotal()}):`);
      for (const area of ['local', 'session'] as Area[]) {
        for (const k of [...(undocumented.get(area) ?? [])].sort())
          console.error(`  ${area}: ${k}`);
      }
    }
    console.error(
      '\nFix the write site, the §6.4 documentation, or the StorageKey union before this check passes.'
    );
    process.exit(1);
  }

  console.error(
    `\nScanned ${files.length} file(s): ${errors.length} drift, ${stale.length} stale, ` +
      `${mirrored.length} dual-area, ${removeOnly.length} remove-only, ` +
      `${(undocumented.get('local') ?? new Set()).size} undocumented local, ` +
      `${(undocumented.get('session') ?? new Set()).size} undocumented session.`
  );
  if (errors.length === 0 && stale.length === 0 && undocTotal() === 0)
    console.log('✓ §6.4 storage schema matches actual write sites.');
}

if (import.meta.main) main();
