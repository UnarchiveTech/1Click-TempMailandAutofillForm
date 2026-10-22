/**
 * Timeout policy for tests that scan the LIVE repository tree.
 *
 * These tests read every file under `src/` (or all of `src/locales`) and lex
 * it through `scripts/source-lexer.ts`. That cost is fixed - the scan cannot
 * be made meaningfully faster without weakening what it reads - but Bun's
 * default test timeout is 5s, which only fits when the suite runs alone:
 *
 * - serial, isolated: the slowest repo scan measures ~3.7s
 * - under `--parallel` CPU contention: the same scans degrade 2-4x and the
 *   worst observed was ~10.4s - every "failure" was the clock, never an
 *   assertion
 *
 * A real regression in these tests is an ASSERTION failure (a new finding, a
 * stale baseline row, an empty scan). It is never "the scan got slower".
 * Raising the timeout therefore cannot hide the regression these tests exist
 * to catch - it only stops the clock from masking them. The values still
 * fail a genuinely hung scan in bounded time.
 */

/** Bun's default per-test timeout, for reference in reviews. */
export const BUN_DEFAULT_TEST_TIMEOUT_MS = 5000;

/**
 * One test that performs a single whole-repo scan (possibly with cheap
 * post-processing). Leaves ~4-5x headroom over the worst parallel run seen
 * (~10.4s) while still bounding a hang.
 */
export const REPO_SCAN_TIMEOUT_MS = 15_000;

/**
 * A test that shells out to a `bun` subprocess, or performs two whole-tree
 * passes. Subprocess startup rides the same contention, so this is 2x the
 * scan budget.
 */
export const REPO_SPAWN_TIMEOUT_MS = 30_000;
