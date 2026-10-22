/**
 * Unit tests for the state-layer scanner in scripts/check-state-layers.ts.
 *
 * findStateLayerViolations() / isStateLayerViolation() / pressedTreatmentFor()
 * / applyPressedTreatments() are the pure cores behind the .svelte scan (the
 * file scanner only adds comment blanking via the shared source lexer,
 * <style> skipping, and file iteration).
 *
 * These tests pin the generalized MD3 rule: ANY <button> element whose class
 * payload declares a hover state layer (hover:bg-… / hover:brightness-…) must
 * also declare a pressed one (active:bg-… / active:brightness-…). Chips,
 * pills, text buttons, and tonal rows are in scope; role="button" divs and
 * non-button elements are out (the class-string heuristic cannot see
 * semantics); the treatment map is pinned wash-shape by wash-shape.
 */

import { describe, expect, test } from 'bun:test';
import {
  applyPressedTreatments,
  findStateLayerViolations,
  hasHoverState,
  hasPressedState,
  isStateLayerViolation,
  pressedTreatmentFor,
} from '../../../scripts/check-state-layers';

describe('isStateLayerViolation / has*State', () => {
  test('flags ANY button payload with a hover wash but no pressed step', () => {
    // Icon button
    expect(
      isStateLayerViolation(
        'w-7 h-7 flex items-center justify-center rounded-full hover:bg-md-surface-variant/50 transition-colors'
      )
    ).toBe(true);
    // Text button (px-/py- padding - previously out of scope, now IN)
    expect(
      isStateLayerViolation(
        'h-8.5 px-2.5 rounded-xl bg-transparent text-md-on-surface hover:bg-md-surface-variant/50 transition-colors'
      )
    ).toBe(true);
    // Chip (rounded-full + px-)
    expect(
      isStateLayerViolation(
        'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border bg-transparent hover:bg-md-surface-variant'
      )
    ).toBe(true);
  });

  test('payloads WITH a pressed step pass, in any of the accepted idioms', () => {
    const payloads = [
      // opacity step
      'px-3 rounded-lg hover:bg-md-surface-variant/50 active:bg-md-surface-variant/70',
      // container-pressed token
      'w-5 h-5 rounded-full hover:bg-md-secondary-container active:bg-md-secondary-container-pressed',
      // color-mix ladder (sidebar)
      'w-7 h-7 rounded-full hover:bg-[color-mix(in_srgb,var(--md-on-surface-variant)_8%,transparent)] active:bg-[color-mix(in_srgb,var(--md-on-surface-variant)_12%,transparent)]',
      // brightness press on a solid fill
      'px-2.5 rounded-xl bg-md-primary hover:bg-md-primary/90 active:brightness-95',
      // brightness hover + brightness press
      'w-8 h-8 rounded-lg overflow-hidden hover:brightness-110 active:brightness-95',
    ];
    for (const p of payloads) {
      expect(hasHoverState(p)).toBe(true);
      expect(hasPressedState(p)).toBe(true);
      expect(isStateLayerViolation(p)).toBe(false);
    }
  });

  test('no hover wash → no requirement (static fills, drag handles)', () => {
    expect(isStateLayerViolation('px-2.5 rounded-xl bg-md-primary text-md-on-primary')).toBe(false);
    expect(hasHoverState('cursor-grab active:cursor-grabbing touch-none rounded-lg')).toBe(false);
  });

  test('brightness press alone does not satisfy a bg-hover wash and vice versa', () => {
    // Pressed state exists (brightness) but hover is a wash - accepted? YES:
    // the rule is "a pressed state layer exists", not "the same family".
    expect(
      isStateLayerViolation('px-3 rounded-lg hover:bg-md-surface-variant/50 active:brightness-95')
    ).toBe(false);
    // The reverse mix is also accepted.
    expect(
      isStateLayerViolation('w-8 h-8 hover:brightness-110 active:bg-md-surface-variant/50')
    ).toBe(false);
  });
});

describe('pressedTreatmentFor - the treatment map', () => {
  test('opacity washes step +20', () => {
    expect(pressedTreatmentFor('bg-md-surface-variant/40')).toBe('active:bg-md-surface-variant/60');
    expect(pressedTreatmentFor('bg-md-surface-variant/50')).toBe('active:bg-md-surface-variant/70');
    expect(pressedTreatmentFor('bg-md-error/10')).toBe('active:bg-md-error/30');
    expect(pressedTreatmentFor('bg-md-primary/15')).toBe('active:bg-md-primary/35');
  });

  test('opacity washes cap at 100% and switch to brightness', () => {
    expect(pressedTreatmentFor('bg-md-primary/80')).toBe('active:bg-md-primary/100');
    expect(pressedTreatmentFor('bg-md-primary/90')).toBe('active:brightness-95');
    expect(pressedTreatmentFor('bg-md-secondary/90')).toBe('active:brightness-95');
  });

  test('container fills use the pressed tokens', () => {
    expect(pressedTreatmentFor('bg-md-primary-container')).toBe(
      'active:bg-md-primary-container-pressed'
    );
    expect(pressedTreatmentFor('bg-md-secondary-container')).toBe(
      'active:bg-md-secondary-container-pressed'
    );
  });

  test('color-mix ladders add 4 points (8% → 12%)', () => {
    expect(
      pressedTreatmentFor('bg-[color-mix(in_srgb,var(--md-on-surface-variant)_8%,transparent)]')
    ).toBe('active:bg-[color-mix(in_srgb,var(--md-on-surface-variant)_12%,transparent)]');
  });

  test('solid fills and brightness-up hovers press via brightness-95', () => {
    expect(pressedTreatmentFor('bg-md-primary')).toBe('active:brightness-95');
    expect(pressedTreatmentFor('bg-md-surface')).toBe('active:brightness-95');
    expect(pressedTreatmentFor('bg-md-outline-variant')).toBe('active:brightness-95');
    expect(pressedTreatmentFor('brightness-110')).toBe('active:brightness-95');
    expect(pressedTreatmentFor('brightness-105')).toBe('active:brightness-95');
  });

  test('unknown shapes return null (reported, never guessed)', () => {
    expect(pressedTreatmentFor('bg-some-unknown-token')).toBeNull();
    expect(pressedTreatmentFor('font-bold')).toBeNull();
  });
});

describe('findStateLayerViolations - element awareness', () => {
  test('only <button> elements are flagged; divs with role=button are out of scope', () => {
    const src = [
      '<button class="px-2 rounded-lg hover:bg-md-surface-variant">in</button>',
      '<div role="button" class="px-2 rounded-lg hover:bg-md-surface-variant">out</div>',
      '<span class="px-2 rounded-lg hover:bg-md-surface-variant">out</span>',
    ].join('\n');
    const violations = findStateLayerViolations(src);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(1);
  });

  test('a class attribute nested in a close-tag position is not misattributed', () => {
    const src = [
      '<div class="px-2 hover:bg-md-surface-variant rounded-lg">',
      '  <button class="px-2 hover:bg-md-surface-variant rounded-lg">go</button>',
      '</div>',
    ].join('\n');
    const violations = findStateLayerViolations(src);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(2);
  });

  test('multi-line class attributes are matched with the opening line number', () => {
    const src = [
      '<button',
      '  class="px-2 rounded-lg transition-colors',
      '    hover:bg-md-surface-variant"',
      '  type="button"',
      '>go</button>',
    ].join('\n');
    const violations = findStateLayerViolations(src);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(2);
    expect(violations[0].classes).toBe(
      'px-2 rounded-lg transition-colors hover:bg-md-surface-variant'
    );
  });

  test('unresolvable washes still count as violations (never silently skipped)', () => {
    const src = '<button class="px-2 hover:bg-not-a-token rounded-lg">go</button>';
    expect(findStateLayerViolations(src)).toHaveLength(1);
  });
});

describe('applyPressedTreatments - the codemod', () => {
  test('inserts the mapped treatment after each unpaired hover token', () => {
    const { source, insertions } = applyPressedTreatments(
      '<button class="px-2 rounded-lg hover:bg-md-surface-variant/50 transition-colors">go</button>'
    );
    expect(insertions).toBe(1);
    expect(source).toContain('hover:bg-md-surface-variant/50 active:bg-md-surface-variant/70');
  });

  test('handles multi-branch ternaries token-by-token', () => {
    const { source, insertions } = applyPressedTreatments(
      "<button class=\"px-2 {on ? 'bg-md-primary hover:bg-md-primary/90' : 'bg-md-surface hover:bg-md-surface-variant'}\">go</button>"
    );
    expect(insertions).toBe(2);
    expect(source).toContain('hover:bg-md-primary/90 active:brightness-95');
    expect(source).toContain('hover:bg-md-surface-variant active:brightness-95');
  });

  test('does not double-insert when a pressed step already follows', () => {
    const { source, insertions } = applyPressedTreatments(
      '<button class="px-2 hover:bg-md-surface-variant/50 active:bg-md-surface-variant/70">go</button>'
    );
    expect(insertions).toBe(0);
    expect(source).toBe(
      '<button class="px-2 hover:bg-md-surface-variant/50 active:bg-md-surface-variant/70">go</button>'
    );
  });

  test('inserts before trailing Svelte syntax (quote/brace), never swallowing it', () => {
    const { source, insertions } = applyPressedTreatments(
      `<button class="{on ? 'bg-md-surface hover:bg-md-surface-variant' : ''}">go</button>`
    );
    expect(insertions).toBe(1);
    expect(source).toContain(`hover:bg-md-surface-variant active:brightness-95'`);
  });

  test('round-trip: after the codemod, no violations remain', () => {
    const src = [
      '<button class="px-2 hover:bg-md-surface-variant/50 rounded-lg">a</button>',
      '<button class="w-5 h-5 rounded-full hover:bg-md-secondary-container">b</button>',
      "<button class=\"px-3 {on ? 'bg-md-primary hover:bg-md-primary/90' : ''}\">c</button>",
    ].join('\n');
    const { source, insertions } = applyPressedTreatments(src);
    expect(insertions).toBe(3);
    expect(findStateLayerViolations(source)).toHaveLength(0);
  });
});
