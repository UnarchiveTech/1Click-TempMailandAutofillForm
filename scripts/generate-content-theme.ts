#!/usr/bin/env bun
/**
 * Regenerates `src/utils/content/content-default-theme-colors.ts` - the precomputed
 * light-standard palette for the default theme seed.
 *
 * Why this file exists: the content script themes its injected shadow-DOM UI
 * with `generateThemeColorsSync(DEFAULT_THEME_SEED, false, 0)`. That call
 * dragged the whole vendored Material 3 color solver
 * (`src/utils/theme/material-color-utils.ts`, ~80 KB) into `content.js`, which runs
 * on every page. The palette for the fixed default seed never changes, so it
 * is computed once here and embedded as plain data - keeping the solver out
 * of the content-script bundle entirely. The stored user theme still arrives
 * from storage at runtime and overrides these defaults (see
 * src/entrypoints/content/dom/shadow-dom.ts).
 *
 * Sync guard: tests/unit/utils/theme/theme-generator.test.ts compares this module
 * against the live solver and fails if they drift (e.g. DEFAULT_THEME_SEED or
 * the palette mapping changes). After changing either, re-run:
 *
 *   bun run generate-content-theme
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_THEME_SEED, generateThemeColorsSync } from '../src/utils/theme/theme-generator.js';

const OUT_FILE = join(
  import.meta.dir,
  '..',
  'src',
  'utils',
  'content',
  'content-default-theme-colors.ts'
);

const colors = generateThemeColorsSync(DEFAULT_THEME_SEED, false, 0);
const lines = Object.entries(colors).map(([key, value]) => `  '${key}': '${value}',`);

const header = `// GENERATED FILE - do not edit by hand.
// Precomputed light-standard palette for the default theme seed (${DEFAULT_THEME_SEED}),
// derived from generateThemeColorsSync(DEFAULT_THEME_SEED, false, 0).
// Regenerate with \`bun run generate-content-theme\` after changing
// src/utils/theme/theme-generator.ts; tests/unit/utils/theme/theme-generator.test.ts
// verifies this stays in sync with the solver.
`;

const content = `${header}
export const CONTENT_DEFAULT_THEME_COLORS: Readonly<Record<string, string>> = {
${lines.join('\n')}
};
`;

writeFileSync(OUT_FILE, content);
console.log(
  `Wrote ${Object.keys(colors).length} tokens to src/utils/content/content-default-theme-colors.ts`
);
