/**
 * Unit tests for `scripts/audit-row-surfaces.ts` - the scan that answers "does
 * a selected row actually separate from the surface it sits on?".
 *
 * The fixtures pin the MECHANISM (a fill is measured against the surface under
 * it, an opaque accent passes where a container tint cannot, a static sibling
 * emitted later deletes the conditional fill) and the last describes pin the
 * ARITHMETIC the report rests on: in `light-standard` the whole surface family
 * spans less than the 1.8:1 floor, so no fill-only selection can be visible
 * there whatever baseline it lands on.
 *
 * Fixtures are assembled from parts rather than typed out with quotes inside
 * quotes, and file names are plain (`probe.svelte`): a dotted literal sitting in
 * a `*Key:`-looking position would be read as a translation key by
 * `check-locale-key-references`.
 */

import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  analyse,
  FLOOR,
  findControlSites,
  findSites,
  type Site,
  scanRepo,
  surfaceSpan,
} from '../../../scripts/audit-row-surfaces';
import { REPO_SCAN_TIMEOUT_MS } from '../harness/repo-scan-timeout.js';
import { PROJECT_ROOT } from '../helpers/project-root';

const QUOTE = String.fromCharCode(34);

/** A site built from a synthetic class attribute, as the scanner would see it. */
function site(attribute: string, condition: string, on: string, off: string): Site {
  return {
    file: 'probe.svelte',
    line: 1,
    condition,
    on,
    off,
    attribute,
    ancestor: '',
    contract: false,
    nearestFill: null,
    shadow: null,
  };
}

const hasBuiltCss = (): boolean => {
  const dir = join(PROJECT_ROOT, '.output/chrome-mv3/assets');
  if (!existsSync(dir)) return false;
  return readdirSync(dir).some((n) => n.startsWith('styles-') && n.endsWith('.css'));
};

describe('findSites - which arm pairs get measured', () => {
  test('reads a selection ternary and reports both arms', () => {
    const src = `<div class=${QUOTE}flex px-2 py-2 {isSelected ? 'bg-md-secondary-container/40' : 'bg-transparent'}${QUOTE}>`;
    const [found] = findSites('probe.svelte', src);

    expect(found.condition).toBe('isSelected');
    expect(found.on).toBe('bg-md-secondary-container/40');
    expect(found.off).toBe('bg-transparent');
  });

  test('ignores a ternary that is not about a selected or active state', () => {
    const src = `<div class=${QUOTE}px-2 py-2 {inboxType === 'custom' ? 'bg-md-primary/5' : ''}${QUOTE}>`;
    expect(findSites('probe.svelte', src)).toEqual([]);
  });

  test('grades the chip SHAPE even when the flag is not selection-named', () => {
    // `sortBy !== 'newest'`, `otpOnly` and `hasAttachment` all shipped the same
    // inversion: an idle arm hovering to a surface token against an applied arm
    // of `bg-md-primary/10`. The variable's name is not the bug.
    const src = [
      `<button class=${QUOTE}rounded-full border transition-colors {sortBy !== 'newest'`,
      "  ? 'border-md-primary bg-md-primary/10 text-md-primary'",
      `  : 'border-md-outline-variant bg-transparent hover:bg-md-surface-variant'}${QUOTE}>`,
    ].join('\n');
    const [found] = findSites('probe.svelte', src);

    // The capture stops at the string literal, so the report shows the flag's
    // name rather than its argument - enough to find the site.
    expect(found.condition).toBe('sortBy !==');
    expect(found.on).toContain('bg-md-primary/10');
  });

  test('the shape rule does not swallow an unrelated ternary', () => {
    const src = `<div class=${QUOTE}px-2 py-2 {inboxType === 'custom' ? 'bg-md-primary/10' : ''}${QUOTE}>`;
    expect(findSites('probe.svelte', src)).toEqual([]);
  });

  test('a contract-backed control is marked as the contract and not graded', () => {
    // The migrated markup has no arm pair at all; the `controlSurface(…)` call in
    // the attribute is what tells the scan its values are the stylesheet's.
    const src = [
      `<button class=${QUOTE}rounded-full border border-md-outline-variant {controlSurface(`,
      '  filterActive',
      `)}${QUOTE}>`,
    ].join('\n');
    expect(findSites('probe.svelte', src)).toEqual([]);
    expect(findControlSites('probe.svelte', src)).toEqual([{ file: 'probe.svelte', line: 1 }]);
  });

  test('reads a pair whose condition sits on an earlier line', () => {
    const src = [
      `<button class=${QUOTE}w-full px-3 py-2 text-start {isActiveTab`,
      "  ? 'bg-md-primary text-md-on-primary'",
      `  : 'bg-md-surface-variant/40'}${QUOTE}>`,
    ].join('\n');
    const [found] = findSites('probe.svelte', src);

    // The raw capture starts at the earliest position that can reach the `?`,
    // so it carries the line's prefix; a site's `condition` is that capture
    // trimmed back to the Svelte expression.
    expect(found.condition).toBe('isActiveTab');
    expect(found.on).toBe('bg-md-primary text-md-on-primary');
  });
});

describe('analyse - what the measurement says', () => {
  test('a container tint at 40% is silent: no surface family can show it', () => {
    const report = analyse(
      site(
        `flex items-center gap-2 px-1 py-2 {isSelected ? 'bg-md-secondary-container/40' : ''}`,
        'isSelected',
        'bg-md-secondary-container/40',
        ''
      )
    );

    expect(report.flags).toContain('SILENT');
    expect(report.numbers.every((n) => (n.best ?? 0) < FLOOR)).toBe(true);
  });

  test('an opaque accent role does separate, so it is not flagged', () => {
    const report = analyse(
      site(
        `w-full px-3 py-1.5 {isSelected ? 'bg-md-primary text-md-on-primary' : 'bg-md-surface-variant'}`,
        'isSelected',
        'bg-md-primary text-md-on-primary',
        'bg-md-surface-variant'
      )
    );

    expect(report.flags).toEqual([]);
    expect(Math.min(...report.numbers.map((n) => n.fill ?? 0))).toBeGreaterThan(3);
  });

  test('a border alone is cue-only, and an outward ring is ring-only', () => {
    const border = analyse(
      site(
        `w-full px-3 py-2 {isOpen ? 'border-md-primary/40' : 'border-transparent'}`,
        'isOpen',
        'border-md-primary/40',
        'border-transparent'
      )
    );
    const ring = analyse(
      site(
        `w-full px-3 py-2 {isChecked ? 'ring-2 ring-md-secondary' : ''}`,
        'isChecked',
        'ring-2 ring-md-secondary',
        ''
      )
    );

    expect(border.flags).toContain('CUE-ONLY');
    expect(ring.flags).toContain('RING-ONLY');
  });

  test('a static sibling emitted later deletes the conditional fill', () => {
    if (!hasBuiltCss()) return; // the emitted order needs the built stylesheet
    const report = analyse(
      site(
        `density-row bg-md-tertiary-container {isOpen ? 'border-md-primary/40 bg-md-primary/5' : 'border-transparent'}`,
        'isOpen',
        'border-md-primary/40 bg-md-primary/5',
        'border-transparent'
      )
    );

    expect(report.site.shadow).toBe('bg-md-tertiary-container');
    expect(report.flags.some((f) => f.startsWith('DEAD-FILL'))).toBe(true);
  });
});

describe('the theme arithmetic behind the floor', () => {
  test('light-standard’s whole surface family sits under the floor', () => {
    // This is why the audit exists: in the standard themes an alpha tint cannot
    // be a selection signal, whatever surface it lands on.
    expect(surfaceSpan('light-standard')).toBeLessThan(FLOOR);
  });

  test('the family span grows with the contrast level', () => {
    expect(surfaceSpan('dark-high')).toBeGreaterThan(surfaceSpan('light-standard'));
  });
});

describe('the scan is not vacuous', () => {
  // One whole-tree pass shared by every test below: scanRepo() walks and lexes
  // all of src/ (~2s serial, up to ~4x that under --parallel CPU contention).
  // Running it per-test was five identical scans - the exact load that turned
  // this suite's 5s default timeout into a flake factory.
  const { reports, controls, droppable } = scanRepo();

  test(
    'it finds selection surfaces in the real app',
    () => {
      // Pin distinct real surfaces instead of the total number of conditional
      // class arms, which shrinks as views adopt the shared row contract.
      for (const [file, condition] of [
        ['src/ui/views/autofill/SavedLoginsView.svelte', 'activeDomainSpy === group.domain'],
        ['src/ui/views/mailbox/MailboxView.svelte', 'activeLabelFilter === lab'],
      ] as const) {
        expect(reports.some((r) => r.site.file === file && r.site.condition === condition)).toBe(
          true
        );
      }
      // Onboarding now selects provider columns using shared radio controls;
      // it no longer has selectable provider rows with conditional class arms.
      expect(controls.some((c) => c.file === 'src/ui/blocks/overlays/Onboarding.svelte')).toBe(
        true
      );
      // Not one ROW-level site is SILENT any more: the migration moved every
      // fill-only row and control onto a contract whose applied form is a solid
      // accent (the one row-level finding left is an ink-only tab strip).
      expect(reports.filter((r) => r.rowish && r.flags.includes('SILENT'))).toEqual([]);
    },
    REPO_SCAN_TIMEOUT_MS
  );

  test(
    'NO site in the app lets its own hover paint the applied state',
    () => {
      // The ratchet for this whole change: hovering an unapplied control must never
      // paint what applying it paints. It was 10 sites, then the shape rule found 5
      // more that the name-keyed scan had missed.
      const offenders = reports.filter((r) => r.flags.includes('HOVER-EQUAL'));

      expect(offenders.map((r) => `${r.site.file}:${r.site.line}`)).toEqual([]);
    },
    REPO_SCAN_TIMEOUT_MS
  );

  test(
    'the migrated controls are reported as contract-backed, not dropped',
    () => {
      expect(controls.length).toBeGreaterThan(10);
      expect(controls.some((c) => c.file.endsWith('FilterList.svelte'))).toBe(true);
    },
    REPO_SCAN_TIMEOUT_MS
  );

  test(
    'a drop target is reported on its own axis, not graded as a selection',
    () => {
      expect(droppable.length).toBeGreaterThan(0);
      const graded = new Set(reports.map((r) => `${r.site.file}:${r.site.line}`));
      for (const site of droppable) expect(graded.has(site)).toBe(false);
    },
    REPO_SCAN_TIMEOUT_MS
  );

  test(
    'the surfaces that DO separate are the opaque accent roles',
    () => {
      const clean = reports.filter((r) => r.flags.length === 0);

      expect(clean.length).toBeGreaterThan(0);
      expect(
        clean
          .filter((r) => !r.contract)
          .every((r) => (r.fill ?? '').match(/-md-(primary|secondary|tertiary)$/))
      ).toBe(true);
    },
    REPO_SCAN_TIMEOUT_MS
  );
});
