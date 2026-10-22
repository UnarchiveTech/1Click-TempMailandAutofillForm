/**
 * Unit tests for the version-parity guard (scripts/check-version-parity.ts).
 *
 * The check exists because the manifest-version sanitizer lives TWICE:
 *   - src/utils/version-sanitize.ts   (drives wxt.config.ts builds)
 *   - release.yml "Sanitize expected manifest version" step (raw node -e)
 *
 * Both copies once shared the same `split('-', 2)` bug (multi-dash
 * pre-release counters silently dropped -> every beta shipped the STABLE
 * manifest version), so neither copy alone could catch the other. The guard
 * extracts the EXACT snippet embedded in the workflow and executes it - these
 * tests pin the extractor and prove the two copies agree on the live
 * workflow file, so restructuring the step or drifting either copy breaks CI
 * instead of silently shipping wrong versions.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { sanitizeVersionForManifest } from '@/utils/version-sanitize.js';
import {
  checkVersionParity,
  checkVersionStepOrdering,
  evaluateSnippet,
  extractSanitizeSnippet,
  PARITY_VERSIONS,
  RESOLVE_STEP_NAME,
  WORKFLOW_STEP_NAME,
} from '../../../scripts/check-version-parity';
import { REPO_SPAWN_TIMEOUT_MS } from '../harness/repo-scan-timeout.js';

const REAL_WORKFLOW = readFileSync(
  new URL('../../../.github/workflows/release.yml', import.meta.url),
  'utf8'
);

describe('extractSanitizeSnippet', () => {
  test('extracts the JS body from a canned workflow fragment', () => {
    const fragment = [
      'jobs:',
      '  version:',
      '    steps:',
      `      - name: ${WORKFLOW_STEP_NAME}`,
      '        run: |',
      '          SAN_VERSION=$(RAW_VERSION="$RAW_VERSION" node -e \'',
      '            const v = process.env.RAW_VERSION;',
      "            process.stdout.write(v.replace(/^v/, ''));",
      "          ')",
      '          echo "version=$SAN_VERSION" >> "$GITHUB_OUTPUT"',
    ].join('\n');
    const snippet = extractSanitizeSnippet(fragment);
    expect(snippet).toContain('process.env.RAW_VERSION');
    expect(snippet).toContain("replace(/^v/, '')");
  });

  test('handles CRLF line endings (the repo checks out with them on Windows)', () => {
    const fragment = [
      'jobs:',
      '  version:',
      '    steps:',
      `      - name: ${WORKFLOW_STEP_NAME}`,
      '        run: |',
      '          SAN_VERSION=$(RAW_VERSION="$RAW_VERSION" node -e \'',
      '            process.stdout.write("x");',
      "          ')",
    ].join('\r\n');
    expect(extractSanitizeSnippet(fragment)).toContain('process.stdout.write("x")');
  });

  test('throws when the step or snippet is missing (fail closed)', () => {
    expect(() => extractSanitizeSnippet('jobs: {}')).toThrow(WORKFLOW_STEP_NAME);
    const noSnippet = `      - name: ${WORKFLOW_STEP_NAME}\n        run: echo hi\n`;
    expect(() => extractSanitizeSnippet(noSnippet)).toThrow("node -e '");
  });

  test('extracts the REAL workflow snippet and it still targets RAW_VERSION', () => {
    const snippet = extractSanitizeSnippet(REAL_WORKFLOW);
    expect(snippet).toContain('RAW_VERSION');
    expect(snippet).toContain('indexOf("-")');
  });
});

describe('evaluateSnippet', () => {
  test(
    'executes the real workflow snippet under bun',
    () => {
      const snippet = extractSanitizeSnippet(REAL_WORKFLOW);
      expect(evaluateSnippet(snippet, '3.0.0-beta-1')).toBe('3.0.0.1');
      expect(evaluateSnippet(snippet, '2.0.0')).toBe('2.0.0');
      expect(evaluateSnippet(snippet, '1.2.3-beta-99999')).toBe('1.2.3.65535');
    },
    REPO_SPAWN_TIMEOUT_MS
  );
});

describe('checkVersionStepOrdering', () => {
  // Assembled (not a literal) so biome's noTemplateCurlyInString rule doesn't
  // misread the GitHub Actions `${{ ... }}` expression as a template hole.
  const RAW_VERSION_ENV = ['$', '{{ steps.resolve.outputs.version }}'].join('');

  /** Build a canned version job from step bodies (steps at 6-space indent). */
  const job = (steps: string[]): string =>
    ['jobs:', '  version:', '    steps:', ...steps].join('\n');
  const resolveStep = [
    `      - name: ${RESOLVE_STEP_NAME}`,
    '        id: resolve',
    '        run: echo version=3.0.0 >> "$GITHUB_OUTPUT"',
  ].join('\n');
  const sanitizeStep = [
    `      - name: ${WORKFLOW_STEP_NAME}`,
    '        id: sanitize',
    '        env:',
    `          RAW_VERSION: ${RAW_VERSION_ENV}`,
    '        run: echo ok',
  ].join('\n');
  const verifyStep = [
    '      - name: Verify release state (tag push only)',
    '        run: echo ok',
  ].join('\n');

  test(
    'the REAL release.yml version job has resolve before sanitize, wired',
    () => {
      const problems = checkVersionStepOrdering(REAL_WORKFLOW);
      expect(problems).toEqual([]);
      // Positional sanity on the real file: resolve's step precedes sanitize's.
      const norm = REAL_WORKFLOW.replace(/\r\n/g, '\n');
      const resolveAt = norm.indexOf(`- name: ${RESOLVE_STEP_NAME}`);
      const sanitizeAt = norm.indexOf(`- name: ${WORKFLOW_STEP_NAME}`);
      expect(resolveAt).toBeGreaterThan(-1);
      expect(sanitizeAt).toBeGreaterThan(resolveAt);
    },
    REPO_SPAWN_TIMEOUT_MS
  );

  test('reports a forward reference (sanitize placed before resolve)', () => {
    // The exact regression class: sanitize reads steps.resolve.outputs.version
    // in env but sits ABOVE the resolve step -> empty string -> '0.0.0'.
    const problems = checkVersionStepOrdering(job([sanitizeStep, resolveStep, verifyStep]));
    expect(problems.some((p) => p.code === 'resolve_after_sanitize')).toBe(true);
  });

  test('passes when resolve precedes an env-wired sanitize', () => {
    const problems = checkVersionStepOrdering(job([resolveStep, sanitizeStep, verifyStep]));
    expect(problems).toEqual([]);
  });

  test('reports when sanitize stops consuming the resolve output', () => {
    // Ordering is vacuous if the env wiring is replaced by a literal.
    const unwired = sanitizeStep.replace('steps.resolve.outputs.version', '3.0.0');
    const problems = checkVersionStepOrdering(job([resolveStep, unwired, verifyStep]));
    expect(problems.some((p) => p.code === 'sanitize_not_wired_to_resolve')).toBe(true);
    expect(problems.some((p) => p.code === 'resolve_after_sanitize')).toBe(false);
  });

  test('fails closed when the version job or either step disappears', () => {
    expect(() => checkVersionStepOrdering('jobs: {}')).toThrow(/Job "version" not found/);
    expect(() => checkVersionStepOrdering(job([resolveStep, verifyStep]))).toThrow(
      WORKFLOW_STEP_NAME
    );
    expect(() => checkVersionStepOrdering(job([sanitizeStep, verifyStep]))).toThrow(
      RESOLVE_STEP_NAME
    );
  });
});

describe('checkVersionParity', () => {
  test('the REAL release.yml snippet agrees with the shared module on the full battery', () => {
    const snippet = extractSanitizeSnippet(REAL_WORKFLOW);
    const issues = checkVersionParity(PARITY_VERSIONS, snippet);
    expect(issues).toEqual([]);
  });

  test('detects drift when the snippet disagrees with the module', () => {
    // A drifting snippet (reintroducing the old split('-', 2) truncation
    // behavior) must be reported, not silently accepted.
    const drifting = [
      "const v = process.env.RAW_VERSION.replace(/^v/, '');",
      "const core = v.split('-', 2)[0];",
      'process.stdout.write(core);',
    ].join('\n');
    const issues = checkVersionParity(PARITY_VERSIONS, drifting);
    expect(issues.length).toBeGreaterThan(0);
    const beta = issues.find((i) => i.version === '3.0.0-beta-1');
    expect(beta?.workflowOutput).toBe('3.0.0'); // the old buggy collapse
    expect(beta?.moduleOutput).toBe('3.0.0.1');
  });

  test('every battery version maps through the module to the intended output', () => {
    // Cross-check: the parity battery must not contain versions whose module
    // output contradicts the module's own unit-tested contract.
    for (const version of PARITY_VERSIONS) {
      expect(typeof sanitizeVersionForManifest(version)).toBe('string');
    }
  });
});
