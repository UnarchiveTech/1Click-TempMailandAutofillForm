import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_ROOT } from '../../helpers/project-root';

/**
 * Ratchet: every icon-catalog name must be an official Material Symbols
 * glyph name - or an explicitly allow-listed deliberate custom.
 *
 * The catalog was once seeded from an old Material Symbols snapshot whose
 * names have since been renamed upstream (`bell` → `notifications`,
 * `clock` → `schedule`, `grid` → `grid_view`, …) or never existed at all
 * (`address_customize`). A dead name cannot be paired with an official
 * FILL1 variant (the nav's active-destination rule), so this gate keeps
 * the catalog name-aligned with upstream. The fixture is the upstream
 * codepoints file; refresh it from
 * google/material-design-icons variablefont/MaterialSymbolsOutlined*.codepoints
 * when bumping glyphs.
 */

const CATALOG = readFileSync(join(PROJECT_ROOT, 'src/ui/components/icons/Icon.svelte'), 'utf8');
const VOCABULARY = readFileSync(
  join(PROJECT_ROOT, 'src/ui/components/icons/icon-names.ts'),
  'utf8'
);
// The vocabulary lives in its own module (see its header: a `.ts` table cannot
// import a type out of a `.svelte` file), so the union is read from there and the
// geometry from the component.
const UNION = [...VOCABULARY.matchAll(/^ {2}'([A-Za-z0-9_]+)',$/gm)].map((m) => m[1]);
// The key class includes `_`: excluding it silently skipped the two
// underscore-named entries (`mark_email_read` / `mark_email_unread`), so every
// assertion below - union coverage, upstream liveness - never saw them.
const MAP_KEYS = [...CATALOG.matchAll(/^ {2}([a-zA-Z0-9_]+):\s*(?:\n\s*)?'/gm)]
  .map((m) => m[1])
  .filter((k) => !['name', 'class', 'filled', 'rotate'].includes(k));

/**
 * `<key> → <svg literal>` for each catalog entry - the geometry, not just the
 * names. The reference gate (scripts/check-icon-references.ts) proves every
 * REFERENCE resolves; these entries are the other half, which no gate sees: an
 * advertised key whose path is missing or empty renders '' exactly like an
 * unknown name does.
 */
const MAP_ENTRIES = [...CATALOG.matchAll(/^ {2}([a-zA-Z0-9_]+):\s*\n?\s*'([^']*)',/gm)]
  .map((m) => [m[1], m[2]] as const)
  .filter(([k]) => !['name', 'class', 'filled', 'rotate'].includes(k));

/** Hand-drawn brand marks - the deliberate non-Material-Symbols entries. */
const BRAND_MARKS = new Set(['chrome', 'firefox', 'edge', 'safari', 'github']);

/** Names served by the one shared chevron path, so they need no map entry. */
const CHEVRON_NAMES = new Set([
  'chevron',
  'chevronDown',
  'chevronUp',
  'chevronLeft',
  'chevronRight',
  'back',
]);

/** Upstream glyph names from the vendored codepoints fixture. */
const UPSTREAM = new Set(
  readFileSync(join(PROJECT_ROOT, 'tests/unit/fixtures/material-symbols-codepoints.txt'), 'utf8')
    .split('\n')
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split(' ')[0])
);

/**
 * Deliberate non-upstream glyphs: brand marks and app-specific composites
 * that Material Symbols does not ship.
 */
const CUSTOM_ALLOWLIST = new Set([
  'chrome',
  'firefox',
  'edge',
  'safari',
  'github',
  'threads', // forum/threads composite, not upstream's `forum` glyph
  'mailSolid',
  'starOutline', // filled/outlined star pair kept as two catalog entries
  // chevron aliases resolve through the shared down-chevron path (CHEVRON_DIR)
  'chevron',
  'chevronDown',
  'chevronUp',
  'chevronLeft',
  'chevronRight',
  'back',
]);

/**
 * Legacy aliases intentionally kept in the union for call-site ergonomics,
 * each with an upstream-spelled catalog key serving the same glyph. (The
 * catalog also documents the autoRenew storage-key collision that keeps
 * that legacy name as its key.)
 */
const LEGACY_ALIASES = new Set(['autoRenew']);

/** Catalog names are camelCase; upstream glyph names are snake_case. */
function toSnake(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([a-zA-Z])(\d)/g, '$1_$2') // qrCode2 → qr_code_2
    .toLowerCase();
}

describe('icon catalog names', () => {
  test('union has no duplicates', () => {
    const dupes = UNION.filter((n, i) => UNION.indexOf(n) !== i);
    expect(dupes).toEqual([]);
  });

  test('map keys have no duplicates', () => {
    const dupes = MAP_KEYS.filter((n, i) => MAP_KEYS.indexOf(n) !== i);
    expect(dupes).toEqual([]);
  });

  test('every map key appears in the union', () => {
    const orphans = MAP_KEYS.filter(
      (k) => !UNION.includes(k) && !LEGACY_ALIASES.has(k) && k !== 'starOutline'
    );
    expect(orphans).toEqual([]);
  });

  test('every union name is upstream-alive or allow-listed custom', () => {
    const dead = UNION.filter(
      (n) => !LEGACY_ALIASES.has(n) && !CUSTOM_ALLOWLIST.has(n) && !UPSTREAM.has(toSnake(n))
    );
    expect(dead).toEqual([]);
  });

  test('autoRenew alias comment stays attached to its key', () => {
    // autoRenew cannot be renamed to the upstream `autorenew` because it is
    // also a settings/storage key; its union entry must keep the rationale
    // comment so the alias is not "fixed" into a broken rename later.
    expect(VOCABULARY).toMatch(/autoRenew.*storage/);
  });

  test('the vocabulary lists each name once, and reads as a union', () => {
    // Guards the regex above: a module whose list stopped matching would make
    // every assertion in this file vacuous.
    expect(UNION.length).toBeGreaterThan(60);
    expect(VOCABULARY).toContain('export type KnownIconName = (typeof KNOWN_ICON_NAMES)[number]');
  });

  test('the entry scan sees every advertised key', () => {
    // Guards the geometry assertions below: if this regex silently stopped
    // matching, `MAP_ENTRIES` would shrink and they would pass vacuously.
    expect(MAP_ENTRIES.map(([k]) => k).sort()).toEqual([...MAP_KEYS].sort());
  });

  test('every map entry carries real SVG geometry', () => {
    const empties = MAP_ENTRIES.filter(
      ([, value]) => !value.includes('<svg') || !/d="[^"]{4,}"/.test(value)
    ).map(([key]) => key);
    expect(empties).toEqual([]);
  });

  test('every union name renders - a map entry or the shared chevron', () => {
    // A union name with neither is an invisible icon: nothing to draw, no
    // compile error, no runtime error. This is the shape the catalog rename
    // shipped five of (`x`, `plus`, `copy`, `chart`).
    const blank = UNION.filter((name) => !MAP_KEYS.includes(name) && !CHEVRON_NAMES.has(name));
    expect(blank).toEqual([]);
  });

  test('every entry is on the 24px Material Symbols grid', () => {
    // Geometry pasted from another size (20px/48px) or another grid renders at
    // the wrong optical size with no error at all; the brand marks are the
    // deliberate exception, being hand-drawn on a 24-unit grid.
    const offGrid = MAP_ENTRIES.filter(
      ([key, value]) => !BRAND_MARKS.has(key) && !value.includes('viewBox="0 -960 960 960"')
    ).map(([key]) => key);
    expect(offGrid).toEqual([]);
  });
});
