/**
 * audit.ts - the runner behind `bun run audit`.
 *
 * WHY A RUNNER. The chain used to be one `&&` list in package.json, so the
 * FIRST failing gate ended the run and every gate after it was never asked: one
 * undocumented storage key hid twenty green gates behind it, and the only way to
 * learn what else was wrong was to fix that finding and re-run the whole
 * minutes-long chain. The audit answered "something is broken" and would not
 * answer "here is everything that is broken".
 *
 * This runner runs EVERY gate, in the same order, and prints each verdict as it
 * lands: a passing gate's own last line, a failing gate's full output. It ends
 * with the list of failures. The exit code is 1 when any gate failed (0
 * otherwise), so CI, the pre-commit hook and `bun run all` keep exactly the same
 * contract - the difference is only that one run now reports every finding
 * instead of the first.
 *
 * `AUDIT_GATES` is the membership list. It is also the oracle
 * `tests/unit/scripts/source-files.test.ts` resolves (each entry must be a
 * package.json script that invokes a `scripts/*.ts` file, checked there), so a
 * gate added - or renamed - here cannot slip past the "every gate uses the
 * shared lister" rule without failing that test.
 *
 * `runGates` / `main` take their executor and output sink as parameters, so
 * `tests/unit/scripts/audit-runner.test.ts` can drive a chain whose gates
 * FAIL - the exact state the old `&&` list could not represent - and assert
 * that every one of them still ran and every one of them was reported. Without
 * that seam the resilience would be a claim nobody could check.
 *
 * Usage: `bun scripts/audit.ts` (or `bun run audit`).
 */
import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from './source-files';

export interface AuditGate {
  /** The package.json script name, run as `bun run <name>`. */
  name: string;
  /** Extra arguments the chain passes to that script. */
  args?: readonly string[];
}

/** One gate's exit status and output, as the runner reads it. */
export interface GateResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Runs one gate's argv and reports how it ended. */
export type GateExec = (argv: string[]) => GateResult;

/** Where the runner's report goes (stdout by default; a test passes a collector). */
export type WriteSink = (text: string) => void;

/**
 * Every gate, in the order the chain has always run them.
 *
 * Membership changes go here (not in package.json): the pre-commit hook, CI and
 * `bun run all` all reach the gates only through this list.
 */
export const AUDIT_GATES: readonly AuditGate[] = [
  { name: 'check-storage-namespace-drift' },
  { name: 'check-storage-rmw' },
  { name: 'check-providers' },
  { name: 'check-hardcoded-english' },
  { name: 'check-layer-tokens' },
  { name: 'check-state-layers' },
  { name: 'check-ui-typography' },
  { name: 'check-pseudo-overlays' },
  { name: 'check-avatar-sizes' },
  { name: 'check-icon-references' },
  { name: 'check-vocabulary-fields' },
  { name: 'audit-z-layers', args: ['--strict'] },
  { name: 'check-translations' },
  { name: 'check-terminology-drift' },
  { name: 'check-unused-locales' },
  { name: 'check-locale-key-references' },
  { name: 'check-plural-keys' },
  { name: 'check-background-locales' },
  { name: 'check-locale-messages' },
  { name: 'check-message-types' },
  { name: 'check-mock-restore' },
  { name: 'check-branch-protection' },
  { name: 'check-suppressions' },
  { name: 'check-stale-caches' },
  { name: 'check-undo-guards' },
  { name: 'check-i18n-fit', args: ['--strict'] },
  { name: 'check-responsive-button-layout-module' },
  { name: 'check' },
];

/** How one gate is spelled and invoked. */
export function commandOf(gate: AuditGate): { label: string; argv: string[] } {
  return {
    label: `bun run ${gate.name}${gate.args ? ` ${gate.args.join(' ')}` : ''}`,
    argv: ['run', gate.name, ...(gate.args ?? [])],
  };
}

/** A gate's own verdict: the last non-empty line it printed ('' if silent). */
function verdictLine(output: string): string {
  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines[lines.length - 1] ?? '';
}

/** The real executor: this run's bun binary, no PATH lookup, same cwd/env. */
export function spawnGate(argv: string[]): GateResult {
  const result = spawnSync(process.execPath, argv, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: process.env,
  });
  return {
    status: result.status,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
  };
}

/**
 * Run EVERY gate in order and return the ones that failed - a failure never
 * ends the loop, which is the whole point of this file.
 *
 * A passing gate is summarised by what IT printed (stdout first): bun echoes
 * the invoked command on stderr, which would otherwise become the "verdict".
 */
export function runGates(
  gates: readonly AuditGate[],
  exec: GateExec,
  write: WriteSink
): AuditGate[] {
  const failures: AuditGate[] = [];

  for (const gate of gates) {
    const { label, argv } = commandOf(gate);
    write(`\n── ${label}\n`);
    const { status, stdout, stderr } = exec(argv);
    if (status === 0) {
      const verdict = verdictLine(stdout) || verdictLine(stderr) || '(no output)';
      write(`   ✓ ${verdict}\n`);
      continue;
    }
    failures.push(gate);
    write(`${stdout}${stderr}\n   ✗ FAILED (exit ${status ?? 'signal'})\n`);
  }

  return failures;
}

/** The chain's options - all three have a working default (the real chain). */
export interface AuditRunOptions {
  gates?: readonly AuditGate[];
  exec?: GateExec;
  write?: WriteSink;
}

/**
 * Run the chain and report it. Returns the process exit code (1 if any gate
 * failed) rather than exiting, so the CLI entry below keeps owning `exit` and a
 * test can read the verdict instead of dying on it.
 */
export function main(options: AuditRunOptions = {}): number {
  const gates = options.gates ?? AUDIT_GATES;
  const exec = options.exec ?? spawnGate;
  const write: WriteSink = options.write ?? ((text) => process.stdout.write(text));
  const started = Date.now();

  const failures = runGates(gates, exec, write);

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const passed = gates.length - failures.length;
  if (failures.length === 0) {
    write(`\n✓ audit passed - ${passed}/${gates.length} gates in ${elapsed}s\n`);
    return 0;
  }
  write(
    `\n✗ audit failed - ${failures.length} of ${gates.length} gate(s) failed in ${elapsed}s:\n`
  );
  for (const gate of failures) write(`  ${commandOf(gate).label}\n`);
  write('\nEach failure prints its own findings above. Fixing one does not hide the rest.\n');
  return 1;
}

// CLI entry only - the ratchet test and the runner test import from here.
if (import.meta.main) process.exit(main());
