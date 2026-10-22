import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FullConfig, FullResult, Suite } from '@playwright/test/reporter';
import MirrorReporter from '../../e2e/mirror-reporter';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    unlinkSync(join(directory, 'coverage.json'));
    rmdirSync(directory);
  }
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'mirror-reporter-'));
  directories.push(directory);
  const config = {
    projects: [
      { name: 'mirror-chrome' },
      { name: 'mirror-firefox' },
      { name: 'mirror-safari-webkit' },
    ],
    metadata: { evidenceDirectory: directory },
  } as unknown as FullConfig;
  const tests = [
    ['expected', 'passed'],
    ['unexpected', 'failed'],
    ['skipped', 'skipped'],
    ['flaky', 'passed'],
  ].map(([outcome, status], index) => ({
    parent: { project: () => ({ name: 'mirror-firefox' }) },
    location: { file: '/repo/tests/e2e/example.e2e.ts' },
    titlePath: () => ['', 'mirror-firefox', `case ${index}`],
    outcome: () => outcome,
    expectedStatus: 'passed',
    results: [{ status, errors: status === 'failed' ? [{ message: 'failure detail' }] : [] }],
    annotations: status === 'skipped' ? [{ type: 'skip', description: 'API unavailable' }] : [],
  }));
  const suite = { allTests: () => tests } as unknown as Suite;
  const read = () => JSON.parse(readFileSync(join(directory, 'coverage.json'), 'utf8'));
  return { config, suite, directory, read };
}

describe('mirror evidence', () => {
  test('a new run replaces stale success before any scenario executes', () => {
    const { config, suite, directory, read } = fixture();
    writeFileSync(join(directory, 'coverage.json'), '{"status":"passed"}');
    new MirrorReporter().onBegin(config, suite);
    expect(read().status).toBe('running');
    expect(read().scheduled).toBe(4);
    expect(read().nativeExtensionCoverage).toBe(false);
    expect(read().projects).toEqual(['mirror-firefox']);
  });

  test('failed, skipped and flaky scenarios cannot inflate the passing count', () => {
    const { config, suite, read } = fixture();
    const reporter = new MirrorReporter();
    reporter.onBegin(config, suite);
    reporter.onEnd({ status: 'failed' } as FullResult);
    const report = read();
    expect(report.summary['mirror-firefox']).toEqual({
      scheduled: 4,
      passed: 1,
      failed: 1,
      skipped: 1,
      flaky: 1,
    });
    expect(report.scenarios[1].attempts[0].errors).toEqual(['failure detail']);
    expect(report.scenarios[2].annotations[0].description).toBe('API unavailable');
    expect(report.nativeExtensionCoverage).toBe(false);
  });
});
