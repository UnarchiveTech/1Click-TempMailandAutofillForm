import { describe, expect, test } from 'bun:test';
import {
  ACTION_BTN_TIERS,
  type ActionBtnTier,
  interButtonGapForPadding,
} from '@/utils/ui/responsive-button-layout.js';

const TIERS: ActionBtnTier[] = ['XS', 'S', 'M', 'L', 'XL'];

describe('interButtonGapForPadding - responsive inter-button-gap compression', () => {
  test('S row reduces its gap alongside padding, without the old delayed shrink', () => {
    expect(interButtonGapForPadding('S', 16, 12)).toBe(12);
    expect(interButtonGapForPadding('S', 14, 12)).toBe(10.5);
    expect(interButtonGapForPadding('S', 12, 12)).toBe(9);
    expect(interButtonGapForPadding('S', 8, 12)).toBe(6);
    expect(interButtonGapForPadding('S', 4, 12)).toBe(4);
  });

  test('a dialog footer preserves its smaller 8px baseline until padding needs less', () => {
    expect(interButtonGapForPadding('S', 16, 8)).toBe(8);
    expect(interButtonGapForPadding('S', 12, 8)).toBe(8);
    expect(interButtonGapForPadding('S', 10, 8)).toBe(7.5);
    expect(interButtonGapForPadding('S', 8, 8)).toBe(6);
    expect(interButtonGapForPadding('S', 4, 8)).toBe(4);
  });

  test('compact rows no longer inherit the old 18px separation', () => {
    expect(interButtonGapForPadding('XS', 12, 18)).toBe(8);
    expect(interButtonGapForPadding('XS', 8, 18)).toBe(6);
    expect(interButtonGapForPadding('XS', 4, 18)).toBe(4);
    expect(interButtonGapForPadding('S', 16, 40)).toBe(12);
  });

  test('larger tiers preserve compact spacing without forcing the ¾ value', () => {
    expect(interButtonGapForPadding('M', 24, 8)).toBe(8);
    expect(interButtonGapForPadding('M', 10, 8)).toBe(7.5);
    expect(interButtonGapForPadding('M', 8, 8)).toBe(6);
    expect(interButtonGapForPadding('L', 12, 8)).toBe(8);
    expect(interButtonGapForPadding('XL', 16, 8)).toBe(8);
  });

  test('never exceeds the rendered baseline - an under-authored row is never widened', () => {
    // S tier row authored at 6px (MailboxView gap-1.5): B0 is capped at 6.
    expect(interButtonGapForPadding('S', 16, 6)).toBe(6);
    expect(interButtonGapForPadding('S', 7, 6)).toBe(5.25);
    expect(interButtonGapForPadding('S', 5.5, 6)).toBe(4.125);
    expect(interButtonGapForPadding('S', 4, 6)).toBe(4);
  });

  test('never widens an authored gap at or below the 4px floor', () => {
    expect(interButtonGapForPadding('L', 12, 4)).toBe(4);
    expect(interButtonGapForPadding('L', 48, 4)).toBe(4);
    expect(interButtonGapForPadding('S', 4, 2)).toBe(2);
    expect(interButtonGapForPadding('XS', 4, 4)).toBe(4);
    expect(interButtonGapForPadding('XS', 12, 4)).toBe(4);
  });

  test('a row with no authored gap stays at zero', () => {
    for (const tier of TIERS) {
      expect(interButtonGapForPadding(tier, ACTION_BTN_TIERS[tier].minSidePad, 0)).toBe(0);
      expect(interButtonGapForPadding(tier, ACTION_BTN_TIERS[tier].sidePadding, 0)).toBe(0);
    }
  });

  test('monotonic: B never increases as padding compresses (canonical rows)', () => {
    for (const tier of TIERS) {
      const t = ACTION_BTN_TIERS[tier];
      let last = interButtonGapForPadding(tier, t.sidePadding, t.interButtonGap);
      for (let pad = t.sidePadding; pad >= t.minSidePad; pad -= 0.25) {
        const b = interButtonGapForPadding(tier, pad, t.interButtonGap);
        expect(b).toBeLessThanOrEqual(last + 1e-9);
        last = b;
      }
    }
  });
});
