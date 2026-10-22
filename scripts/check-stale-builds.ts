/**
 * check-stale-builds.ts - tell which .output/<browser>-mv3 builds are stale
 * relative to the source files that produce them.
 *
 * A stale build is the classic "my change does nothing" trap: the browser is
 * loading yesterday's bundle. This script compares the newest modification
 * time across the build inputs (src/, wxt.config.ts, package.json, public/)
 * with the newest file inside each built output. When an input is newer than
 * the output - or the output does not exist - the build is stale.
 *
 * It runs automatically at the END of `bun run build` (scoped to chrome, the
 * only target that command builds) and `bun run build:all` (all three), so a
 * config/script edit made during a build fails the command loudly instead of
 * leaving a silently stale artifact.
 *
 * The Firefox e2e runner (scripts/e2e-firefox.ts) imports `staleness()` to
 * rebuild automatically when the Firefox output is stale, so
 * `bun run test:e2e:firefox` always smoke-tests the CURRENT source.
 *
 * Usage:
 *   bun scripts/check-stale-builds.ts                 # check all browsers
 *   bun scripts/check-stale-builds.ts --browser chrome
 *   bun scripts/check-stale-builds.ts --browser chrome --browser firefox
 *
 * Exits 1 when any requested build is missing or stale.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const BROWSERS = ['chrome', 'firefox', 'safari'] as const;
export type Browser = (typeof BROWSERS)[number];

export interface StaleStatus {
  browser: Browser;
  /** True when the build exists and no tracked input is newer than it. */
  fresh: boolean;
  /** Human explanation for the status. */
  detail: string;
  /** How much newer the newest input is than the newest output, in ms. */
  inputAgeMs: number | null;
}

const ROOT = resolve(import.meta.dir, '..');

/**
 * The tracked build inputs. Anything that changes the produced bundle or its
 * manifest must live under one of these paths (new top-level inputs have to
 * be added here deliberately).
 */
export function buildInputPaths(rootDir: string): string[] {
  const candidates = [
    join(rootDir, 'src'),
    join(rootDir, 'public'),
    join(rootDir, 'scripts/vite'),
    join(rootDir, 'wxt.config.ts'),
    join(rootDir, 'package.json'),
    join(rootDir, 'tailwind.config.ts'),
  ];
  return candidates.filter((p) => existsSync(p));
}

/** Newest mtime (ms epoch) across all files under the given paths, or null. */
export function newestMtime(paths: readonly string[]): number | null {
  let newest: number | null = null;
  const consider = (mtimeMs: number): void => {
    if (newest === null || mtimeMs > newest) newest = mtimeMs;
  };
  const walkDir = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walkDir(full);
      else if (entry.isFile()) consider(statSync(full).mtimeMs);
    }
  };
  for (const p of paths) {
    try {
      const stat = statSync(p);
      if (stat.isDirectory()) walkDir(p);
      else consider(stat.mtimeMs);
    } catch {
      /* path vanished mid-scan - ignore */
    }
  }
  return newest;
}

export function outputDir(rootDir: string, browser: Browser): string {
  return join(rootDir, '.output', `${browser}-mv3`);
}

function newestOutputMtime(rootDir: string, browser: Browser): number | null {
  const dir = outputDir(rootDir, browser);
  return existsSync(join(dir, 'manifest.json')) ? newestMtime([dir]) : null;
}

/** Staleness status for one browser output. Pure against the filesystem. */
export function staleness(rootDir: string, browser: Browser): StaleStatus {
  const output = outputDir(rootDir, browser);
  if (!existsSync(join(output, 'manifest.json'))) {
    return {
      browser,
      fresh: false,
      detail: `not built (${relativePath(rootDir, output)})`,
      inputAgeMs: null,
    };
  }
  const newestOutput = newestOutputMtime(rootDir, browser);
  const newestInput = newestMtime(buildInputPaths(rootDir));
  if (newestInput === null || newestOutput === null) {
    return { browser, fresh: false, detail: 'could not compare build times', inputAgeMs: null };
  }
  if (newestInput > newestOutput) {
    const ageMs = newestInput - newestOutput;
    const seconds = Math.round(ageMs / 1000);
    return {
      browser,
      fresh: false,
      detail: `source changed ~${seconds}s after this build - rebuild before smoke-testing`,
      inputAgeMs: ageMs,
    };
  }
  return { browser, fresh: true, detail: 'up to date with sources', inputAgeMs: null };
}

function relativePath(rootDir: string, p: string): string {
  const rel = p.slice(rootDir.length).replace(/^[\\/]+/, '');
  return rel || p;
}

function parseArgs(argv: string[]): { browsers: Browser[] } {
  const requested: Browser[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--browser' && argv[i + 1]) {
      const value = argv[i + 1] as Browser;
      if ((BROWSERS as readonly string[]).includes(value)) requested.push(value);
      i++;
    }
  }
  return { browsers: requested.length > 0 ? requested : [...BROWSERS] };
}

function main(): void {
  const { browsers } = parseArgs(process.argv.slice(2));
  const statuses = browsers.map((b) => staleness(ROOT, b));
  const stale = statuses.filter((s) => !s.fresh);

  for (const s of statuses) {
    console.log(`${s.fresh ? '✓' : '✗'} ${s.browser}: ${s.detail}`);
  }

  if (stale.length > 0) {
    console.error(
      '\nStale outputs must be rebuilt before smoke-testing. Commands:' +
        stale.map((s) => `\n  bun run build:${s.browser}`).join('') +
        '\n\nThen verify Firefox behavior against current sources with:' +
        '\n  bun run test:e2e:firefox   (rebuilds automatically when stale)'
    );
    process.exit(1);
  }
}

if (import.meta.main) main();
