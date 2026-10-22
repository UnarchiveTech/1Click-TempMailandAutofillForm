#!/usr/bin/env bun
/**
 * Background locale generator + verifier
 *
 * The MV3 service worker is bundled as a single self-contained file, so every
 * locale dictionary it imports - even via dynamic import() - gets inlined into
 * background.js. That duplicated all 8 full UI dictionaries (~700 KB) into the
 * worker, where only a small fraction of the keys are ever rendered.
 *
 * This script generates `src/locales/background/*.json` - per-language files
 * containing ONLY the keys the background actually uses plus the keys content
 * scripts request through the background `translate` handler:
 *
 *   1. Every file under src/entrypoints/background/ (the worker bundle).
 *   2. Every file under src/entrypoints/content/ (their t() requests are
 *      served by the background translate handler → same dictionary).
 *   3. The transitive import closure of the background + content entrypoints
 *      (shared feature modules, e.g. inbox-management.ts, inbox-export.ts).
 *
 * Keys are extracted from `t('...')` / `tSync('...')` calls with literal
 * string keys. Dynamic keys (template literals with ${}) are rejected so a
 * translation can never silently regress to a raw key.
 *
 * Usage:
 *   bun run generate-background-locales           # regenerate the files
 *   bun run check-background-locales              # verify they are up to date
 *   bun scripts/generate-background-locales.ts --check
 *
 * The --check mode exits 1 when:
 *   - the generated files differ from what would be generated now, or
 *   - any background-graph or content-graph file imports `@/utils/i18n/i18n-utils`
 *     (the full-dictionary module must stay out of those bundles).
 */

import { existsSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { collectAbsoluteFiles } from './source-files';
import { stripComments } from './source-lexer';

// ─── Configuration ────────────────────────────────────────────────────────────

const SRC_DIR = join(import.meta.dir, '..', 'src');
const LOCALES_DIR = join(SRC_DIR, 'locales');
const OUT_DIR = join(LOCALES_DIR, 'background');
const SOURCE_LOCALE = 'en';
const LOCALES = ['en', 'es', 'fr', 'de', 'ja', 'zh', 'ar', 'th'];

/** Directories whose whole contents belong to a bundle (no graph needed). */
const SCAN_DIRS = [
  join(SRC_DIR, 'entrypoints', 'background'),
  join(SRC_DIR, 'entrypoints', 'content'),
];

/** Entry files used as graph roots (in addition to the SCAN_DIRS sweep). */
const GRAPH_ROOTS = [
  join(SRC_DIR, 'entrypoints', 'background', 'index.ts'),
  join(SRC_DIR, 'entrypoints', 'content', 'index.ts'),
  join(SRC_DIR, 'entrypoints', 'ua-spoof.content.ts'),
  join(SRC_DIR, 'entrypoints', 'webmcp-bridge.content.ts'),
];

/** The full-dictionary module that must never enter background/content bundles. */
const FORBIDDEN_IMPORT = 'i18n-utils';

// ─── Helpers ─────────────────────────────────────────────────────────────────

type LocaleData = Record<string, unknown>;

const useColour = process.stdout.isTTY;
const red = (s: string) => (useColour ? `\x1b[31m${s}\x1b[0m` : s);
const yellow = (s: string) => (useColour ? `\x1b[33m${s}\x1b[0m` : s);
const green = (s: string) => (useColour ? `\x1b[32m${s}\x1b[0m` : s);
const bold = (s: string) => (useColour ? `\x1b[1m${s}\x1b[0m` : s);

/** Resolve an import specifier to a source file path, or null when external. */
function resolveImport(specifier: string, fromFile: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) {
    base = join(SRC_DIR, specifier.slice(2));
  } else if (specifier.startsWith('.')) {
    base = resolve(dirname(fromFile), specifier);
  } else {
    return null; // bare specifier → node_modules / wxt
  }
  // Drop query strings (e.g. '?raw')
  base = base.split('?')[0];

  const candidates: string[] = [];
  if (extname(base)) {
    candidates.push(base);
    if (base.endsWith('.js')) candidates.push(`${base.slice(0, -3)}.ts`);
  } else {
    candidates.push(
      `${base}.ts`,
      `${base}.js`,
      `${base}.tsx`,
      `${base}.svelte`,
      `${base}.json`,
      `${base}.jsonc`,
      join(base, 'index.ts'),
      join(base, 'index.js')
    );
  }
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return resolve(c);
  }
  return null;
}

const IMPORT_RE = /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_RE = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * All import specifiers in a file (static + dynamic). Comments are blanked with
 * the shared classifier first (offsets preserved), so a commented-out import is
 * not followed - and a URL or `/…/` regex inside code is not mistaken for one.
 */
function extractSpecifiers(source: string): string[] {
  const cleaned = stripComments(source);
  const out: string[] = [];
  for (const re of [IMPORT_RE, DYNAMIC_IMPORT_RE]) {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    for (m = re.exec(cleaned); m !== null; m = re.exec(cleaned)) out.push(m[1]);
  }
  return out;
}

/**
 * Translation calls with a literal first argument:
 *   t('key') / tSync('key') / t(`key`) / t("key")
 * `$t` (svelte-i18n store form) is excluded - UI-only, backed by the full
 * dictionaries. Calls with non-literal keys are returned separately so the
 * script can reject them instead of silently shipping a raw-key fallback.
 */
const CALL_RE = /(?<!\$)\b(t|tSync)\s*\(\s*(['"`])((?:\\.|(?!\2)[^\\])*)\2/g;

/**
 * Keys passed to t()/tSync() through a variable instead of a literal, e.g.
 * `t(getTranslationKeyForError(code))` in src/utils/errors.ts. Collected from
 * the two literal forms that feed those variables:
 *   - `[ErrorCode.X]: 'errors.key'` (the error-code → key map)
 *   - `translationKey: 'key'` / `translationKey = 'key'` (BaseExtensionError opts)
 */
const ERROR_MAP_KEY_RE = /\[ErrorCode\.[A-Z_]+\]\s*:\s*'([^']+)'/g;
const TRANSLATION_KEY_LITERAL_RE = /translationKey\s*(?::|=)\s*'([^']+)'/g;

/** Extract dot-notation keys from t()/tSync() calls; { dynamicKeys, staticKeys }. */
function extractKeys(source: string): { staticKeys: string[]; dynamicKeys: string[] } {
  const staticKeys: string[] = [];
  const dynamicKeys: string[] = [];
  let m: RegExpExecArray | null;
  CALL_RE.lastIndex = 0;
  for (m = CALL_RE.exec(source); m !== null; m = CALL_RE.exec(source)) {
    const raw = m[3];
    if (raw.includes('${')) {
      dynamicKeys.push(m[0].slice(0, 80));
    } else {
      staticKeys.push(raw);
    }
  }
  // Keys consumed indirectly via error-code maps / translationKey options
  for (const re of [ERROR_MAP_KEY_RE, TRANSLATION_KEY_LITERAL_RE]) {
    let e: RegExpExecArray | null;
    re.lastIndex = 0;
    for (e = re.exec(source); e !== null; e = re.exec(source)) staticKeys.push(e[1]);
  }
  return { staticKeys, dynamicKeys };
}

function flattenKeys(obj: LocaleData, prefix = '', out: Set<string> = new Set()): Set<string> {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.add(fullKey);
    else if (value !== null && typeof value === 'object')
      flattenKeys(value as LocaleData, fullKey, out);
  }
  return out;
}

/** Prune a full locale tree to exactly the used leaf keys (preserving structure). */
function pruneTree(data: LocaleData, used: Set<string>): LocaleData {
  const out: LocaleData = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') {
      if (used.has(key)) out[key] = value;
    } else if (value !== null && typeof value === 'object') {
      // The used set contains full dot-paths; find which children are used.
      const childUsed = new Set<string>();
      for (const full of used) {
        if (full === key) childUsed.add('');
        else if (full.startsWith(`${key}.`)) childUsed.add(full.slice(key.length + 1));
      }
      const pruned = pruneTree(value as LocaleData, childUsed);
      if (Object.keys(pruned).length > 0) out[key] = pruned;
    }
  }
  return out;
}

function sameTree(a: LocaleData, b: LocaleData): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ─── Graph traversal ──────────────────────────────────────────────────────────

interface GraphResult {
  files: string[]; // all visited source files (absolute)
  keys: Set<string>; // static translation keys used
  unknownKeys: Set<string>; // literal keys not present in en.json (possible false positives)
  dynamicKeys: string[]; // t()/tSync() calls with non-literal keys
  forbiddenImports: string[]; // "importer → i18n-utils" pairs in the graph
}

/** Walk entry files + directory sweeps, resolving the import closure. */
async function collectGraph(): Promise<GraphResult> {
  const files = new Set<string>();
  const keys = new Set<string>();
  const unknownKeys = new Set<string>();
  const dynamicKeys: string[] = [];
  const forbiddenImports: string[] = [];

  const visit = async (file: string): Promise<void> => {
    const abs = resolve(file);
    if (files.has(abs)) return;
    files.add(abs);

    const isSource = /\.(ts|js|tsx|svelte)$/.test(abs);
    // No catch: a missing/unreadable source file is a real error - swallowing
    // it would scan an empty file and silently drop its translation keys.
    const source = isSource ? await Bun.file(abs).text() : '';

    if (isSource) {
      const { staticKeys, dynamicKeys: dyn } = extractKeys(source);
      for (const k of dyn) dynamicKeys.push(`${relative(SRC_DIR, abs)}: ${k}`);
      for (const k of staticKeys) {
        if (EN_KEYS.has(k)) keys.add(k);
        else unknownKeys.add(k);
      }
    }

    if (!isSource) return;
    for (const spec of extractSpecifiers(source)) {
      const resolved = resolveImport(spec, abs);
      if (!resolved) continue;
      if (!resolved.startsWith(SRC_DIR)) continue; // external only
      if (resolved.includes(FORBIDDEN_IMPORT) && resolved.endsWith('.ts')) {
        forbiddenImports.push(`${relative(SRC_DIR, abs)} → ${relative(SRC_DIR, resolved)}`);
      }
      await visit(resolved);
    }
  };

  // The shared lister, so a gitignored file can neither enter the generated
  // dictionaries nor be reported as "in the graph" by --check.
  for (const dir of SCAN_DIRS) {
    for (const f of collectAbsoluteFiles(dir, ['.ts', '.js', '.tsx', '.svelte'])) await visit(f);
  }
  for (const root of GRAPH_ROOTS) {
    if (existsSync(root)) await visit(root);
  }

  return {
    files: [...files].sort(),
    keys,
    unknownKeys,
    dynamicKeys,
    forbiddenImports: [...new Set(forbiddenImports)],
  };
}

// ─── Load dictionaries ────────────────────────────────────────────────────────

const loadDict = async (file: string): Promise<LocaleData> =>
  (await Bun.file(file).json()) as LocaleData;

const EN_KEYS = flattenKeys(await loadDict(join(LOCALES_DIR, `${SOURCE_LOCALE}.json`)));

// ─── Main ─────────────────────────────────────────────────────────────────────

const isCheck = process.argv.includes('--check');
const graph = await collectGraph();

let problems = 0;

if (graph.dynamicKeys.length > 0) {
  problems += graph.dynamicKeys.length;
  console.error(red(`Dynamic translation keys found (must be literal):`));
  for (const d of graph.dynamicKeys) console.error(red(`  - ${d}`));
}

for (const file of graph.forbiddenImports) {
  problems += 1;
  console.error(red(`Full-dictionary module imported by background/content graph: ${file}`));
  console.error(
    yellow(
      `  Use the minimal background locale module (@/utils/i18n/i18n-background.js) instead of @/utils/i18n/i18n-utils.js.`
    )
  );
}
if (graph.unknownKeys.size > 0) {
  problems += graph.unknownKeys.size;
  console.error(
    red(`Literal t()/tSync() keys not present in en.json (${graph.unknownKeys.size}):`)
  );
  for (const k of [...graph.unknownKeys].sort()) console.error(red(`  - ${k}`));
}

// Generate the pruned dictionaries in memory
const generated: Record<string, LocaleData> = {};
for (const locale of LOCALES) {
  const full = await loadDict(join(LOCALES_DIR, `${locale}.json`));
  generated[locale] = pruneTree(full, graph.keys);
}

const keyCount = graph.keys.size;
const fullCount = EN_KEYS.size;

console.log(bold('\n=== Background Locales ==='));
console.log(`  Files scanned     : ${bold(String(graph.files.length))}`);
console.log(
  `  Keys used         : ${bold(String(keyCount))} of ${bold(String(fullCount))} (${Math.round((keyCount / fullCount) * 100)}%)`
);

let stale = false;
if (!existsSync(OUT_DIR)) {
  stale = true;
} else {
  for (const locale of LOCALES) {
    const disk = join(OUT_DIR, `${locale}.json`);
    if (!existsSync(disk)) {
      stale = true;
      break;
    }
    try {
      const onDisk = (await Bun.file(disk).json()) as LocaleData;
      if (!sameTree(onDisk, generated[locale])) {
        stale = true;
        break;
      }
    } catch {
      stale = true;
      break;
    }
  }
}

if (isCheck) {
  if (stale) {
    problems += 1;
    console.error(
      red(
        `  ✗ src/locales/background/*.json is out of date - run "bun run generate-background-locales".`
      )
    );
  } else {
    console.log(green(`  ✓ src/locales/background/*.json is up to date`));
  }
  console.log(
    problems > 0 ? red(`  ✗ ${problems} problem(s) found`) : green(`  ✓ No problems found`)
  );
  process.exit(problems > 0 ? 1 : 0);
}

// Write mode
if (stale || !existsSync(OUT_DIR)) {
  if (!existsSync(OUT_DIR)) {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(OUT_DIR, { recursive: true });
  }
  for (const locale of LOCALES) {
    const target = join(OUT_DIR, `${locale}.json`);
    await Bun.write(target, `${JSON.stringify(generated[locale], null, 2)}\n`);
    const size = Bun.file(target).size / 1024;
    console.log(`  ${locale.padEnd(6)} ${size.toFixed(1)} KB`);
  }
  console.log(
    green(
      `\n  Generated ${LOCALES.length} minimal locale files in ${relative(process.cwd(), OUT_DIR)}.`
    )
  );
} else {
  console.log(green(`  Already up to date - nothing to write.`));
}

if (problems > 0) process.exit(1);
