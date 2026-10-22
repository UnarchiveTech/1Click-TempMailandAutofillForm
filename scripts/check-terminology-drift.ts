#!/usr/bin/env bun
/**
 * Terminology drift checker
 *
 * Two keys can name the same concept and still disagree on its term -
 * `commandPalette.title` saying one word for "command palette" while
 * `activity.dialogCommandPalette` says another. This is exactly how the
 * dedupe scan (docs/dedupe-proposal.md) caught real mistranslations no
 * structural gate could see:
 *
 *   - ar/th rendered the command palette as "محفز الأوامر" / "ปาลเมตรคำสั่ง"
 *     (a literal-mistranslation each) while the SAME locale's
 *     `keyboardShortcuts.fixedCommandPalette` carried the established term.
 *   - de translated "Appearance" as "Erscheinung" in the settings nav while
 *     `settings.appearance` already used "Darstellung".
 *   - th's shortcut composites embedded the ENGLISH term ("Command Palette /
 *     ค้นหาด่วน") instead of the term its own bare keys carried.
 *
 * Completeness gates (check-translations) only prove every key EXISTS with
 * matching variables; they cannot see that two values render the same
 * concept two different ways in one locale. This gate does, through CURATED
 * groups: each group is an explicit assertion that its members name ONE
 * concept, and therefore ONE term per locale. Recall is deliberately manual -
 * deciding "do these two keys mean the same thing" is a translation judgment,
 * not something a script can do reliably. When you notice a pair drifting,
 * add it to TERMINOLOGY_GROUPS (and to the regression sentinels in
 * tests/unit/scripts/check-terminology-drift.test.ts).
 *
 * Member modes:
 *   - `exact`    every exact member renders the term IDENTICALLY.
 *   - `contains` the member is a composite (a hotkey list row, an "Open X
 *                (Alt)" action) whose text must CONTAIN the term - catching
 *                the English-embedded-inside-a-translation failure above.
 *
 * `canonical` names the member whose value DEFINES the term (the established
 * key); findings then point at the deviating member, not positionally at
 * whichever exact member sorted first.
 *
 * A key missing from a NON-English locale is check-translations' finding, not
 * ours - that gate runs in the same audit chain and hard-fails on it, so this
 * gate skips absent keys rather than duplicating its report.
 *
 * Usage:
 *   bun run check-terminology-drift        # exits 0 = OK, 1 = drift found
 *   bun scripts/check-terminology-drift.ts # same, run directly
 */

import { basename } from 'node:path';
import { collectAbsoluteFiles } from './source-files';

// ─── Configuration ────────────────────────────────────────────────────────────

const LOCALES_DIR = `${import.meta.dir}/../src/locales`;

export interface TerminologyMember {
  /** Dot-notation key into the locale dictionaries. */
  key: string;
  /**
   * `exact` - the value IS the term (must equal the group's canonical one).
   * `contains` - the value must contain the term (composite labels).
   */
  mode: 'exact' | 'contains';
}

export interface TerminologyGroup {
  /** Human-readable concept name used in findings. */
  name: string;
  /** Why these keys are one concept - the finding that motivated the group. */
  rationale: string;
  /**
   * The member whose locale value DEFINES the group's term. Without it the
   * first `exact` member anchors - positional, so a regression can invert the
   * finding's direction (flagging the established key instead of the drifted
   * one). Declaring the canonical key keeps the report pointing at the true
   * outlier; de's "Erscheinung" regression reads as "sectionAppearance should
   * equal Darstellung", not the reverse.
   */
  canonical?: string;
  members: TerminologyMember[];
}

/**
 * Every group is a reviewed assertion, not a heuristic. Keep members
 * minimal: a group that lists near-misses buries real drift.
 */
export const TERMINOLOGY_GROUPS: TerminologyGroup[] = [
  {
    name: 'command palette',
    rationale:
      'docs/dedupe-proposal.md: ar "محفز الأوامر" (catalyst of commands) and th "ปาลเมตรคำสั่ง" ' +
      "mistranslated commandPalette.title/activity.dialogCommandPalette while the same locale's " +
      "keyboardShortcuts.fixedCommandPalette carried the established term; th's sys* composites " +
      'embedded the English "Command Palette" instead of that term.',
    canonical: 'keyboardShortcuts.fixedCommandPalette',
    members: [
      { key: 'commandPalette.title', mode: 'exact' },
      { key: 'activity.dialogCommandPalette', mode: 'exact' },
      { key: 'keyboardShortcuts.fixedCommandPalette', mode: 'exact' },
      { key: 'keyboardShortcuts.sysCommandPalette', mode: 'contains' },
      { key: 'keyboardShortcuts.sysCommandPaletteAlt', mode: 'contains' },
    ],
  },
  {
    name: 'appearance',
    rationale:
      'docs/dedupe-proposal.md: de preferences.sectionAppearance used "Erscheinung" while ' +
      'settings.appearance already used the established "Darstellung"; th drifted the other way ' +
      '("รูปลักษณ์" vs "รูปลักษณ์ภายนอก").',
    canonical: 'settings.appearance',
    members: [
      { key: 'preferences.sectionAppearance', mode: 'exact' },
      { key: 'settings.appearance', mode: 'exact' },
    ],
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

type LocaleData = Record<string, unknown>;

/** Recursively flatten a nested object into dot-notation keys. */
export function flattenKeys(
  obj: LocaleData,
  prefix = '',
  result: Map<string, string> = new Map()
): Map<string, string> {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      result.set(fullKey, value);
    } else if (value !== null && typeof value === 'object') {
      flattenKeys(value as LocaleData, fullKey, result);
    }
  }
  return result;
}

export interface DriftFinding {
  locale: string;
  group: string;
  key: string;
  kind: 'exact-mismatch' | 'missing-substring';
  /** The group's canonical term (first exact member's value). */
  expected: string;
  /** The deviating value. */
  got: string;
}

/**
 * Validate the group config itself; returns human-readable problems. Checks
 * the LIVE groups unless another set is passed (the tests build synthetic
 * groups through this to pin each rule). Every problem is fatal: a group that
 * cannot anchor its term must not ship half-enforced.
 */
export function configProblems(
  enFlat: Map<string, string>,
  groups: readonly TerminologyGroup[] = TERMINOLOGY_GROUPS
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    if (group.members.length === 0) {
      problems.push(`group "${group.name}" has no members`);
      continue;
    }
    const exactMembers = group.members.filter((m) => m.mode === 'exact');
    if (exactMembers.length === 0) {
      problems.push(`group "${group.name}" has no exact member to anchor its term`);
    }
    if (group.canonical !== undefined) {
      const canonical = group.members.find((m) => m.key === group.canonical);
      if (!canonical) {
        problems.push(`group "${group.name}" canonical ${group.canonical} is not a member`);
      } else if (canonical.mode !== 'exact') {
        problems.push(`group "${group.name}" canonical ${group.canonical} must be an exact member`);
      }
    }
    for (const member of group.members) {
      if (seen.has(member.key)) {
        problems.push(`key ${member.key} appears in more than one group (or twice)`);
      }
      seen.add(member.key);
      if (!enFlat.has(member.key)) {
        problems.push(
          `group "${group.name}" member ${member.key} does not exist in en.json - ` +
            'the key was renamed? Update the group to the new path.'
        );
      }
    }
  }
  return problems;
}

/**
 * Evaluate every group in every locale. en is included: the source must
 * satisfy its own assertions. A key missing from a non-en locale is skipped
 * (check-translations owns missing keys and runs in the same audit chain).
 * The LIVE groups are checked unless another set is passed (tests).
 */
export function findDrift(
  locales: Map<string, Map<string, string>>,
  groups: readonly TerminologyGroup[] = TERMINOLOGY_GROUPS
): DriftFinding[] {
  const findings: DriftFinding[] = [];
  for (const [locale, flat] of locales) {
    for (const group of groups) {
      const anchorKey = group.canonical ?? group.members.find((m) => m.mode === 'exact')?.key;
      const anchor = group.members.find((m) => m.key === anchorKey && m.mode === 'exact');
      if (!anchor) continue; // invalid config - configProblems reports it
      const term = flat.get(anchor.key);
      if (term === undefined) continue; // missing even in en - configProblems reports it
      for (const member of group.members) {
        const value = flat.get(member.key);
        if (value === undefined) continue; // non-en missing key: not this gate
        if (member.mode === 'exact') {
          if (value !== term) {
            findings.push({
              locale,
              group: group.name,
              key: member.key,
              kind: 'exact-mismatch',
              expected: term,
              got: value,
            });
          }
        } else if (!value.toLowerCase().includes(term.toLowerCase())) {
          findings.push({
            locale,
            group: group.name,
            key: member.key,
            kind: 'missing-substring',
            expected: term,
            got: value,
          });
        }
      }
    }
  }
  return findings;
}

// ─── Report helpers (same shape as check-translations.ts) ────────────────────

const useColour = process.stdout.isTTY;

function red(s: string) {
  return useColour ? `\x1b[31m${s}\x1b[0m` : s;
}
function green(s: string) {
  return useColour ? `\x1b[32m${s}\x1b[0m` : s;
}
function bold(s: string) {
  return useColour ? `\x1b[1m${s}\x1b[0m` : s;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // The same file set every gate sees: gitignored dictionaries are skipped
  // everywhere or nowhere. `flat` excludes the generated background minimal sets.
  const files = collectAbsoluteFiles(LOCALES_DIR, ['.json'], { flat: true })
    .map((f) => basename(f))
    .sort();

  const flatByLocale = new Map<string, Map<string, string>>();
  for (const file of files) {
    const locale = file.replace(/\.json$/, '');
    try {
      const data = (await Bun.file(`${LOCALES_DIR}/${file}`).json()) as LocaleData;
      flatByLocale.set(locale, flattenKeys(data));
    } catch (e) {
      console.error(red(`  [${locale}] Failed to parse JSON: ${(e as Error).message}`));
      process.exit(1);
    }
  }

  const enFlat = flatByLocale.get('en');
  if (!enFlat) {
    console.error(red('Source locale file not found: en.json'));
    process.exit(1);
  }

  const configProblemsList = configProblems(enFlat);
  const findings = findDrift(flatByLocale);

  console.log(bold('\n=== Terminology Drift Check ===\n'));
  console.log(
    `  Groups  : ${bold(String(TERMINOLOGY_GROUPS.length))} (${TERMINOLOGY_GROUPS.map((g) => g.name).join(', ')})`
  );
  console.log(`  Locales : ${bold(String(flatByLocale.size))}\n`);

  if (configProblemsList.length > 0) {
    console.log(red(bold(`  Group configuration problems (${configProblemsList.length}):`)));
    for (const problem of configProblemsList) {
      console.log(red(`    - ${problem}`));
    }
  }

  if (findings.length > 0) {
    console.log(red(bold(`  Terminology drift (${findings.length}):`)));
    for (const finding of findings) {
      const detail =
        finding.kind === 'exact-mismatch'
          ? `should equal the group's term ${JSON.stringify(finding.expected)}`
          : `should contain the group's term ${JSON.stringify(finding.expected)}`;
      console.log(red(`    ✗ [${finding.locale}] ${finding.group} - ${finding.key}`));
      console.log(`        ${detail}, got ${JSON.stringify(finding.got)}`);
    }
    console.log(
      '\n      One concept must render as ONE term per locale - pick the established\n' +
        '      spelling (the bare keys usually carry it) and align the outliers. If a\n' +
        '      pair is genuinely different concepts, do not list it here.\n'
    );
  }

  if (configProblemsList.length === 0 && findings.length === 0) {
    console.log(`  ${green('✓')} every locale renders each curated concept with a single term\n`);
  }

  const errors = configProblemsList.length + findings.length;
  console.log(bold('=== Summary ==='));
  console.log(`  Drift findings: ${errors > 0 ? red(String(errors)) : green('0')}`);
  process.exit(errors > 0 ? 1 : 0);
}

if (import.meta.main) {
  await main();
}
