/**
 * Unit tests for the staleness helpers in scripts/check-stale-builds.ts.
 *
 * The check exists because .output/<browser>-mv3 builds can silently go stale
 * relative to the sources that produce them - the classic "my config/script
 * change does nothing" trap (the browser keeps loading yesterday's bundle).
 * Staleness is mtime-based: when any tracked input (src, wxt.config.ts,
 * package.json, public/) is newer than the newest file in the output, or the
 * output is missing, the build is stale. scripts/e2e-firefox.ts uses this to
 * rebuild automatically before smoke-testing.
 *
 * These tests pin the mtime comparisons against controlled temp-dir fixtures
 * so they do not depend on this repo's real .output state. Each test builds
 * its own fixture root, so ordering never matters.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BROWSERS,
  buildInputPaths,
  outputDir,
  staleness,
} from '../../../scripts/check-stale-builds';

const REAL_ROOT = join(import.meta.dir, '..', '..', '..');
const fixtureBase = mkdtempSync(join(tmpdir(), 'stale-builds-test-'));
afterAll(() => rmSync(fixtureBase, { recursive: true, force: true }));

let fixtureCounter = 0;
/** A fresh fake project root with src/ and wxt.config.ts at mtime t=0. */
function newFixtureRoot(): string {
  const root = join(fixtureBase, `root-${fixtureCounter++}`);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'index.ts'), '// src');
  writeFileSync(join(root, 'wxt.config.ts'), '// config');
  setMtime(join(root, 'src', 'index.ts'), 100);
  setMtime(join(root, 'wxt.config.ts'), 100);
  return root;
}

/** Build the output for a browser with its manifest at the given mtime. */
function buildOutput(root: string, browser: (typeof BROWSERS)[number], atSeconds: number): void {
  const out = outputDir(root, browser);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'manifest.json'), '{}');
  setMtime(join(out, 'manifest.json'), atSeconds);
}

/** Seconds-based mtime setter (utimesSync takes epoch seconds). */
function setMtime(file: string, epochSeconds: number): void {
  utimesSync(file, epochSeconds, epochSeconds);
}

describe('buildInputPaths', () => {
  test('tracks the real repo inputs that change the bundle', () => {
    const inputs = buildInputPaths(REAL_ROOT).map(normalize);
    expect(inputs).toContain(normalize(join(REAL_ROOT, 'src')));
    expect(inputs).toContain(normalize(join(REAL_ROOT, 'wxt.config.ts')));
    expect(inputs).toContain(normalize(join(REAL_ROOT, 'package.json')));
    expect(inputs).toContain(normalize(join(REAL_ROOT, 'public')));
    expect(inputs).toContain(normalize(join(REAL_ROOT, 'scripts/vite')));
  });
});

describe('staleness', () => {
  test('reports a build that never happened as stale', () => {
    const root = newFixtureRoot();
    const status = staleness(root, 'firefox');
    expect(status.fresh).toBe(false);
    expect(status.detail).toContain('not built');
  });

  test('reports FRESH when the output was built after every input', () => {
    const root = newFixtureRoot();
    buildOutput(root, 'firefox', 200); // inputs are at t=100
    const status = staleness(root, 'firefox');
    expect(status.fresh).toBe(true);
    expect(status.detail).toContain('up to date');
  });

  test('reports STALE when an input changes after the build', () => {
    const root = newFixtureRoot();
    buildOutput(root, 'firefox', 200);
    // An input changes at t=300, after the t=200 build.
    writeFileSync(join(root, 'src', 'a.ts'), 'new');
    setMtime(join(root, 'src', 'a.ts'), 300);

    const status = staleness(root, 'firefox');
    expect(status.fresh).toBe(false);
    expect(status.detail).toContain('source changed');
    expect(status.inputAgeMs).not.toBeNull();
  });

  test('a wxt.config.ts change alone marks every browser output stale', () => {
    const root = newFixtureRoot();
    for (const browser of BROWSERS) buildOutput(root, browser, 1000);
    setMtime(join(root, 'wxt.config.ts'), 2000); // newer than all outputs

    for (const browser of BROWSERS) {
      const status = staleness(root, browser);
      expect(status.fresh).toBe(false);
      expect(status.detail).toContain('source changed');
    }
  });

  test('missing manifest means stale even when the output dir has other files', () => {
    const root = newFixtureRoot();
    const out = outputDir(root, 'safari');
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'background.js'), 'x');
    setMtime(join(out, 'background.js'), 5000);
    expect(existsSync(join(out, 'manifest.json'))).toBe(false);
    expect(staleness(root, 'safari').fresh).toBe(false);
  });
});

function normalize(p: string): string {
  return p.replace(/\\/g, '/');
}
