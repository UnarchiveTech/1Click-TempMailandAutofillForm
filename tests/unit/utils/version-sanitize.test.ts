/**
 * Regression + contract tests for sanitizeVersionForManifest() in
 * src/utils/version-sanitize.ts.
 *
 * HISTORY (why these tests exist): the function used to split with
 * `version.split('-', 2)`, and JavaScript's split truncates the OUTPUT at two
 * items - so '3.0.0-beta-1' split into ['3.0.0', 'beta'] and the '-1' counter
 * was silently DROPPED. Every beta release then shipped a manifest version
 * byte-identical to the stable one ('3.0.0'). The fix splits at the FIRST dash
 * only. These tests pin the intended mapping (also mirrored byte-for-byte in
 * release.yml's "Sanitize expected manifest version" step), so neither the
 * shared module nor the CI mirror can silently drift again.
 */

import { describe, expect, test } from 'bun:test';
import { sanitizeVersionForManifest } from '@/utils/version-sanitize.js';

describe('sanitizeVersionForManifest', () => {
  test('stable versions pass through unchanged', () => {
    expect(sanitizeVersionForManifest('2.0.0')).toBe('2.0.0');
    expect(sanitizeVersionForManifest('3.0.0')).toBe('3.0.0');
    expect(sanitizeVersionForManifest('10.20.30')).toBe('10.20.30');
    expect(sanitizeVersionForManifest('0.0.0')).toBe('0.0.0');
  });

  test('REGRESSION: multi-dash pre-releases keep their numeric counter (split bug)', () => {
    // split('-', 2) used to drop '-1' -> '3.0.0' (collision with stable).
    expect(sanitizeVersionForManifest('3.0.0-beta-1')).toBe('3.0.0.1');
    expect(sanitizeVersionForManifest('3.0.0-beta-8')).toBe('3.0.0.8');
    expect(sanitizeVersionForManifest('1.0.0-rc-1')).toBe('1.0.0.1');
    expect(sanitizeVersionForManifest('0.0.0-dev-3')).toBe('0.0.0.3');
  });

  test('single-dash pre-releases append their counter as the 4th integer', () => {
    expect(sanitizeVersionForManifest('1.0.0-rc1')).toBe('1.0.0.1');
    expect(sanitizeVersionForManifest('3.1.0-beta.2')).toBe('3.1.0.2');
    expect(sanitizeVersionForManifest('2.0.0-alpha.10')).toBe('2.0.0.10');
  });

  test('a 4-part core already fills the slot - the counter is ignored', () => {
    expect(sanitizeVersionForManifest('10.20.30.40')).toBe('10.20.30.40');
    expect(sanitizeVersionForManifest('10.20.30.40-beta-5')).toBe('10.20.30.40');
  });

  test('segments clamp to the 0-65535 store ceiling', () => {
    expect(sanitizeVersionForManifest('99999.0.0')).toBe('65535.0.0');
    expect(sanitizeVersionForManifest('1.2.3-beta-99999')).toBe('1.2.3.65535');
  });

  test('garbage segments are dropped and non-numeric pre-releases collapse to the core', () => {
    expect(sanitizeVersionForManifest('1..3')).toBe('1.3');
    expect(sanitizeVersionForManifest('abc')).toBe('0.0.0');
    expect(sanitizeVersionForManifest('')).toBe('0.0.0');
    // Documented: a bare-word pre-release has no digit to append.
    expect(sanitizeVersionForManifest('0.0.0-dev')).toBe('0.0.0');
    expect(sanitizeVersionForManifest('3.0.0-beta')).toBe('3.0.0');
  });
});
