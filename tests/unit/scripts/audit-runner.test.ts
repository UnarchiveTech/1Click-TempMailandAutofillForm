/**
 * The audit runner's contract: ONE invocation reports EVERY failing gate.
 *
 * `bun run audit` used to be an `&&` list, so the first failing gate ended the
 * run and everything after it went unasked - one undocumented storage key hid
 * twenty green gates, and finding the rest cost a fix-and-rerun cycle each. The
 * runner exists to answer "here is everything that is broken", and that behavior
 * is only worth anything if it cannot silently regress: a `return` in the loop,
 * a `break`, or a re-added early exit would all look like a working audit while
 * restoring the exact failure being fixed.
 *
 * These tests therefore drive a chain whose gates FAIL - the state the old list
 * could not represent - through the injected `exec`/`write` seam, and assert
 * that every gate still ran, that every failure was reported (not only the
 * first), and that the exit code is 1 whenever any gate failed.
 */
import { describe, expect, it } from 'bun:test';
import {
  AUDIT_GATES,
  type AuditGate,
  commandOf,
  type GateResult,
  main,
  runGates,
} from '../../../scripts/audit';

/** A gate with no extra args. */
function gate(name: string): AuditGate {
  return { name };
}

/** Swallow the report when a test only cares about the verdict. */
const silent = (): void => {};

interface Chain {
  exec: (argv: string[]) => GateResult;
  /** Every gate argv the runner asked for, in the order it asked. */
  invoked: string[][];
}

/**
 * A fake chain: `failing` maps a gate name to its exit status (absent = pass).
 * Every failure prints one line to stdout so a report can be checked for it.
 */
function chainOf(failing: Record<string, number> = {}): Chain {
  const invoked: string[][] = [];
  const exec = (argv: string[]): GateResult => {
    invoked.push(argv);
    const name = argv[1] ?? '';
    const status = failing[name];
    if (status !== undefined && status !== 0) {
      return { status, stdout: `${name}: finding\n`, stderr: '' };
    }
    return { status: 0, stdout: `${name}: ok\n`, stderr: '' };
  };
  return { exec, invoked };
}

/** The gate names a chain actually asked for, in order. */
function invokedNames(chain: Chain): string[] {
  return chain.invoked.map((argv) => argv[1] ?? '');
}

describe('audit runner - a failing gate never ends the run', () => {
  it('invokes every gate, in order, when an early one fails', () => {
    const gates = [gate('a'), gate('b'), gate('c'), gate('d')];
    const chain = chainOf({ b: 1 });

    const failures = runGates(gates, chain.exec, silent);

    expect(invokedNames(chain)).toEqual(['a', 'b', 'c', 'd']);
    expect(failures.map((f) => f.name)).toEqual(['b']);
  });

  it('reports EVERY failing gate, not only the first', () => {
    const gates = [gate('a'), gate('b'), gate('c'), gate('d')];
    const chain = chainOf({ a: 1, c: 2, d: 1 });

    const failures = runGates(gates, chain.exec, silent);

    expect(failures.map((f) => f.name)).toEqual(['a', 'c', 'd']);
    expect(invokedNames(chain)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('still runs the whole chain when EVERY gate fails', () => {
    const gates = [gate('a'), gate('b'), gate('c')];
    const chain = chainOf({ a: 1, b: 1, c: 1 });

    const failures = runGates(gates, chain.exec, silent);

    expect(failures).toHaveLength(3);
    expect(invokedNames(chain)).toEqual(['a', 'b', 'c']);
  });

  it('passes the gate args through to the invoked script', () => {
    const chain = chainOf();

    runGates([{ name: 'audit-z-layers', args: ['--strict'] }], chain.exec, silent);

    expect(chain.invoked).toEqual([['run', 'audit-z-layers', '--strict']]);
  });
});

describe('audit runner - the report', () => {
  it('names every failed gate and returns exit code 1', () => {
    const gates = [gate('a'), gate('b'), gate('c'), gate('d')];
    const chain = chainOf({ b: 1, d: 3 });
    const report: string[] = [];

    const code = main({ gates, exec: chain.exec, write: (text) => report.push(text) });
    const printed = report.join('');

    expect(code).toBe(1);
    expect(printed).toContain('2 of 4 gate(s) failed');
    expect(printed).toContain('bun run b');
    expect(printed).toContain('bun run d');
    // The failure SUMMARY (its entries are indented two spaces) lists the
    // failures only - a passing gate still gets its own header above.
    expect(printed).not.toContain('\n  bun run a\n');
    expect(printed).not.toContain('\n  bun run c\n');
    expect(printed).toContain('✓ a: ok');
  });

  it('returns exit code 0 and reports the pass count when nothing fails', () => {
    const gates = [gate('a'), gate('b')];
    const chain = chainOf();
    const report: string[] = [];

    const code = main({ gates, exec: chain.exec, write: (text) => report.push(text) });

    expect(code).toBe(0);
    expect(report.join('')).toContain('✓ audit passed - 2/2 gates');
  });

  it("summarises a passing gate by ITS output, not bun's stderr echo", () => {
    const report: string[] = [];

    runGates(
      [gate('a')],
      () => ({ status: 0, stdout: 'All fine.\n', stderr: '$ bun run a\n' }),
      (text) => report.push(text)
    );
    const printed = report.join('');

    expect(printed).toContain('✓ All fine.');
    expect(printed).not.toContain('✓ $ bun run a');
  });

  it('falls back to stderr for a gate that prints nothing to stdout, then to (no output)', () => {
    const stderrOnly: string[] = [];
    runGates(
      [gate('a')],
      () => ({ status: 0, stdout: '', stderr: 'only on stderr\n' }),
      (text) => stderrOnly.push(text)
    );
    expect(stderrOnly.join('')).toContain('✓ only on stderr');

    const silentGate: string[] = [];
    runGates(
      [gate('a')],
      () => ({ status: 0, stdout: '', stderr: '' }),
      (text) => silentGate.push(text)
    );
    expect(silentGate.join('')).toContain('✓ (no output)');
  });

  it("prints a failing gate's FULL output and its args in the label", () => {
    const report: string[] = [];

    runGates(
      [{ name: 'audit-z-layers', args: ['--strict'] }],
      () => ({ status: 1, stdout: 'finding on stdout\n', stderr: 'finding on stderr\n' }),
      (text) => report.push(text)
    );
    const printed = report.join('');

    expect(printed).toContain('── bun run audit-z-layers --strict');
    expect(printed).toContain('finding on stdout');
    expect(printed).toContain('finding on stderr');
    expect(printed).toContain('✗ FAILED (exit 1)');
  });

  it('reads a killed gate (null status) as a failure, not a pass', () => {
    const report: string[] = [];

    const failures = runGates(
      [gate('a')],
      () => ({ status: null, stdout: '', stderr: '' }),
      (text) => report.push(text)
    );

    expect(failures.map((f) => f.name)).toEqual(['a']);
    expect(report.join('')).toContain('✗ FAILED (exit signal)');
  });
});

describe('audit runner - the chain itself', () => {
  it('is a non-empty list of uniquely named gates', () => {
    const names = AUDIT_GATES.map((g) => g.name);

    expect(names.length).toBeGreaterThan(20);
    expect(names.every((name) => name.length > 0)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });

  it('runs the repository-wide lint LAST, after the gates it re-verifies', () => {
    // `check` (biome) is the final step everywhere else in the repo, and the
    // pre-commit hook's auto-fix relies on it seeing the whole tree last.
    expect(AUDIT_GATES[AUDIT_GATES.length - 1]?.name).toBe('check');
  });

  it('spells each gate as the command the developer runs by hand', () => {
    expect(commandOf({ name: 'check' })).toEqual({
      label: 'bun run check',
      argv: ['run', 'check'],
    });
    expect(commandOf({ name: 'check-i18n-fit', args: ['--strict'] })).toEqual({
      label: 'bun run check-i18n-fit --strict',
      argv: ['run', 'check-i18n-fit', '--strict'],
    });
  });
});
