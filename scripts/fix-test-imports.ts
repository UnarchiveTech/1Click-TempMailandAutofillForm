/**
 * After moving tests from src/ to tests/, rewrite relative imports to @/ paths.
 * Uses Bun APIs (no node:fs / node:path).
 */
import path from 'node:path';

const root = process.cwd();
const testsRoot = path.join(root, 'tests');

const files = await Array.fromAsync(new Bun.Glob('**/*.test.ts').scan(testsRoot));
let rewrites = 0;

for (const rel of files) {
  const file = path.join(testsRoot, rel);
  const original = await Bun.file(file).text();
  const srcDir = path.dirname(rel).replace(/\\/g, '/');

  const next = original.replace(/from\s+['"](\.[^'"]+)['"]/g, (full, imp: string) => {
    const testDir = path.join(testsRoot, srcDir);
    const resolved = path.resolve(testDir, imp);
    if (!resolved.startsWith(testsRoot)) return full;
    let sub = path.relative(testsRoot, resolved).replace(/\\/g, '/');
    sub = sub.replace(/\.ts$/, '').replace(/\.js$/, '');
    const target = imp.endsWith('.js') ? `@/${sub}.js` : `@/${sub}`;
    rewrites += 1;
    return `from '${target}'`;
  });

  if (next !== original) {
    await Bun.write(file, next);
    console.log('fixed', rel);
  }
}

console.log('total rewrites', rewrites);
