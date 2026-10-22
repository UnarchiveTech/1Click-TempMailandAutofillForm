import { describe, expect, test } from 'bun:test';
import {
  ACTION_BTN_TIERS,
  ACTION_BTN_TYPOGRAPHY_STEPS,
  type ActionBtnTier,
  coupledIconGap,
  iconForFont,
  nextTypographyStep,
  PAD_GAP_RATIO,
} from '@/utils/ui/responsive-button-layout.js';

const TIERS: ActionBtnTier[] = ['XS', 'S', 'M', 'L', 'XL'];

describe('responsiveButtonLayout tier table', () => {
  test('pins the five locked tiers', () => {
    expect(Object.keys(ACTION_BTN_TIERS)).toEqual(['XS', 'S', 'M', 'L', 'XL']);
  });

  test('keeps every tier above its own floors (floors are not ceilings)', () => {
    for (const tier of TIERS) {
      const t = ACTION_BTN_TIERS[tier];
      expect(t.minFont).toBeLessThanOrEqual(t.labelFont);
      expect(t.minIcon).toBeLessThanOrEqual(t.icon);
      expect(t.minSidePad).toBeLessThanOrEqual(t.sidePadding);
      expect(t.minGap).toBeLessThanOrEqual(t.iconGap);
    }
  });

  test('pins the universal floor shared by XS and S (12/16/4/3)', () => {
    for (const tier of ['XS', 'S'] as const) {
      const t = ACTION_BTN_TIERS[tier];
      expect([t.minFont, t.minIcon, t.minSidePad, t.minGap]).toEqual([12, 16, 4, 3]);
    }
    // No tier may sink below the universal font floor.
    for (const tier of TIERS) {
      expect(ACTION_BTN_TIERS[tier].minFont).toBeGreaterThanOrEqual(12);
    }
  });

  test('gap floors are locked table minimums the 1.75× ratio clamps at', () => {
    expect(PAD_GAP_RATIO).toBe(1.75);
    for (const tier of TIERS) {
      const t = ACTION_BTN_TIERS[tier];
      // The pure 1.75× ratio at the padding floor is at or below the locked
      // Min gap for every tier, so the floor always wins.
      expect(Math.round(t.minSidePad / PAD_GAP_RATIO)).toBeLessThanOrEqual(t.minGap);
      expect(coupledIconGap(tier, t.minSidePad)).toBe(t.minGap);
    }
  });

  describe('coupledIconGap - G = round(P / 1.75), clamped at Min gap', () => {
    test('produces the new 1.75-derived gap values (smaller than the old 1.5 ladder)', () => {
      // S tier (P0 16 / G0 8, floors 4/3): coupling engages at pad 13.
      expect(coupledIconGap('S', 13)).toBe(7);
      expect(coupledIconGap('S', 12)).toBe(7);
      expect(coupledIconGap('S', 11)).toBe(6);
      expect(coupledIconGap('S', 10)).toBe(6);
      expect(coupledIconGap('S', 9)).toBe(5);
      expect(coupledIconGap('S', 8)).toBe(5);
      expect(coupledIconGap('S', 7)).toBe(4);
      expect(coupledIconGap('S', 6)).toBe(3);
      expect(coupledIconGap('S', 5)).toBe(3);
      expect(coupledIconGap('S', 4)).toBe(3); // floor: pure ratio 2, locked 3 wins
      // XS tier (P0 12 / G0 4): coupling engages at pad 7 - the first
      // coupled gap equals the authored 4px, keeping a smooth handoff.
      expect(coupledIconGap('XS', 7)).toBe(4);
      expect(coupledIconGap('XS', 6)).toBe(3);
      expect(coupledIconGap('XS', 4)).toBe(3);
      // M tier: pad 13 → 7 is where the old 1.5 ladder had 9/8; now smaller.
      expect(coupledIconGap('M', 13)).toBe(7);
      expect(coupledIconGap('M', 12)).toBe(7);
      expect(coupledIconGap('M', 11)).toBe(6);
      expect(coupledIconGap('M', 10)).toBe(6);
      expect(coupledIconGap('M', 9)).toBe(5);
      expect(coupledIconGap('M', 8)).toBe(5); // floor
      // L tier: pure ratio values 7-9 clamp up to the locked 8px minimum.
      expect(coupledIconGap('L', 17)).toBe(10);
      expect(coupledIconGap('L', 16)).toBe(9);
      expect(coupledIconGap('L', 15)).toBe(9);
      expect(coupledIconGap('L', 14)).toBe(8);
      expect(coupledIconGap('L', 13)).toBe(8);
      expect(coupledIconGap('L', 12)).toBe(8); // floor
      // XL tier: locked 11px minimum clamps pure values below it.
      expect(coupledIconGap('XL', 24)).toBe(14);
      expect(coupledIconGap('XL', 21)).toBe(12);
      expect(coupledIconGap('XL', 20)).toBe(11);
      expect(coupledIconGap('XL', 16)).toBe(11); // floor
    });

    test('monotonic: the coupled gap never grows as padding compresses', () => {
      for (const tier of TIERS) {
        const t = ACTION_BTN_TIERS[tier];
        let last = coupledIconGap(tier, t.sidePadding);
        for (let pad = t.sidePadding; pad >= t.minSidePad; pad -= 1) {
          const gap = coupledIconGap(tier, pad);
          expect(gap).toBeLessThanOrEqual(last);
          last = gap;
        }
      }
    });
  });

  test('applies the deterministic icon↔font relation at base and at the floor', () => {
    for (const tier of TIERS) {
      const t = ACTION_BTN_TIERS[tier];
      expect(iconForFont(tier, t.labelFont)).toBe(t.icon);
      expect(iconForFont(tier, t.minFont)).toBe(t.minIcon);
    }
  });

  test('steps icons with the tier relation (2px for XS/S/M, 1px for L/XL)', () => {
    for (const tier of TIERS) {
      const step = iconForFont(tier, 20) - iconForFont(tier, 19);
      expect(step).toBe(tier === 'L' || tier === 'XL' ? 1 : 2);
    }
  });

  test('a 1px font step never overshoots the icon minimum', () => {
    for (const tier of TIERS) {
      const t = ACTION_BTN_TIERS[tier];
      expect(iconForFont(tier, t.minFont - 1)).toBeLessThan(t.minIcon);
    }
  });

  test('pins the discrete typography steps (baseline → minimum per tier)', () => {
    for (const tier of TIERS) {
      const t = ACTION_BTN_TIERS[tier];
      expect(ACTION_BTN_TYPOGRAPHY_STEPS[tier]).toEqual([t.labelFont, t.minFont]);
    }
  });

  test('nextTypographyStep compresses exactly one step, then stops at the minimum', () => {
    for (const tier of TIERS) {
      const t = ACTION_BTN_TIERS[tier];
      expect(nextTypographyStep(tier, t.labelFont)).toBe(t.minFont);
      expect(nextTypographyStep(tier, t.minFont)).toBeNull();
      // Typography never goes below the tier's minimum.
      expect(nextTypographyStep(tier, t.minFont - 1)).toBeNull();
    }
  });

  test('a typography step lands on the tier minimum icon via the icon↔font relation', () => {
    for (const tier of TIERS) {
      const t = ACTION_BTN_TIERS[tier];
      const stepped = nextTypographyStep(tier, t.labelFont);
      expect(stepped).not.toBeNull();
      expect(iconForFont(tier, stepped as number)).toBe(t.minIcon);
    }
  });
});
