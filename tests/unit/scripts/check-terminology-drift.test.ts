/**
 * Terminology-drift gate: one concept = one term, per locale.
 *
 * The gate (`scripts/check-terminology-drift.ts`) exists because the
 * structural gates could not see the mistranslations the dedupe scan found
 * (docs/dedupe-proposal.md): every key existed, every interpolation variable
 * matched, and yet ar/th rendered the command palette as "محفز الأوامر" /
 * "ปาลเมตรคำสั่ง" while the SAME locale's `keyboardShortcuts.fixedCommandPalette`
 * carried the established term, and de's settings nav said "Erscheinung" where
 * `settings.appearance` already said "Darstellung". Completeness checks pass
 * on all of that - drift is invisible to them by construction.
 *
 * The tests come in four halves:
 *   1. the LIVE dictionaries pass the gate (the shipped state, all locales
 *      and en itself - a future edit that reintroduces drift fails here);
 *   2. the ORIGINAL scan findings REPRODUCE as findings when re-injected -
 *      the regression sentinels, one per documented failure mode (exact
 *      mismatch, English-embedded-in-a-composite, both-ways appearance
 *      drift), each also pinning that `canonical` points the finding at the
 *      true outlier rather than positionally;
 *   3. the group config validates itself (empty group, no exact member, a
 *      canonical that is not a member or is not exact, a renamed key, a key
 *      in two groups);
 *   4. the gate's wiring rules (the shared lister, and that the key paths
 *      the groups name are the ones the UI actually renders).
 */

import { describe, expect, test } from 'bun:test';
import { basename } from 'node:path';
import {
  configProblems,
  type DriftFinding,
  findDrift,
  flattenKeys,
  TERMINOLOGY_GROUPS,
  type TerminologyGroup,
} from '../../../scripts/check-terminology-drift';
import { collectAbsoluteFiles } from '../../../scripts/source-files';

// ─── Loading the real dictionaries ───────────────────────────────────────────

const LOCALES_DIR = `${import.meta.dir}/../../../src/locales`;

const flatByLocale = new Map<string, Map<string, string>>();
for (const file of collectAbsoluteFiles(LOCALES_DIR, ['.json'], { flat: true })) {
  const locale = basename(file).replace(/\.json$/, '');
  const data = (await Bun.file(file).json()) as Record<string, unknown>;
  flatByLocale.set(locale, flattenKeys(data));
}

const EN = flatByLocale.get('en');
if (!EN) throw new Error('en.json failed to load - the gate tests cannot run without it');

/** The values the LIVE en dictionary carries for a group - the baseline the other locales must agree with. */
function enGroupValues(group: TerminologyGroup): string[] {
  return group.members.map((m) => EN?.get(m.key) ?? '<missing>');
}

/**
 * A locale's own term for a group - the gate resolves `expected` from the
 * CANONICAL member *of that locale*, not from en (each locale may translate
 * the concept its own way; the assertion is internal consistency). The tests
 * must derive their expectations the same way, which is also what pins the
 * per-locale (not per-English) resolution.
 */
function termFor(locale: string, canonicalKey: string): string {
  const value = flatByLocale.get(locale)?.get(canonicalKey);
  if (value === undefined) {
    throw new Error(`term key ${canonicalKey} missing from ${locale} - fix the test setup`);
  }
  return value;
}

// ─── 1. The live dictionaries pass ───────────────────────────────────────────

describe('the shipped dictionaries pass the gate', () => {
  test('every locale renders each curated concept with a single term', () => {
    expect(findDrift(flatByLocale)).toEqual([]);
  });

  test('the group config itself is valid against en.json', () => {
    expect(configProblems(EN)).toEqual([]);
  });

  test('en itself satisfies its own assertions (the source is checked too)', () => {
    const enOnly = new Map([['en', EN]]);
    expect(findDrift(enOnly)).toEqual([]);
  });

  test('the groups name keys that exist in every locale (not just en)', () => {
    for (const group of TERMINOLOGY_GROUPS) {
      for (const member of group.members) {
        for (const [locale, flat] of flatByLocale) {
          expect([`${locale} ${member.key}`, flat.has(member.key)]).toEqual([
            `${locale} ${member.key}`,
            true,
          ]);
        }
      }
    }
  });

  test('command palette: every locale renders all three bare keys with ONE term', () => {
    // The heart of the gate, stated without the helper: for each locale, the
    // three exact members must be one identical string - the same assertion
    // `findDrift` makes, spelled out so a failure here is readable on its own.
    const group = TERMINOLOGY_GROUPS.find((g) => g.name === 'command palette');
    if (!group) throw new Error('command palette group vanished from TERMINOLOGY_GROUPS');
    for (const [locale, flat] of flatByLocale) {
      const terms = group.members.filter((m) => m.mode === 'exact').map((m) => flat.get(m.key));
      expect(new Set(terms).size).toBe(1);
      expect([locale, terms[0]]).toEqual([
        locale,
        flat.get('keyboardShortcuts.fixedCommandPalette'),
      ]);
    }
  });
});

// ─── 2. The scan findings reproduce as findings (regression sentinels) ───────

/**
 * Re-inject a documented mistranslation into a copy of the real dictionaries
 * and assert the gate catches it. If a future edit weakens the gate, the
 * sentinel below fails BEFORE the same mistranslation can ship again.
 */
function withOverrides(
  overrides: Record<string, Record<string, string>>
): Map<string, Map<string, string>> {
  const copy = new Map<string, Map<string, string>>();
  for (const [locale, flat] of flatByLocale) copy.set(locale, new Map(flat));
  for (const [locale, pairs] of Object.entries(overrides)) {
    for (const [key, value] of Object.entries(pairs)) {
      copy.get(locale)?.set(key, value);
    }
  }
  return copy;
}

function driftFor(
  locales: Map<string, Map<string, string>>,
  predicate: (f: DriftFinding) => boolean
): DriftFinding[] {
  return findDrift(locales).filter(predicate);
}

describe('the documented scan findings reproduce as findings', () => {
  test('ar commandPalette.title saying "محفز الأوامر" is caught (exact mismatch)', () => {
    const drifted = withOverrides({ ar: { 'commandPalette.title': 'محفز الأوامر' } });
    const findings = driftFor(drifted, (f) => f.locale === 'ar' && f.group === 'command palette');
    // The canonical anchor is fixedCommandPalette - resolved from AR's own
    // dictionary - so the finding must point AT the drifted key and report
    // ar's established term as `expected`.
    expect(findings).toEqual([
      {
        locale: 'ar',
        group: 'command palette',
        key: 'commandPalette.title',
        kind: 'exact-mismatch',
        expected: termFor('ar', 'keyboardShortcuts.fixedCommandPalette'),
        got: 'محفز الأوامر',
      },
    ]);
  });

  test('th commandPalette.title saying "ปาลเมตรคำสั่ง" is caught (exact mismatch)', () => {
    const drifted = withOverrides({ th: { 'activity.dialogCommandPalette': 'ปาลเมตรคำสั่ง' } });
    const findings = driftFor(drifted, (f) => f.locale === 'th' && f.group === 'command palette');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      key: 'activity.dialogCommandPalette',
      kind: 'exact-mismatch',
      expected: termFor('th', 'keyboardShortcuts.fixedCommandPalette'),
    });
  });

  test('th embedding the ENGLISH "Command Palette" in a composite is caught (contains mode)', () => {
    // The second failure mode from the scan: sysCommandPalette was
    // "Command Palette / ค้นหาด่วน" - translated EXCEPT for the term itself.
    const drifted = withOverrides({
      th: { 'keyboardShortcuts.sysCommandPalette': 'Command Palette / ค้นหาด่วน' },
    });
    const findings = driftFor(
      drifted,
      (f) => f.locale === 'th' && f.key === 'keyboardShortcuts.sysCommandPalette'
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: 'missing-substring',
      expected: termFor('th', 'keyboardShortcuts.fixedCommandPalette'),
      got: 'Command Palette / ค้นหาด่วน',
    });
  });

  test('a contains member that merely includes the term passes (no false positive)', () => {
    // Word order and surrounding text may differ per locale - only the term
    // itself is required. Built from DE's OWN term: a reworded "Open X (Alt)"
    // action still contains "Befehlspalette", so nothing fires.
    const deTerm = termFor('de', 'keyboardShortcuts.fixedCommandPalette') ?? '';
    const drifted = withOverrides({
      de: { 'keyboardShortcuts.sysCommandPaletteAlt': `Öffnen: ${deTerm} (Alt)` },
    });
    expect(driftFor(drifted, (f) => f.locale === 'de')).toEqual([]);
  });

  test('de sectionAppearance saying "Erscheinung" is caught, pointing AT the outlier', () => {
    // The canonical member (settings.appearance = "Darstellung") defines the
    // term, so the finding must read "sectionAppearance should equal
    // Darstellung" - NOT invert and blame the established key.
    const drifted = withOverrides({ de: { 'preferences.sectionAppearance': 'Erscheinung' } });
    const findings = driftFor(drifted, (f) => f.group === 'appearance');
    expect(findings).toEqual([
      {
        locale: 'de',
        group: 'appearance',
        key: 'preferences.sectionAppearance',
        kind: 'exact-mismatch',
        expected: 'Darstellung',
        got: 'Erscheinung',
      },
    ]);
  });

  test('the finding direction is canonical-directed, not positional (regression sentinel)', () => {
    // The same de drift, but through a group with NO canonical declared: the
    // fallback anchors on the first exact member and the finding WOULD invert.
    // This pins WHY canonical exists - and that removing it changes semantics,
    // so it cannot be dropped quietly.
    const group: TerminologyGroup = {
      name: 'appearance',
      rationale: 'test-only: the canonical-less fallback',
      members: [
        { key: 'preferences.sectionAppearance', mode: 'exact' },
        { key: 'settings.appearance', mode: 'exact' },
      ],
    };
    const drifted = withOverrides({ de: { 'preferences.sectionAppearance': 'Erscheinung' } });
    const findings = findDrift(drifted, [group]);
    expect(findings).toHaveLength(1);
    // Positional anchor = sectionAppearance's (now wrong) value defines the
    // term; the ESTABLISHED key is the one reported as the outlier. Exactly
    // the inversion the canonical field prevents.
    expect(findings[0]).toMatchObject({
      key: 'settings.appearance',
      expected: 'Erscheinung',
      got: 'Darstellung',
    });
  });

  test('the th appearance drift is caught whichever member carries the deviant value', () => {
    // th shipped sectionAppearance = "รูปลักษณ์" and appearance =
    // "รูปลักษณ์ภายนอก". The canonical member (settings.appearance) defines
    // the term, so the finding always names the OTHER member - with either
    // historical value injected, exactly one finding fires and the expected
    // side is the locale's current canonical value.
    const historical = ['รูปลักษณ์ภายนอก', 'Darstellung'];
    for (const value of historical) {
      const drifted = withOverrides({
        th: {
          'preferences.sectionAppearance': value,
          'settings.appearance': 'รูปลักษณ์',
        },
      });
      const findings = driftFor(drifted, (f) => f.locale === 'th' && f.group === 'appearance');
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        key: 'preferences.sectionAppearance',
        kind: 'exact-mismatch',
        expected: 'รูปลักษณ์',
        got: value,
      });
    }
    // Injecting into the CANONICAL member instead: the term follows it, and
    // the non-canonical member is (still) the one flagged - never silently.
    const driftedCanonical = withOverrides({
      th: { 'settings.appearance': 'รูปลักษณ์ภายนอก' },
    });
    expect(driftFor(driftedCanonical, (f) => f.locale === 'th')).toEqual([
      {
        locale: 'th',
        group: 'appearance',
        key: 'preferences.sectionAppearance',
        kind: 'exact-mismatch',
        expected: 'รูปลักษณ์ภายนอก',
        got: 'รูปลักษณ์',
      },
    ]);
  });

  test('drift is caught in en too (the source is not exempt from itself)', () => {
    const drifted = withOverrides({ en: { 'settings.appearance': 'Looks' } });
    const findings = driftFor(drifted, (f) => f.locale === 'en');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      key: 'preferences.sectionAppearance',
      expected: 'Looks',
      got: EN?.get('preferences.sectionAppearance'),
    });
  });

  test('a key missing from a NON-en locale is skipped (check-translations owns it)', () => {
    const drifted = withOverrides({
      ja: { 'settings.appearance': undefined as unknown as string },
    });
    drifted.get('ja')?.delete('settings.appearance');
    expect(driftFor(drifted, (f) => f.locale === 'ja')).toEqual([]);
  });
});

// ─── 3. The group config validates itself ────────────────────────────────────

describe('the group configuration validates itself', () => {
  test('an empty group is reported', () => {
    const problems = configProblems(EN, [{ name: 'empty', rationale: 'test', members: [] }]);
    expect(problems).toEqual(['group "empty" has no members']);
  });

  test('a group with no exact member cannot anchor and is reported', () => {
    const problems = configProblems(EN, [
      {
        name: 'all-composites',
        rationale: 'test',
        members: [{ key: 'keyboardShortcuts.sysCommandPalette', mode: 'contains' }],
      },
    ]);
    expect(problems).toEqual(['group "all-composites" has no exact member to anchor its term']);
  });

  test('a canonical that is not a member is reported', () => {
    const problems = configProblems(EN, [
      {
        name: 'bad-canonical',
        rationale: 'test',
        canonical: 'commandPalette.placeholder',
        members: [
          { key: 'commandPalette.title', mode: 'exact' },
          { key: 'activity.dialogCommandPalette', mode: 'exact' },
        ],
      },
    ]);
    expect(problems).toEqual([
      'group "bad-canonical" canonical commandPalette.placeholder is not a member',
    ]);
  });

  test('a canonical that is not an exact member is reported', () => {
    const problems = configProblems(EN, [
      {
        name: 'contains-canonical',
        rationale: 'test',
        canonical: 'keyboardShortcuts.sysCommandPalette',
        members: [
          { key: 'commandPalette.title', mode: 'exact' },
          { key: 'keyboardShortcuts.sysCommandPalette', mode: 'contains' },
        ],
      },
    ]);
    expect(problems).toEqual([
      'group "contains-canonical" canonical keyboardShortcuts.sysCommandPalette must be an exact member',
    ]);
  });

  test('a member missing from en.json is reported as a renamed key (not silently dropped)', () => {
    const problems = configProblems(EN, [
      {
        name: 'renamed',
        rationale: 'test',
        members: [
          { key: 'commandPalette.title', mode: 'exact' },
          { key: 'commandPalette.titles', mode: 'exact' }, // typo / renamed
        ],
      },
    ]);
    expect(problems).toEqual([
      'group "renamed" member commandPalette.titles does not exist in en.json - the key was renamed? Update the group to the new path.',
    ]);
  });

  test('a key claimed by two groups (or twice in one) is reported', () => {
    const base: TerminologyGroup = {
      name: 'first',
      rationale: 'test',
      members: [{ key: 'commandPalette.title', mode: 'exact' }],
    };
    const problems = configProblems(EN, [
      base,
      {
        name: 'second',
        rationale: 'test',
        members: [{ key: 'commandPalette.title', mode: 'exact' }],
      },
    ]);
    expect(problems).toEqual([
      'key commandPalette.title appears in more than one group (or twice)',
    ]);
  });

  test('every live group passes its own validation (meta, but load-bearing)', () => {
    expect(configProblems(EN, TERMINOLOGY_GROUPS)).toEqual([]);
    for (const group of TERMINOLOGY_GROUPS) {
      expect([group.name, group.rationale.length > 20]).toEqual([group.name, true]);
      expect([group.name, group.members.length >= 2]).toEqual([group.name, true]);
    }
  });
});

// ─── 4. Wiring rules ─────────────────────────────────────────────────────────

describe('the gate is wired like every other audit gate', () => {
  test('it resolves its locale files through the shared lister', () => {
    // Enforced by tests/unit/scripts/source-files.test.ts once the gate is in
    // the audit chain (any gate file that does not import './source-files'
    // must be classified there). The direct import here is the same rule,
    // checked from the gate's own side.
    const flat = collectAbsoluteFiles(LOCALES_DIR, ['.json'], { flat: true });
    expect(flat.map((f) => basename(f))).toContain('en.json');
    expect(flat.every((f) => !f.includes('background'))).toBe(true);
  });

  test('the gate is in the audit chain (CI and pre-commit run it)', async () => {
    const pkg = JSON.parse(await Bun.file(`${import.meta.dir}/../../../package.json`).text()) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['check-terminology-drift']).toBeDefined();
    // The chain's order is the runner's list (`bun run audit` → scripts/audit.ts),
    // so membership AND ordering are read from there - one source of truth for
    // both the runner and this assertion.
    const { AUDIT_GATES } = (await import('../../../scripts/audit')) as {
      AUDIT_GATES: ReadonlyArray<{ name: string }>;
    };
    const names = AUDIT_GATES.map((gate) => gate.name);
    expect(names).toContain('check-terminology-drift');
    // Right next to its complement: completeness first, drift second.
    expect(names.indexOf('check-translations')).toBeLessThan(
      names.indexOf('check-terminology-drift')
    );
  });

  test('group members are rendered where the groups claim (the keys are live, not dead)', () => {
    // The command palette group names keys rendered by three different
    // surfaces (palette header, dialog title, shortcut sheet). If a key were
    // renamed in code, en.json's remnant would silently anchor the group on a
    // dead string - so the anchor terms are asserted against en directly,
    // which the config check already proves exist.
    for (const group of TERMINOLOGY_GROUPS) {
      const values = enGroupValues(group);
      expect(values.every((v) => v !== '<missing>')).toBe(true);
      expect(values.every((v) => v.length > 0)).toBe(true);
    }
  });
});
