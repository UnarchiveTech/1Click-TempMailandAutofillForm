/**
 * Navbar flag registry check - fails the build when the navbar flags are
 * misconfigured.
 *
 * The navbar is flag-driven: each top-level view opts in via its co-located
 * *.nav.ts export (see src/utils/ui/nav-layout.ts). Because `wxt build` bundles
 * without executing app code, a bad flag (duplicate key/view/order, a
 * sub-page promoted to the navbar, or a non-positive order) would otherwise
 * only surface at runtime. This script imports the registry and validates it,
 * so `bun run build` fails fast with a clear message.
 *
 * It ALSO validates that every navbar label key (each flag's labelKey plus
 * the More item's) is translated in EVERY locale file under src/locales - a
 * missing nav label would render as a raw key in the UI.
 *
 * Run: bun scripts/check-nav-flags.ts  (wired into `bun run build`)
 */

import { basename, join, resolve } from 'node:path';
import { collectAbsoluteFiles } from './source-files';

const LOCALES_DIR = resolve(import.meta.dirname, '..', 'src', 'locales');

/** Recursively collect nested JSON keys as dot-notation paths (e.g. nav.more). */
function flattenKeys(
  obj: Record<string, unknown>,
  prefix = '',
  out: Set<string> = new Set()
): Set<string> {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      out.add(fullKey);
    } else if (value !== null && typeof value === 'object') {
      flattenKeys(value as Record<string, unknown>, fullKey, out);
    }
  }
  return out;
}

try {
  // nav-layout.ts validates its registry at module load, so importing it is
  // itself the check - a misconfigured flag throws right here.
  const { NAV_FLAGS, validateNavFlags } = await import('../src/utils/ui/nav-layout.js');
  validateNavFlags(NAV_FLAGS);
  const orders = NAV_FLAGS.map((f) => `${f.key}=${f.order}`).join(', ');
  console.log(`nav-flags: ${NAV_FLAGS.length} navbar flags OK (${orders})`);

  // ─── Nav label translation check ─────────────────────────────────────────
  const labelKeys = [...new Set([...NAV_FLAGS.map((f) => f.labelKey), 'nav.more'])];
  // Through the shared lister: the same dictionaries every other gate reads, so a
  // gitignored locale file cannot be demanded by one gate and unknown to another.
  const files = collectAbsoluteFiles(LOCALES_DIR, ['.json'], { flat: true })
    .map((f) => basename(f))
    .sort();
  const missing: Array<{ locale: string; keys: string[] }> = [];
  for (const file of files) {
    const locale = file.replace('.json', '');
    const data = (await Bun.file(join(LOCALES_DIR, file)).json()) as Record<string, unknown>;
    const keys = flattenKeys(data);
    const missingKeys = labelKeys.filter((k) => !keys.has(k));
    if (missingKeys.length > 0) missing.push({ locale, keys: missingKeys });
  }
  if (missing.length > 0) {
    throw new Error(
      `missing nav label translations:\n` +
        missing.map((m) => `  [${m.locale}] ${m.keys.join(', ')}`).join('\n')
    );
  }
  console.log(
    `nav-labels: ${labelKeys.length} nav label keys present in ${files.length} locales (${files
      .map((f) => f.replace('.json', ''))
      .join(', ')})`
  );
  process.exit(0);
} catch (err) {
  console.error(`nav-flags check FAILED: ${(err as Error).message}`);
  process.exit(1);
}
