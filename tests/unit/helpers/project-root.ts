/**
 * Absolute path to the repository root, for tests that need to read source or
 * config files directly.
 *
 * Resolved by walking up from this file until the anchor (`wxt.config.ts`) is
 * found, rather than by counting `../` hops. Depth counting broke twice when a
 * test file moved into its mirrored per-bucket directory: the count was still
 * syntactically valid, so nothing failed until the path was opened at runtime.
 * Walking to an anchor cannot drift that way.
 */
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

const ANCHOR = 'wxt.config.ts';

function findProjectRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(`${dir}/${ANCHOR}`)) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not locate ${ANCHOR} above ${start}`);
}

export const PROJECT_ROOT = findProjectRoot(import.meta.dir);
