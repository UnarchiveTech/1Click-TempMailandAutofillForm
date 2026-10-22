/**
 * Read-only audit: finds files in src/ that use WXT auto-import symbols
 * (see .wxt/types/imports.d.ts) WITHOUT importing them explicitly.
 *
 * Usage: bun scripts/analyze-auto-imports.ts
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Load auto-import symbol list
const importsDts = readFileSync('.wxt/types/imports.d.ts', 'utf8');
const symbols = [...importsDts.matchAll(/const ([A-Za-z0-9_]+):/g)].map((m) => m[1]);
const symSet = new Set(symbols);

// Walk src/
const files: string[] = [];
function walk(dir: string) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(ts|svelte|js)$/.test(e.name)) files.push(p);
  }
}
walk('src');

const offenders = new Map<string, string[]>(); // file -> symbols used without import
for (const f of files) {
  const code = readFileSync(f, 'utf8');
  // Collect explicitly imported names (crude but effective: import ... { a, b } / * as x / default as)
  const imported = new Set<string>();
  for (const m of code.matchAll(
    /import\s+(?:type\s+)?(?:([\w*$_]+)\s*,\s*)?(?:\{([^}]*)\}|\*\s*as\s+[\w$_]+|([\w$_]+))?\s*from/g
  )) {
    for (const part of [m[1], m[2], m[3]]) {
      if (!part) continue;
      for (const name of part.split(',')) {
        const n = name
          .trim()
          .split(/\s+as\s+/)
          .pop()
          ?.trim();
        if (n) imported.add(n);
      }
    }
  }
  const used: string[] = [];
  for (const sym of symSet) {
    if (imported.has(sym)) continue;
    const re = new RegExp(`(?<![\\w$.>'"])${sym}(?![\\w$])`);
    if (re.test(code)) used.push(sym);
  }
  if (used.length > 0) offenders.set(f, used);
}

console.log(`Auto-import symbols: ${symbols.length}`);
console.log(`Files scanned: ${files.length}`);
console.log(`Files relying on auto-imports: ${offenders.size}\n`);
const bySym = new Map<string, number>();
for (const syms of offenders.values()) for (const s of syms) bySym.set(s, (bySym.get(s) ?? 0) + 1);
console.log('── By symbol ──');
for (const [s, n] of [...bySym.entries()].sort((a, b) => b[1] - a[1]))
  console.log(`${String(n).padStart(4)}  ${s}`);
console.log('\n── Files ──');
for (const [f, syms] of [...offenders.entries()]
  .sort((a, b) => b[1].length - a[1].length)
  .slice(0, 40))
  console.log(
    `${String(syms.length).padStart(3)}  ${f}  (${syms.slice(0, 6).join(', ')}${syms.length > 6 ? ', …' : ''})`
  );
