import { describe, expect, test } from 'bun:test';
import { chooseToolbarPosition } from '@/entrypoints/content/dom/positioning';

const rect = (left: number, top: number, right: number, bottom: number) => ({
  left,
  top,
  right,
  bottom,
});
const viewport = { width: 1280, height: 950 };

describe('signup toolbar placement', () => {
  test('does not cover an external heading when the gap below it is too short', () => {
    const heading = rect(202.5, 115, 1062.5, 139.2);
    const firstLabel = rect(202.5, 176, 618, 191);
    const firstField = rect(202.5, 197, 618, 241);
    expect(
      chooseToolbarPosition(
        heading,
        rect(202.5, 159.2, 1062.5, 1235.8),
        { width: 250, height: 32 },
        viewport,
        [heading, firstLabel, firstField]
      )
    ).toEqual({ top: 77, left: 202.5, visible: true });
  });
  test('keeps a free anchor gap', () => {
    const anchor = rect(100, 100, 400, 140);
    expect(
      chooseToolbarPosition(
        anchor,
        rect(100, 100, 400, 300),
        { width: 250, height: 32 },
        viewport,
        [anchor]
      )
    ).toEqual({ top: 146, left: 100, visible: true });
  });
  test('moves below the form instead of intercepting Continue', () => {
    const field = rect(488, 395, 792, 433);
    const submit = rect(488, 450, 792, 490);
    expect(
      chooseToolbarPosition(field, rect(488, 395, 792, 490), { width: 380, height: 32 }, viewport, [
        field,
        submit,
      ])
    ).toEqual({ top: 496, left: 488, visible: true });
  });
  test('clamps wide post-fill controls to the viewport', () => {
    const anchor = rect(1100, 100, 1250, 140);
    expect(
      chooseToolbarPosition(anchor, anchor, { width: 400, height: 32 }, viewport, [anchor])
    ).toEqual({ top: 146, left: 876, visible: true });
  });
  test('uses space above the form when the lower viewport is full', () => {
    const field = rect(100, 875, 400, 910);
    const submit = rect(100, 918, 400, 949);
    expect(
      chooseToolbarPosition(field, rect(100, 875, 400, 949), { width: 300, height: 32 }, viewport, [
        field,
        submit,
      ])
    ).toEqual({ top: 837, left: 100, visible: true });
  });
  test('does not cover the site when there is no free space', () => {
    expect(
      chooseToolbarPosition(
        rect(0, 0, 100, 80),
        rect(0, 0, 100, 80),
        { width: 90, height: 32 },
        { width: 100, height: 80 },
        [rect(0, 0, 100, 80)]
      ).visible
    ).toBe(false);
  });
});
