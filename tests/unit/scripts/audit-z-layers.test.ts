/**
 * The z-layering audit's verdicts, and the repo's own cleanliness.
 *
 * `scanRepo()` runs against the real tree, so a regression - an invented number
 * above chrome, a flyout that lost its layer, an entry animation that grew a
 * retained transform, or a broken scale - fails here as well as in
 * `bun run audit-z-layers --strict`.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  analyse,
  checkScale,
  EXIT_ANIMATIONS,
  findSites,
  findTraps,
  ORDER,
  scanRepo,
  stack,
  staleExits,
} from '../../../scripts/audit-z-layers';
import { stripComments } from '../../../scripts/source-lexer';
import { PORTAL_Z } from '../../../src/utils/ui/portal-layers.js';
import { REPO_SCAN_TIMEOUT_MS } from '../harness/repo-scan-timeout.js';

const rules = (file: string, source: string) => analyse(file, source).findings.map((f) => f.rule);

describe('findSites', () => {
  test('reads class utilities, bracket utilities, negatives and css declarations', () => {
    const source = [
      '<div class="relative z-30"></div>',
      '<div class="z-[10000]"></div>',
      '<div class="flex -z-10"></div>',
      '<div style="z-index: {menuOpen ? 120 : 1};"></div>',
      '<style>.a { z-index: 20; }</style>',
    ].join('\n');
    const sites = findSites('a.svelte', source, source);
    expect(sites.map((s) => [s.kind, s.value, s.layer])).toEqual([
      ['class', 'z-30', 30],
      ['class', 'z-[10000]', 10000],
      ['class', '-z-10', -10],
      ['css', '{menuOpen ? 120 : 1}', null],
      ['css', '20', 20],
    ]);
  });

  test('marks a value that names the scale as sourced, whatever it resolves to', () => {
    // `String.fromCharCode(36)` is `$`, spelled out because a plain string
    // holding a template placeholder is exactly what the scan has to read in a
    // TS-injected style (`EmailBody.svelte`) without the lint rule objecting.
    const dollar = String.fromCharCode(36);
    const source = [
      '<div class="{PORTAL_Z_CLASS.chrome}"></div>',
      `<div style="z-index: ${dollar}{PORTAL_Z.dialog};"></div>`,
    ].join('\n');
    // The class fragment is a variable, so there is no literal to judge at all;
    // the injected value is a site the scan must not grade as invented.
    const sites = findSites('a.svelte', source, source);
    expect(sites).toHaveLength(1);
    expect(sites[0].sourced).toBe(true);
  });

  test('ignores a comment (a number discussed is not a number shipped)', () => {
    const source =
      '<!-- Low z so portaled dialogs (z-10000) always paint above -->\n<div class="z-10"></div>';
    expect(findSites('a.svelte', stripComments(source), source).map((s) => s.value)).toEqual([
      'z-10',
    ]);
  });

  test('reads an inline style, and a template-literal interpolation as a whole', () => {
    const source = [
      '<div style="z-index: 40;"></div>',
      '<div style="z-index: {menuOpen ? PORTAL_Z.accountMenu : 1};"></div>',
    ].join('\n');
    const sites = findSites('a.svelte', source, source);
    expect(sites.map((s) => [s.value, s.layer, s.sourced])).toEqual([
      ['40', 40, false],
      ['{menuOpen ? PORTAL_Z.accountMenu : 1}', null, true],
    ]);
  });
});

describe('analyse - what a number is allowed to be', () => {
  test('a literal at or above chrome is unsourced', () => {
    expect(rules('a.svelte', '<div class="relative z-30"></div>')).toEqual(['UNSOURCED-LAYER']);
    expect(rules('a.svelte', '<div style="z-index: 40;"></div>')).toEqual(['UNSOURCED-LAYER']);
    expect(rules('a.svelte', '<div class="z-[10000]"></div>')).toEqual(['UNSOURCED-LAYER']);
  });

  test('a local value below chrome is fine - it orders one component', () => {
    for (const z of ['-z-10', 'z-0', 'z-[1]', 'z-2', 'z-10', 'z-20']) {
      expect(rules('a.svelte', `<div class="absolute ${z}"></div>`)).toEqual([]);
    }
  });

  test('a value naming a scale member is fine at any layer', () => {
    expect(rules('a.svelte', '<div style="z-index: {PORTAL_Z.accountMenu};"></div>')).toEqual([]);
  });

  test('an expression the scan cannot resolve is not graded', () => {
    expect(rules('a.svelte', '<div style="z-index: {4 - i};"></div>')).toEqual([]);
    expect(rules('a.svelte', '<div style="z-index: {MAX_AVATARS - i};"></div>')).toEqual([]);
  });

  test('a menu surface carrying a local value cannot beat the island', () => {
    expect(rules('a.svelte', '<div class="absolute z-20" role="menu"></div>')).toEqual([
      'MENU-BELOW-CHROME',
    ]);
    expect(rules('a.svelte', '<div class="absolute z-20" role="listbox"></div>')).toEqual([
      'MENU-BELOW-CHROME',
    ]);
    // Without menu semantics the same value is ordinary local layering.
    expect(rules('a.svelte', '<div class="absolute z-20"></div>')).toEqual([]);
    // With the scale's layer, there is no literal to judge.
    expect(rules('a.svelte', '<div class="{PORTAL_Z_CLASS.menu}" role="menu"></div>')).toEqual([]);
  });

  test('judges the element, not its neighbour', () => {
    // The scrim of the account-selector overlay legitimately sits at 0; its id
    // mentions "dropdown" and its host is role="dialog" two lines up.
    const source = [
      '<div class="{PORTAL_Z_CLASS.accountSelector}" role="dialog">',
      '  <button id="button-close-dropdown-backdrop" class="absolute inset-0 z-0"></button>',
      '</div>',
    ].join('\n');
    expect(rules('a.svelte', source)).toEqual([]);
  });
});

describe('findTraps - a retained transform is a permanent stacking context', () => {
  const entry = (final: string, fill = 'both') =>
    `<style>\n.view-crossfade { animation: view-fade-in 200ms ease ${fill}; }\n@keyframes view-fade-in { from { opacity: 0; transform: translateY(4px); } to { ${final} } }\n</style>`;

  test('flags the exact bug: a retaining fill keeps the transform, final keyframe or not', () => {
    const found = findTraps('a.svelte', entry('opacity: 1; transform: translateY(0);'));
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe('STACKING-TRAP');
    expect(found[0].detail).toContain('identity MATRIX');
  });

  test('omitting the transform from the FINAL keyframe does not clear it', () => {
    // Measured on the built extension: with `both`, Chrome kept
    // `matrix(1, 0, 0, 1, 0, 0)` on `.view-crossfade` - the interpolated end
    // value, not the `none` keyword - and an identity matrix still orders and
    // contains like any other transform.
    const found = findTraps('a.svelte', entry('opacity: 1;'));
    expect(found).toHaveLength(1);
    expect(found[0].detail).toContain('identity MATRIX');
  });

  test('flags a retained opacity below 1 as well - it jails AND renders faded', () => {
    const found = findTraps(
      'a.svelte',
      `<style>\n.flash { animation: flash 200ms ease both; }\n@keyframes flash { from { opacity: 0.5; } to { opacity: 0.6; } }\n</style>`
    );
    expect(found).toHaveLength(1);
    expect(found[0].detail).toContain('opacity < 1');
  });

  test('a retaining fill on an animation that touches neither is clean', () => {
    const found = findTraps(
      'a.svelte',
      `<style>\n.flash { animation: flash 200ms ease both; }\n@keyframes flash { from { opacity: 0.55; } to { opacity: 1; } }\n</style>`
    );
    expect(found).toEqual([]);
  });

  test('an exit pose is the deliberate exception', () => {
    const exit = `<style>\n.row { animation: email-row-exit 280ms ease forwards; }\n@keyframes email-row-exit { from { opacity: 1; } to { opacity: 0; transform: scaleY(0.85); } }\n</style>`;
    expect(EXIT_ANIMATIONS.some((e) => e.name === 'email-row-exit')).toBe(true);
    expect(findTraps('a.svelte', exit)).toEqual([]);
  });

  test('without a retaining fill the pose is not kept, so it is not a trap', () => {
    const found = findTraps('a.svelte', entry('opacity: 1; transform: translateY(0);', 'ease'));
    expect(found).toEqual([]);
  });

  test('the repo’s own sheet keeps no retaining fill on a transform', () => {
    const css = readFileSync('src/styles.css', 'utf8');
    expect(findTraps('src/styles.css', stripComments(css))).toEqual([]);
  });

  test('an exemption with no animation to excuse is reported', () => {
    expect(staleExits(new Set(['email-row-exit']))).toEqual([]);
    expect(staleExits(new Set()).map((f) => f.rule)).toEqual(['EXIT-ANIMATION-STALE']);
  });
});

describe('the scale itself', () => {
  test('the documented chain is strictly ascending', () => {
    expect(checkScale()).toEqual([]);
    const values = ORDER.map((name) => (PORTAL_Z as Record<string, number>)[name]);
    for (let i = 1; i < values.length; i += 1) expect(values[i]).toBeGreaterThan(values[i - 1]);
  });

  test('chrome is the last local value: the first overlay layer is above it', () => {
    expect(PORTAL_Z.menu).toBeGreaterThan(PORTAL_Z.chrome);
    expect(PORTAL_Z.accountSelector).toBeGreaterThan(PORTAL_Z.chrome);
  });

  test('the class fragments and the layers cannot drift apart', () => {
    const portal = PORTAL_Z as unknown as Record<string, number>;
    const fragments = Object.fromEntries(
      Object.entries(PORTAL_Z).map(([name, layer]) => [name, `z-[${layer}]`])
    );
    expect(checkScale(portal, fragments)).toEqual([]);
    expect(checkScale(portal, { ...fragments, chrome: 'z-[40]' }).map((f) => f.rule)).toEqual([
      'CLASS-DRIFT',
    ]);
    const { chrome: _chrome, ...withoutChrome } = fragments;
    expect(checkScale(portal, withoutChrome).map((f) => f.rule)).toEqual(['CLASS-DRIFT']);
    // chrome raised above the first overlay layer breaks the ordering, not the fragments.
    expect(checkScale({ ...portal, chrome: 60 }, fragments).map((f) => f.rule)).toContain(
      'SCALE-ORDER'
    );
  });

  test('the printed stack is sorted low → high', () => {
    const values = stack().map((layer) => layer.value);
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });
});

describe('the repo', () => {
  test(
    'carries no layering finding',
    () => {
      const { findings, sites, scaleUses } = scanRepo();
      expect(
        findings.map((f) => `${f.rule} ${f.file}${f.line ? `:${f.line}` : ''}: ${f.detail}`)
      ).toEqual([]);
      expect(sites.length).toBeGreaterThan(40);
      expect(scaleUses).toBeGreaterThan(20);
    },
    REPO_SCAN_TIMEOUT_MS
  );
});
