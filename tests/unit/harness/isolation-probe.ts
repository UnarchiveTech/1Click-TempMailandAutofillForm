/**
 * Shared state for the isolation guard (`isolation-*.test.ts`).
 *
 * Both halves of the guard import THIS module, so it exists once per test file
 * exactly when the runner isolates, and once for the whole process when it does
 * not. The module-level counter and the `globalThis` write are the two channels
 * a leak travels through: a fresh module registry resets the first, a fresh
 * global object resets the second.
 */

const GLOBAL_KEY = '__isolationProbeMark';

let marks = 0;

/** What this file can see of any OTHER file's marks, before it adds its own. */
export function probeLeaks(): { moduleState: number; globalState: string | undefined } {
  const globalMark = (globalThis as unknown as Record<string, unknown>)[GLOBAL_KEY];
  return {
    moduleState: marks,
    globalState: typeof globalMark === 'string' ? globalMark : undefined,
  };
}

/** Leave a mark on both channels, so the next file's `probeLeaks()` can see it. */
export function markProbe(label: string): void {
  marks += 1;
  (globalThis as unknown as Record<string, unknown>)[GLOBAL_KEY] = label;
}
