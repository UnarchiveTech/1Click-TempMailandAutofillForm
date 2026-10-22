/**
 * Sanitize a semver string for use as a Chrome MV3 manifest `version` field.
 *
 * Chrome requires 1-4 dot-separated integers, each 0-65535, with NO
 * pre-release/build suffix. Firefox is more permissive (accepts strings),
 * but the same field is shared in `browser_specific_settings.gecko`, so we
 * sanitize once and use the sanitized form for both targets.
 *
 *   3.0.0-beta-1  →  3.0.0.1   (counter appended as 4th integer)
 *   1.0.0-rc1     →  1.0.0.1
 *   2.0.0         →  2.0.0    (no change)
 *
 * Splitting is at the FIRST dash only. NB: `version.split('-', 2)` would
 * silently DROP the rest of a multi-dash pre-release ('3.0.0-beta-1' → pre =
 * 'beta', counter lost), collapsing every beta to the stable version.
 *
 * Consumers / parity contract:
 * - `wxt.config.ts` imports this function to stamp the built manifest version.
 * - `release.yml`'s "Sanitize expected manifest version" step mirrors this
 *   logic byte-for-byte in raw node -e (CI has no TS runtime) and compares
 *   the BUILT manifest against that value - keep the two in lockstep.
 * - Unit tests in tests/unit/utils/version-sanitize.test.ts pin the mapping,
 *   so a future edit here cannot silently regress pre-release versions.
 *
 * Note: this is irreversible. If a release ships as 3.0.0-beta-8 and
 * 3.0.0-beta-9, both will collapse to 3.0.0.8 / 3.0.0.9. Bump to a
 * 4-component semver (e.g. 3.0.0.8 → 3.0.0.9) before cutting the next
 * pre-release. And a bare-word pre-release ('3.0.0-beta', no numeric
 * counter) has no digit to append and collapses to the core version -
 * always ship numeric pre-releases (e.g. 3.0.0-beta-1).
 */
export function sanitizeVersionForManifest(version: string): string {
  const dash = version.indexOf('-');
  const core = dash === -1 ? version : version.slice(0, dash);
  const pre = dash === -1 ? '' : version.slice(dash + 1);
  const parts = core.split('.').map((p) => Number.parseInt(p, 10));
  // Strip any non-numeric garbage and clamp to 0-65535
  const clean = parts.filter((n) => Number.isFinite(n) && n >= 0).map((n) => Math.min(n, 65535));
  if (pre) {
    // Append the pre-release counter as a 4th integer (0-65535)
    const preNum = Number.parseInt(pre.replace(/\D/g, ''), 10);
    if (Number.isFinite(preNum) && clean.length < 4) {
      clean.push(Math.min(preNum || 1, 65535));
    }
  }
  // Pad to at least 1 integer; truncate to at most 4
  const final = clean.slice(0, 4);
  if (final.length === 0) return '0.0.0';
  return final.join('.');
}
