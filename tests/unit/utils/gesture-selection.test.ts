import { describe, expect, test } from 'bun:test';
import { createHoldController, GESTURE } from '@/utils/ui/gesture-selection.js';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * createHoldController is the shared long-press → multi-select engine used by
 * MailboxView / AddressesView / IdentitiesView. These tests pin the contract
 * every surface relies on: a hold fires once after `holdMs` and arms a
 * click-suppression window; cancel / cancelAll / same-key overwrite stop it;
 * armSuppression arms the window directly (marquee / right-click paths).
 */
describe('createHoldController', () => {
  test('fires onHold after holdMs and arms the suppression window', async () => {
    const ctrl = createHoldController({ holdMs: 10, suppressClickMs: 150 });
    let fired = 0;
    ctrl.start('row', () => fired++);

    // Well past holdMs: the hold fired exactly once.
    await sleep(60);
    expect(fired).toBe(1);

    // The click that ends a long-press must be suppressed right after the fire…
    expect(ctrl.isSuppressingClick()).toBe(true);

    // …and the window closes after suppressClickMs elapses.
    await sleep(200);
    expect(ctrl.isSuppressingClick()).toBe(false);
  });

  test('cancel before holdMs prevents both the callback and suppression', async () => {
    const ctrl = createHoldController({ holdMs: 10, suppressClickMs: 150 });
    let fired = 0;
    ctrl.start('row', () => fired++);
    ctrl.cancel('row');

    await sleep(60);
    expect(fired).toBe(0);
    expect(ctrl.isSuppressingClick()).toBe(false);
  });

  test('starting the same key again overwrites the pending hold', async () => {
    const ctrl = createHoldController({ holdMs: 10, suppressClickMs: 50 });
    let fired = 0;
    ctrl.start('row', () => fired++);
    ctrl.start('row', () => fired++);

    await sleep(60);
    expect(fired).toBe(1);
  });

  test('distinct keys hold independently', async () => {
    const ctrl = createHoldController({ holdMs: 10, suppressClickMs: 50 });
    const fired: string[] = [];
    ctrl.start('a', () => fired.push('a'));
    ctrl.start('b', () => fired.push('b'));
    ctrl.cancel('a');

    await sleep(60);
    expect(fired).toEqual(['b']);
  });

  test('cancelAll clears every pending hold', async () => {
    const ctrl = createHoldController({ holdMs: 10, suppressClickMs: 50 });
    let fired = 0;
    ctrl.start('a', () => fired++);
    ctrl.start('b', () => fired++);
    ctrl.cancelAll();

    await sleep(60);
    expect(fired).toBe(0);
    expect(ctrl.isSuppressingClick()).toBe(false);
  });

  test('armSuppression opens the window immediately (marquee / menu paths)', async () => {
    const ctrl = createHoldController({ suppressClickMs: 150 });
    expect(ctrl.isSuppressingClick()).toBe(false);
    ctrl.armSuppression();
    expect(ctrl.isSuppressingClick()).toBe(true);
    await sleep(200);
    expect(ctrl.isSuppressingClick()).toBe(false);
  });

  test('defaults fall back to GESTURE constants', async () => {
    const ctrl = createHoldController();
    let fired = 0;
    const startedAt = Date.now();
    ctrl.start('row', () => {
      fired++;
    });
    await sleep(GESTURE.holdMs + 40);
    expect(fired).toBe(1);
    // Suppression armed at fire time, still open ~now (window is 500ms).
    expect(Date.now() - startedAt).toBeLessThan(GESTURE.holdMs + 500);
    expect(ctrl.isSuppressingClick()).toBe(true);
    await sleep(GESTURE.suppressClickMs + 40);
    expect(ctrl.isSuppressingClick()).toBe(false);
  });
});
