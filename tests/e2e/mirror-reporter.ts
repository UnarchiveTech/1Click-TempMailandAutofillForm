/** Per-scenario evidence. Skipped/failed tests never count as mirrored passes. */
import { mkdirSync, writeFileSync } from 'node:fs';
import type { FullConfig, FullResult, Reporter, Suite } from '@playwright/test/reporter';

export default class MirrorReporter implements Reporter {
  private suite?: Suite;
  private projects: string[] = [];
  private directory = '.wxt/e2e-mirror/all';
  onBegin(config: FullConfig, suite: Suite) {
    this.suite = suite;
    this.projects = [
      ...new Set(suite.allTests().map((test) => test.parent.project()?.name ?? 'unknown')),
    ];
    this.directory = String(config.metadata.evidenceDirectory);
    // Replace a previous green report immediately, even if this run is killed.
    mkdirSync(this.directory, { recursive: true });
    writeFileSync(
      `${this.directory}/coverage.json`,
      JSON.stringify(
        {
          lane: 'engine-preview',
          nativeExtensionCoverage: false,
          status: 'running',
          projects: this.projects,
          scheduled: suite.allTests().length,
        },
        null,
        2
      )
    );
  }
  onEnd(result: FullResult) {
    const scenarios = (this.suite?.allTests() ?? []).map((test) => ({
      project: test.parent.project()?.name,
      file: test.location.file.replace(/\\/g, '/').split('/tests/e2e/')[1],
      title: test.titlePath().slice(2).join(' > '),
      outcome: test.outcome(),
      expectedStatus: test.expectedStatus,
      attempts: test.results.map((attempt) => ({
        status: attempt.status,
        errors: attempt.errors.map((error) => error.message),
      })),
      annotations: test.annotations,
    }));
    const summary = Object.fromEntries(
      [...new Set(scenarios.map((test) => test.project))].map((project) => {
        const tests = scenarios.filter((test) => test.project === project);
        return [
          project,
          {
            scheduled: tests.length,
            passed: tests.filter(
              (test) =>
                test.outcome === 'expected' &&
                test.attempts[test.attempts.length - 1]?.status === 'passed'
            ).length,
            flaky: tests.filter((test) => test.outcome === 'flaky').length,
            skipped: tests.filter((test) => test.outcome === 'skipped').length,
            failed: tests.filter((test) => test.outcome === 'unexpected').length,
          },
        ];
      })
    );
    mkdirSync(this.directory, { recursive: true });
    writeFileSync(
      `${this.directory}/coverage.json`,
      JSON.stringify(
        {
          lane: 'engine-preview',
          nativeExtensionCoverage: false,
          status: result.status,
          projects: this.projects,
          summary,
          scenarios,
        },
        null,
        2
      )
    );
  }
}
