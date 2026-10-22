import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const DIST_DIR = join(ROOT, 'docs-site', 'dist');
const BASE_PATH = process.env.DOCS_BASE_PATH || '/1click/';

async function filesUnder(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await filesUnder(path)));
    else result.push(path);
  }
  return result;
}

function targetPath(value: string): string | null {
  if (!value.startsWith(BASE_PATH)) return null;
  const withoutHash = value.split('#', 1)[0].split('?', 1)[0];
  const relativeTarget = withoutHash.slice(BASE_PATH.length);
  if (!relativeTarget) return join(DIST_DIR, 'index.html');
  if (relativeTarget.endsWith('/')) return join(DIST_DIR, relativeTarget, 'index.html');
  return join(DIST_DIR, relativeTarget);
}

async function existsAsFileOrDirectory(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await existsAsFileOrDirectory(DIST_DIR))) {
    throw new Error('docs-site/dist does not exist; run bun run docs:build first');
  }

  const files = await filesUnder(DIST_DIR);
  const htmlFiles = files.filter((file) => file.endsWith('.html'));
  const failures: string[] = [];

  for (const file of htmlFiles) {
    const html = await readFile(file, 'utf8');
    const references = [
      ...Array.from(
        html.matchAll(/(?:href|src|data-light|data-dark)="([^"]+)"/g),
        (match) => match[1]
      ),
    ];
    for (const reference of references) {
      const target = targetPath(reference);
      if (!target) continue;
      if (!(await existsAsFileOrDirectory(target))) {
        failures.push(`${relative(ROOT, file)} -> ${reference}`);
      }
    }
  }

  if (failures.length > 0) {
    console.error('Broken documentation links/assets:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Documentation links validated (${htmlFiles.length} HTML pages).`);
}

await main();
