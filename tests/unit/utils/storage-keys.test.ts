/**
 * Dead-member test for the StorageKey union.
 *
 * The StorageKey union in src/utils/storage/storage-keys.ts is the single source of
 * truth for every storage key the extension may touch, and
 * scripts/check-storage-namespace-drift.ts already fails the gate when a key
 * is WRITTEN in src without a union member. This test closes the reverse
 * direction: every member of the union must actually be READ or WRITTEN
 * somewhere in src/ - so dead members (listed in the union but never used)
 * are detected too.
 *
 * Because TypeScript unions are erased at runtime, the test parses the union
 * source with the compiler API, then scans every src/ file (AST walk, so
 * string literals, template chunks, object property/shorthand names, and
 * references to the key-holding consts declared in storage-keys.ts all count
 * as evidence). The union declarations themselves are excluded from the scan -
 * otherwise every member would trivially "reference" itself.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { PROJECT_ROOT } from '../helpers/project-root.js';

const KEYS_REL_PATH = 'utils/storage/storage-keys.ts';
const SRC_DIR = `${PROJECT_ROOT}/src`;
const KEYS_FILE = `${SRC_DIR}/${KEYS_REL_PATH}`;

interface UnionMember {
  /** Exact union code text, e.g. `domainIndex_${string}_${string}`. */
  literal: string;
  /** Exact value for literal members; the static head for pattern members. */
  key: string;
  isPattern: boolean;
  /** Fixed prefix of a `${string}` template member ('' for exact members). */
  prefix: string;
  /** file (relative to src/) → kinds of evidence found there. */
  byFile: Map<string, Set<string>>;
}

function parseSource(text: string, fileName: string, kind: ts.ScriptKind): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
}

function addMember(
  members: UnionMember[],
  literal: string,
  key: string,
  isPattern: boolean,
  prefix: string
): void {
  if (members.some((m) => m.literal === literal)) return;
  members.push({
    literal,
    key,
    isPattern,
    prefix,
    byFile: new Map(),
  });
}

function collectUnionType(members: UnionMember[], node: ts.Node): void {
  // TS 6 parses `'foo'` type members as LiteralType nodes wrapping a
  // StringLiteral (not bare StringLiteral nodes).
  if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) {
    addMember(members, node.literal.text, node.literal.text, false, '');
    return;
  }
  // Template literal types use `head` in TS 6 (was `template` in TS 5);
  // TS 6 exposes the substitution types via `templateSpans[*].type` (no
  // `types` array), so a non-empty span list marks a ${string} pattern.
  if (ts.isTemplateLiteralTypeNode(node)) {
    const isPattern = node.templateSpans.length > 0;
    const headText = node.head.text;
    addMember(members, node.getText(), headText, isPattern, isPattern ? headText : '');
  }
}

function collectAliases(
  text: string,
  members: UnionMember[],
  excludedSpans: Array<[number, number]>
): Map<string, string> {
  const sf = parseSource(text, KEYS_FILE, ts.ScriptKind.TS);
  const constMap = new Map<string, string>();

  for (const statement of sf.statements) {
    if (ts.isTypeAliasDeclaration(statement)) {
      const name = (statement.name as ts.Identifier).text;
      if (name !== 'StorageKey' && name !== 'ProviderStorageKey') continue;
      excludedSpans.push([statement.getStart(sf), statement.end]);
      if (ts.isUnionTypeNode(statement.type)) {
        for (const t of statement.type.types) collectUnionType(members, t);
      } else {
        collectUnionType(members, statement.type);
      }
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const name = declaration.name;
        const init = declaration.initializer;
        if (
          ts.isIdentifier(name) &&
          init !== undefined &&
          (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init))
        ) {
          constMap.set(name.text, init.text);
        }
      }
    }
  }
  return constMap;
}

function recordEvidence(
  members: UnionMember[],
  value: string,
  file: string,
  kind: string,
  exactOnly = false
): void {
  if (value.length === 0) return;
  for (const member of members) {
    let hit = false;
    if (member.isPattern) {
      hit = !exactOnly && member.prefix !== '' && value.startsWith(member.prefix);
    } else {
      hit = value === member.key;
    }
    if (hit) {
      const kinds = member.byFile.get(file) ?? new Set<string>();
      kinds.add(kind);
      member.byFile.set(file, kinds);
    }
  }
}

/** Scan one parsed source file for evidence of every union member. */
function scanParsed(
  sf: ts.SourceFile,
  members: UnionMember[],
  file: string,
  constMap: Map<string, string>,
  skipSpans: Array<[number, number]>
): void {
  function isExcluded(start: number, end: number): boolean {
    return skipSpans.some(([s, e]) => start >= s && end <= e);
  }

  function walk(node: ts.Node): void {
    if (isExcluded(node.getStart(sf), node.end)) return;

    if (ts.isStringLiteral(node)) {
      // String literals are pattern-eligible: `'customInstances_'` (or any
      // literal starting with a ${string} prefix) is real production evidence.
      recordEvidence(members, node.text, file, 'string-literal');
    } else if (ts.isNoSubstitutionTemplateLiteral(node)) {
      recordEvidence(members, node.text, file, 'template-literal');
    } else if (ts.isTemplateExpression(node)) {
      // Builder functions emit patterns as template expressions whose HEAD
      // chunk carries the static prefix (e.g. `customInstances_${provider}` -
      // the first span's literal is only the text after the first ${}).
      recordEvidence(members, node.head.text, file, 'template-head');
      for (const span of node.templateSpans) {
        recordEvidence(members, span.literal.text, file, 'template-chunk');
      }
    } else if (ts.isTemplateLiteralTypeNode(node)) {
      // A template literal TYPE (e.g. a `domainIndex_${string}_${string}`
      // return annotation) is type-level usage of the pattern member.
      recordEvidence(members, node.head.text, file, 'type-annotation');
    } else if (ts.isShorthandPropertyAssignment(node)) {
      recordEvidence(members, (node.name as ts.Identifier).text, file, 'shorthand-prop', true);
    } else if (ts.isPropertyAssignment(node)) {
      const name = node.name;
      if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
        recordEvidence(members, name.text, file, 'property-name', true);
      }
    } else if (ts.isIdentifier(node)) {
      const constValue = constMap.get(node.text);
      if (constValue !== undefined) {
        recordEvidence(members, constValue, file, 'const-ref');
      }
    }
    ts.forEachChild(node, walk);
  }

  for (const statement of sf.statements) walk(statement);
}

function scanSourceFile(
  file: string,
  members: UnionMember[],
  constMap: Map<string, string>,
  skipSpans: Array<[number, number]>
): void {
  const text = readFileSync(`${SRC_DIR}/${file}`, 'utf8');
  if (file === KEYS_REL_PATH) {
    scanParsed(parseSource(text, file, ts.ScriptKind.TS), members, file, constMap, skipSpans);
    return;
  }
  if (file.endsWith('.svelte')) {
    const scriptRe = /<script\b[^>]*>([\s\S]*?)<\/script>/g;
    for (let m = scriptRe.exec(text); m !== null; m = scriptRe.exec(text)) {
      const block = parseSource(m[1], `${file}#script`, ts.ScriptKind.TS);
      scanParsed(block, members, file, constMap, []);
    }
    // Svelte markup templates hold inline handlers with their own object
    // literals (e.g. `onclick={() => set({ pendingProductTourAt: Date.now() })}`)
    // that never enter a <script> block - give exact members a raw-word
    // occurrence in the markup as evidence.
    const markup = text.replace(new RegExp(scriptRe.source, 'g'), '');
    for (const member of members) {
      if (member.isPattern) continue;
      const escaped = member.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`\\b${escaped}\\b`).test(markup)) {
        recordEvidence(members, member.key, file, 'markup-word', true);
      }
    }
    return;
  }
  const kind = file.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : file.endsWith('.jsx')
      ? ts.ScriptKind.JSX
      : file.endsWith('.js')
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
  scanParsed(parseSource(text, file, kind), members, file, constMap, []);
}

// ─── Setup: parse the union + consts, then scan every src/ file ────────────

const members: UnionMember[] = [];
const excludedSpans: Array<[number, number]> = [];
const constMap = collectAliases(readFileSync(KEYS_FILE, 'utf8'), members, excludedSpans);

const allFiles = (await Array.fromAsync(new Bun.Glob('**/*.{ts,tsx,js,jsx,svelte}').scan(SRC_DIR)))
  .map((f) => f.replace(/\\/g, '/'))
  .sort();

for (const file of allFiles) {
  scanSourceFile(file, members, constMap, excludedSpans);
}

const exactMembers = members.filter((m) => !m.isPattern);
const patternMembers = members.filter((m) => m.isPattern);

function describeDead(dead: UnionMember[], label: string): string {
  if (dead.length === 0) return '';
  const lines = dead.map((m) => {
    const samples = [...m.byFile.entries()]
      .slice(0, 3)
      .map(([f, kinds]) => `${f} (${[...kinds].join(',')})`);
    return `  - ${m.literal}${samples.length ? ` - referenced only as: ${samples.join('; ')}` : ''}`;
  });
  return `${label}:\n${lines.join('\n')}\n`;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('StorageKey union members are used in src', () => {
  test('the union parsed with a substantial member count', () => {
    expect(members.length).toBeGreaterThan(120);
    expect(allFiles).toContain(KEYS_REL_PATH);
  });

  test('every exact-string member is read or written somewhere in src/', () => {
    const dead = exactMembers.filter((m) => m.byFile.size === 0);
    const msg =
      `Dead exact StorageKey members - listed in the union but never read or written ` +
      `anywhere in src/ (outside the union declarations). Remove them or wire up usage.\n` +
      describeDead(dead, 'Dead members');
    expect(dead.length, msg.trimEnd()).toBe(0);
  });

  test('every template-pattern member is produced somewhere in src/', () => {
    const dead = patternMembers.filter((m) => m.byFile.size === 0);
    const msg =
      `Dead StorageKey template patterns - the static prefix never appears in src/ ` +
      `(no key builder call, prefix const, or template literal builds one).\n` +
      describeDead(dead, 'Dead patterns');
    expect(dead.length, msg.trimEnd()).toBe(0);
  });
});
