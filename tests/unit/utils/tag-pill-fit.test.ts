import { describe, expect, test } from 'bun:test';
import { fitTagPillCount } from '@/utils/ui/tag-pill-fit.js';

describe('mailbox tag row fitting', () => {
  test('uses every tag when the full row fits', () => {
    expect(fitTagPillCount([65, 70, 75], [85, 90], 222, 6)).toBe(3);
  });

  test('reserves the +N width on the final visible tag', () => {
    expect(fitTagPillCount([65, 70, 75], [85, 90], 161, 6)).toBe(2);
    expect(fitTagPillCount([65, 70, 75], [85, 90], 150, 6)).toBe(1);
  });

  test('keeps one truncated pill available at very narrow widths', () => {
    expect(fitTagPillCount([65, 70, 75], [85, 90], 40, 6)).toBe(1);
    expect(fitTagPillCount([], [], 100, 6)).toBe(0);
  });
});
