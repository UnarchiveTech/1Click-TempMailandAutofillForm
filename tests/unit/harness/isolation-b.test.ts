/**
 * Isolation guard, half B - the other side of `isolation-a.test.ts`. Same
 * assertion, written from the opposite direction so the pair cannot pass by
 * running in the wrong order: each file checks what it can see BEFORE leaving
 * its own mark, so exactly one of them fails whenever the runner shares a module
 * registry or a global object between files.
 *
 * If this fails: run the suite with `--isolate` (`bun run test` does). The
 * `[test] isolate` bunfig key alone does not isolate in Bun 1.4.2.
 */
import { expect, test } from 'bun:test';
import { markProbe, probeLeaks } from './isolation-probe.js';

test('B: no earlier test file leaked state into this one (requires --isolate)', () => {
  const seen = probeLeaks();
  markProbe('B');
  expect(seen).toEqual({ moduleState: 0, globalState: undefined });
});
