/**
 * Unit tests for the dev-only content→background message counter.
 *
 * The bridge funnel (`safeSendCall`) feeds `trackBgMessage()` so the
 * Diagnostics perf report can show per-page-load message totals - the
 * evidence behind the ad-frame wake reduction. These tests pin the
 * accounting contract:
 *  - every live send counts exactly once, labeled with its message type
 *  - the generic sink labels with the caller-supplied discriminant
 *  - a synchronous send throw (context invalidated) is NOT counted - the
 *    worker never received that message, so it is not a page event
 *  - the invalidated-context short-circuit is NOT counted
 *  - the report is heaviest-first with a summed total and a page label
 *  - clearPerfReport resets counters along with the marks
 */

import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

type SendPayload = Record<string, unknown>;

const sendState: {
  mode: 'ok' | 'sync-throw';
  calls: SendPayload[];
} = { mode: 'ok', calls: [] };

mock.module('wxt/browser', () => ({
  browser: {
    runtime: {
      sendMessage: (message: SendPayload) => {
        sendState.calls.push(message);
        if (sendState.mode === 'sync-throw') {
          throw new Error('Extension context invalidated.');
        }
        if (message.type === 'getStorageViaBg') {
          return { success: true, data: {} };
        }
        return { success: true };
      },
    },
  },
}));

afterAll(() => {
  mock.restore();
});

const bridge = await import('@/utils/content/content-bg-bridge.js');
const perf = await import('@/utils/perf/perf-marks.js');

describe('bg message counter (dev)', () => {
  beforeEach(() => {
    sendState.mode = 'ok';
    sendState.calls = [];
    bridge.resetContentBridgeForTests();
    perf.clearPerfReport();
  });

  test('counts each live send under its message type', async () => {
    await bridge.getStorageViaBg('themeColors');
    await bridge.getStorageViaBg('other');
    const rep = perf.getMessageCountReport();
    expect(rep.total).toBe(2);
    expect(rep.entries).toHaveLength(1);
    expect(rep.entries[0].type).toBe('getStorageViaBg');
    expect(rep.entries[0].count).toBe(2);
  });

  test('generic sink labels the send with the caller-supplied type', async () => {
    await bridge.sendMessageViaBg({ type: 'formPresence', formDetected: true });
    const rep = perf.getMessageCountReport();
    expect(rep.entries.map((e) => e.type)).toContain('formPresence');
  });

  test('sync send throw (context invalidated) is not counted', async () => {
    sendState.mode = 'sync-throw';
    await bridge.getStorageViaBg('themeColors');
    expect(bridge.isExtensionContextInvalidated()).toBe(true);
    // Short-circuits after invalidation - also must not count.
    await bridge.getStorageViaBg('themeColors');
    const rep = perf.getMessageCountReport();
    expect(rep.total).toBe(0);
    expect(rep.entries).toHaveLength(0);
    expect(sendState.calls).toHaveLength(1); // only the throwing attempt
  });

  test('report sorts heaviest-first and sums the total', async () => {
    await bridge.getStorageViaBg('a');
    await bridge.sendMessageViaBg({ type: 'formPresence', formDetected: false });
    await bridge.sendMessageViaBg({ type: 'formPresence', formDetected: true });
    const rep = perf.getMessageCountReport();
    expect(rep.total).toBe(3);
    expect(rep.entries[0].type).toBe('formPresence'); // 2 beats getStorageViaBg's 1
    expect(rep.entries[0].count).toBe(2);
    expect(typeof rep.entries[0].lastAt).toBe('number');
  });

  test('report always carries a non-empty page label', async () => {
    await bridge.getStorageViaBg('a');
    const rep = perf.getMessageCountReport();
    expect(typeof rep.page).toBe('string');
    expect(rep.page.length).toBeGreaterThan(0);
  });

  test('clearPerfReport resets counters together with marks', async () => {
    await bridge.getStorageViaBg('a');
    perf.clearPerfReport();
    const rep = perf.getMessageCountReport();
    expect(rep.total).toBe(0);
    expect(rep.entries).toHaveLength(0);
  });
});
