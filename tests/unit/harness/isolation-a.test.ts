/**
 * Isolation guard, half A (see `isolation-b.test.ts` and `isolation-probe.ts`).
 *
 * Bun's `[test] isolate` key in `bunfig.toml` is NOT honoured in 1.4.2 - only
 * the CLI flag is. With the key alone the whole suite shares one module registry
 * and one global object, which is how the expiry and email-storage suites came
 * to fail twelve order-dependent tests in a full run while passing standalone:
 * `notification-permission.ts` resolves `wxt/browser` per surface and kept the
 * FIRST file's binding, so every later file's `mock.module('wxt/browser')` was
 * invisible to it and its notification counter stayed at zero.
 *
 * The two halves of this guard test each other in either order - whichever runs
 * second sees the first's mark - and together they fail loudly if a runner ever
 * stops passing `--isolate`.
 */
import { expect, test } from 'bun:test';
import { markProbe, probeLeaks } from './isolation-probe.js';

test('A: no earlier test file leaked state into this one (requires --isolate)', () => {
  const seen = probeLeaks();
  markProbe('A');
  expect(seen).toEqual({ moduleState: 0, globalState: undefined });
});
