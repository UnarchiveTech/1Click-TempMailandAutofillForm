import { afterAll, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';

import { CONSTANTS } from '@/utils/constants.js';
import {
  clearTranslationCache,
  preloadTranslations,
  setCachedLocale,
} from '@/utils/i18n/i18n-background.js';
import { formatBytes } from '@/utils/storage/storageMonitor.js';

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

// `formatBytes` resolves its unit from the active locale. Bun's test env has no
// navigator.language/document, so the engine stays on the English fallback for
// every test above the localization block. That block flips the engine to `fr`
// and therefore MUST run last; this restores the default afterwards.
afterAll(() => {
  setCachedLocale('en');
  clearTranslationCache();
});

describe('formatBytes - tier boundaries', () => {
  test('byte tier (< 1 KB) renders as integer bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1)).toBe('1 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(KB - 1)).toBe('1023 B');
  });

  test('KB tier starts at exactly 1024 bytes and uses 1 decimal', () => {
    expect(formatBytes(KB)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(2 * KB)).toBe('2.0 KB');
  });

  test('MB tier starts at exactly 1 MiB and uses 2 decimals', () => {
    expect(formatBytes(MB)).toBe('1.00 MB');
    expect(formatBytes(1.5 * MB)).toBe('1.50 MB');
    // Real caller value: the 5 MB storage limit shown in StoragePerformanceView.
    expect(formatBytes(CONSTANTS.STORAGE_LIMIT)).toBe('5.00 MB');
  });

  test('GB tier starts at exactly 1 GiB and uses 2 decimals', () => {
    expect(formatBytes(GB)).toBe('1.00 GB');
    expect(formatBytes(1.5 * GB)).toBe('1.50 GB');
    expect(formatBytes(3 * GB)).toBe('3.00 GB');
    expect(formatBytes(100 * GB)).toBe('100.00 GB');
  });

  test('regression: GiB-scale backups no longer render as four-digit megabytes', () => {
    // 3 GiB used to be "3072.00 MB" - the reason this tier was added.
    expect(formatBytes(3 * GB)).not.toContain('MB');
    expect(formatBytes(3 * GB)).toContain('GB');
  });

  test('GB is the terminal tier (no TB tier by design)', () => {
    expect(formatBytes(1024 * GB)).toBe('1024.00 GB');
  });

  test('tiers are contiguous: each boundary value lands in the lower tier', () => {
    // One byte below a boundary stays in the lower tier and rounds up inside it.
    expect(formatBytes(MB - 1)).toBe('1024.0 KB');
    expect(formatBytes(GB - 1)).toBe('1024.00 MB');

    // The boundary itself is exactly 1 of the next unit.
    expect(formatBytes(KB)).toMatch(/ KB$/);
    expect(formatBytes(MB)).toMatch(/ MB$/);
    expect(formatBytes(GB)).toMatch(/ GB$/);

    // No value can straddle tiers: pick values on both sides of each edge.
    expect(formatBytes(MB - 1)).toMatch(/ KB$/);
    expect(formatBytes(MB + 1)).toMatch(/ MB$/);
    expect(formatBytes(GB - 1)).toMatch(/ MB$/);
    expect(formatBytes(GB + 1)).toMatch(/ GB$/);
  });

  test('a larger byte count never renders as a smaller magnitude', () => {
    // Compare magnitudes normalized back to bytes - comparing the bare numbers
    // would compare 1 "KB" against 512 "B" and prove nothing.
    const FACTOR: Record<string, number> = { B: 1, KB, MB, GB };
    const magnitude = (formatted: string): number => {
      const [value, unit] = formatted.split(' ');
      return Number.parseFloat(value ?? '0') * (FACTOR[unit ?? ''] ?? 0);
    };
    const samples = [0, 512, KB, 1.5 * KB, MB, 1.5 * MB, GB, 1.5 * GB, 3 * GB];

    let previous = -1;
    for (const sample of samples) {
      const current = magnitude(formatBytes(sample));
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });
});

// MUST stay last: preloading + caching `fr` changes the engine's active locale
// for the remainder of this file (afterAll above restores English).
describe('formatBytes - units come from locale keys, not hardcoded English', () => {
  test('all four tiers render localized units (fr: o / Ko / Mo / Go)', async () => {
    await preloadTranslations('fr');
    setCachedLocale('fr');

    expect(formatBytes(512)).toBe('512 o');
    expect(formatBytes(KB)).toBe('1.0 Ko');
    expect(formatBytes(MB)).toBe('1.00 Mo');
    expect(formatBytes(GB)).toBe('1.00 Go');
  });

  test('a second locale renders a third set of units (ar)', async () => {
    await preloadTranslations('ar');
    setCachedLocale('ar');

    expect(formatBytes(GB)).toBe('1.00 جيجابايت');
    expect(formatBytes(MB)).toBe('1.00 ميجابايت');
  });
});

describe('formatBytes - single implementation', () => {
  test('no second byte formatter is defined anywhere in src/', () => {
    // The bug this guards: two hand-rolled copies with different rounding
    // (toFixed(1) vs toFixed(2)). Re-exports are fine; definitions are not.
    const definition = /(?:function|const)\s+formatBytes\s*[=(]/;
    const canonical = 'src/utils/storage/storageMonitor.ts';
    const offenders: string[] = [];

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          walk(path);
        } else if (/\.(ts|svelte)$/.test(entry.name) && path !== canonical) {
          if (definition.test(readFileSync(path, 'utf8'))) offenders.push(path);
        }
      }
    };
    walk('src');

    expect(offenders).toEqual([]);
  });

  test('backup-actions re-exports the canonical formatter instead of copying it', () => {
    const source = readFileSync('src/features/settings/backup-actions.ts', 'utf8');
    expect(source).toContain("export { formatBytes } from '@/utils/storage/storageMonitor.js';");
  });
});
