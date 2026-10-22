/**
 * One-shot codemod: replace WXT auto-imports (unimport) with explicit imports.
 *
 * Reads the generated `.wxt/types/imports.d.ts` to build the exact
 * symbol -> module map unimport injects, finds files that USE those symbols
 * without importing/declaring them, and inserts explicit import statements.
 * Only ADDS import lines - never modifies or removes existing code - so it
 * layers safely on top of uncommitted work in the shared tree.
 *
 * Usage:
 *   bun scripts/migrate-auto-imports.ts           # dry-run report
 *   bun scripts/migrate-auto-imports.ts --write   # apply
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const WRITE = process.argv.includes('--write');
const SRC_DIRS = ['src/entrypoints', 'src/features', 'src/ui', 'src/utils', 'src/config'];
const EXTS = ['.ts', '.svelte'];

// ── 1. Parse the generated auto-import map ──────────────────────────────────

const dts = readFileSync('.wxt/types/imports.d.ts', 'utf8');
/** symbol -> import specifier unimport would use (e.g. '@/utils/errors') */
const symToSpec = new Map<string, string>();
/** import specifier -> defining file prefix under project root ('src/utils/errors') */
const specToPrefix = new Map<string, string>();

for (const m of dts.matchAll(/^\s*const ([A-Za-z0-9_$]+):\s*typeof import\('([^']+)'\)/gm)) {
  const sym = m[1];
  const raw = m[2];
  if (raw.startsWith('wxt/')) {
    symToSpec.set(sym, raw);
    continue;
  }
  const idx = raw.lastIndexOf('/src/');
  if (idx === -1) continue; // unexpected shape - skipped; typecheck catches if real
  const spec = `@/${raw.slice(idx + 5)}`;
  symToSpec.set(sym, spec);
  specToPrefix.set(spec, raw.slice(idx + 1).replace(/\\/g, '/'));
}

const SELF_SUFFIXES = ['.ts', '.svelte.ts', '.js', '/index.ts', '/index.svelte.ts', '/index.js'];

// ── 2. Walk the source tree ─────────────────────────────────────────────────

const files: string[] = [];
function walk(dir: string): void {
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (statSync(p).isDirectory()) walk(p);
    else if (EXTS.some((x) => e.name.endsWith(x))) files.push(p.replace(/\\/g, '/'));
  }
}
for (const d of SRC_DIRS) walk(d);

// ── 3. Mask strings / comments / regex so identifiers inside them don't count ─
//    (Import statements are parsed on the ORIGINAL text, not the masked copy -
//    module specifiers live inside quotes.)

function mask(text: string, isSvelte: boolean): string {
  const out = [...text];
  const stack: { type: 'code' | 'tpl'; depth: number }[] = [{ type: 'code', depth: 0 }];
  const blank = (i: number): void => {
    if (out[i] !== '\n') out[i] = ' ';
  };
  const skipStr = (quote: string, i: number): number => {
    blank(i++);
    while (i < text.length && text[i] !== quote) {
      if (text[i] === '\\') blank(i++);
      blank(i++);
    }
    blank(i++);
    return i;
  };
  const top = (): { type: 'code' | 'tpl'; depth: number } => stack[stack.length - 1];
  let i = 0;
  while (i < text.length) {
    const st = top();
    const c = text[i];
    const c2 = text.slice(i, i + 2);
    if (st.type === 'code') {
      if (c2 === '//') {
        while (i < text.length && text[i] !== '\n') blank(i++);
        continue;
      }
      if (c2 === '/*') {
        for (let k = 0; k < 2; k++) blank(i++);
        while (i < text.length && text.slice(i, i + 2) !== '*/') blank(i++);
        for (let k = 0; k < 2 && i < text.length; k++) blank(i++);
        continue;
      }
      if (isSvelte && text.slice(i, i + 4) === '<!--') {
        for (let k = 0; k < 4; k++) blank(i++);
        while (i < text.length && text.slice(i, i + 3) !== '-->') blank(i++);
        for (let k = 0; k < 3 && i < text.length; k++) blank(i++);
        continue;
      }
      if (c === "'" || c === '"') {
        i = skipStr(c, i);
        continue;
      }
      if (c === '`') {
        blank(i++);
        stack.push({ type: 'tpl', depth: 0 });
        continue;
      }
      // Regex-literal heuristic: '/' right after an operator/punctuator or a
      // keyword. O(1)-ish backward scan - never slice(0, i) (that was O(n²)).
      if (c === '/' && c2 !== '//' && c2 !== '/*') {
        let j = i - 1;
        while (j >= 0 && /\s/.test(text[j])) j--;
        const prevCh = j >= 0 ? text[j] : '';
        let prevIsKw = false;
        if (/[A-Za-z_$]/.test(prevCh)) {
          let k = j;
          while (k >= 0 && /[\w$]/.test(text[k])) k--;
          const word = text.slice(k + 1, j + 1);
          prevIsKw = [
            'return',
            'typeof',
            'case',
            'in',
            'of',
            'new',
            'delete',
            'void',
            'do',
            'else',
            'yield',
            'await',
            'instanceof',
          ].includes(word);
        }
        if (prevIsKw || '([{,;=!&|?:<>+-*%~^'.includes(prevCh)) {
          blank(i++);
          let closed = false;
          while (i < text.length && text[i] !== '\n') {
            if (text[i] === '\\') blank(i++);
            else if (text[i] === '/') {
              blank(i++);
              closed = true;
              break;
            } else blank(i++);
          }
          if (!closed) continue; // wasn't a regex literal - resume from the newline
          while (i < text.length && /[a-z]/i.test(text[i])) blank(i++);
          continue;
        }
      }
      if (c === '{') st.depth++;
      if (c === '}') {
        if (st.depth > 0) st.depth--;
        else if (stack.length > 1) stack.pop(); // close a ${ } interpolation
      }
      i++;
      continue;
    }
    // inside a template literal
    if (c2 === '${') {
      for (let k = 0; k < 2; k++) blank(i++);
      stack.push({ type: 'code', depth: 0 });
      continue;
    }
    if (c === '`') {
      blank(i++);
      stack.pop();
      continue;
    }
    blank(i++);
  }
  return out.join('');
}

// ── 4. Parse existing import bindings (on ORIGINAL text) ────────────────────

interface Existing {
  names: Set<string>;
  isTypeOnly: boolean;
}

function existingImports(text: string): Map<string, Existing> {
  const bySpec = new Map<string, Existing>();
  // Clause is bounded (imports can't contain ';' before 'from') so stray
  // 'import' tokens in comments or dynamic import() calls can't scan the
  // whole file (O(n²) hang).
  for (const m of text.matchAll(/import\s+(type\s+)?([^;]{0,400}?)\s*from\s*['"]([^'"]+)['"]/g)) {
    const isTypeOnly = m[1] !== undefined;
    const clause = m[2];
    const spec = m[3];
    const ex: Existing = bySpec.get(spec) ?? { names: new Set<string>(), isTypeOnly: false };
    ex.isTypeOnly = ex.isTypeOnly && isTypeOnly;
    const defPart = clause.split('{')[0];
    const defName = defPart.match(/(?:^|[,=\s])([A-Za-z_$][\w$]*)\s*$/);
    if (defName) ex.names.add(defName[1]);
    const ns = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
    if (ns) ex.names.add(ns[1]);
    const braces = clause.match(/\{([^}]*)\}/);
    if (braces) {
      for (const part of braces[1].split(',')) {
        const name = part
          .replace(/^type\s+/, '')
          .split(/\s+as\s+/)[0]
          .trim();
        if (name) ex.names.add(name);
      }
    }
    bySpec.set(spec, ex);
  }
  return bySpec;
}

function localDecls(masked: string): Set<string> {
  const names = new Set<string>();
  for (const m of masked.matchAll(
    /\b(?:function|class|enum|interface|type|const|let|var)\s+([A-Za-z_$][\w$]*)/g
  )) {
    names.add(m[1]);
  }
  // destructured bindings: const { a, b: c } = ...
  for (const m of masked.matchAll(/\b(?:const|let|var)\s*\{([^{}]*)\}\s*[=:]/g)) {
    for (const part of m[1].split(',')) {
      const name = part
        .split(':')[0]
        .trim()
        .match(/^[A-Za-z_$][\w$]*/);
      if (name) names.add(name[0]);
    }
  }
  return names;
}

// ── 5. Process each file ────────────────────────────────────────────────────

const changes = new Map<string, Map<string, Set<string>>>(); // file -> spec -> syms
const manual: string[] = [];
const neverUsed = new Set<string>(symToSpec.keys());

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const isSvelte = file.endsWith('.svelte');
  const masked = mask(text, isSvelte);

  // identifiers referenced at least once outside property access
  const used = new Set<string>();
  for (const m of masked.matchAll(/[A-Za-z_$][\w$]*/g)) {
    const i = m.index ?? 0;
    if (i > 0 && masked[i - 1] === '.') continue;
    used.add(m[0]);
  }
  for (const s of used) neverUsed.delete(s);

  const imported = existingImports(text);
  const bound = new Set<string>();
  for (const ex of imported.values()) for (const n of ex.names) bound.add(n);
  const local = localDecls(masked);

  const need = new Map<string, Set<string>>();
  for (const [sym, spec] of symToSpec) {
    if (!used.has(sym) || bound.has(sym) || local.has(sym)) continue;
    const prefix = specToPrefix.get(spec);
    if (prefix) {
      const isSelfModule =
        SELF_SUFFIXES.some((x) => file === `${prefix}${x}`) || file.startsWith(`${prefix}/`);
      if (isSelfModule) continue;
    }
    if (!need.has(spec)) need.set(spec, new Set());
    need.get(spec)?.add(sym);
  }
  if (need.size === 0) continue;
  changes.set(file, need);

  if (!WRITE) continue;

  // Merge into an existing single-import-braces statement from the same module
  // when there is one; otherwise emit a fresh statement.
  const freshLines: string[] = [];
  let working = text;
  for (const [spec, syms] of [...need].sort((a, b) => a[0].localeCompare(b[0]))) {
    const ex = imported.get(spec);
    if (ex && !ex.isTypeOnly) {
      const esc = spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const stmt = new RegExp(`(import\\s+(?:type\\s+)?\\{)([^}]*)(\\}\\s*from\\s*['"]${esc}['"])`);
      const hit = working.match(stmt);
      if (hit) {
        const merged = [...hit[2].split(','), ...syms]
          .map((s) => s.trim())
          .filter(Boolean)
          .sort()
          .join(', ');
        working = working.replace(stmt, `${hit[1]} ${merged} ${hit[3]}`);
        continue;
      }
    }
    freshLines.push(`import { ${[...syms].sort().join(', ')} } from '${spec}';`);
  }

  let updated: string;
  if (isSvelte) {
    const m = masked.match(/^[ \t]*<script[^>]*>/m);
    if (!m || m.index === undefined) {
      manual.push(file);
      continue;
    }
    const lineEnd = text.indexOf('\n', m.index);
    const at = lineEnd === -1 ? text.length : lineEnd + 1;
    const block = freshLines.length > 0 ? `${freshLines.join('\n')}\n` : '';
    updated = working.slice(0, at) + block + working.slice(at);
  } else {
    const lines = working.split('\n');
    let li = 0;
    while (li < lines.length) {
      const t = lines[li].trim();
      if (t === '' || t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t === '*/') {
        li++;
        continue;
      }
      break;
    }
    const at = lines.slice(0, li).reduce((n, l) => n + l.length + 1, 0);
    const block =
      freshLines.length > 0
        ? `${freshLines.join('\n')}\n${/^(import|\s|$)/.test(lines[li] ?? '') ? '' : '\n'}`
        : '';
    updated = working.slice(0, at) + block + working.slice(at);
  }
  writeFileSync(file, updated);
}

// ── 6. Report ───────────────────────────────────────────────────────────────

let totalSyms = 0;
const bySpec = new Map<string, number>();
for (const need of changes.values()) {
  for (const [spec, syms] of need) {
    totalSyms += syms.size;
    bySpec.set(spec, (bySpec.get(spec) ?? 0) + syms.size);
  }
}
console.log(`${WRITE ? 'WRITE' : 'DRY-RUN'}: ${changes.size} files, ${totalSyms} imports to add`);
for (const [spec, n] of [...bySpec].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`  ${String(n).padStart(4)}  ${spec}`);
}
if (manual.length > 0) console.log(`\nManual (no <script> tag found):\n  ${manual.join('\n  ')}`);
const unused = [...neverUsed].sort();
if (unused.length > 0) {
  console.log(`\n${unused.length} auto-import symbols never referenced in src (left alone):`);
  console.log(`  ${unused.slice(0, 20).join(', ')}${unused.length > 20 ? ' …' : ''}`);
}
if (!WRITE) console.log('\nRe-run with --write to apply.');
