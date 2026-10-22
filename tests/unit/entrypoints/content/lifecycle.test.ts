import { describe, expect, test } from 'bun:test';
import { restoreHistoryMethods } from '@/entrypoints/content/index.js';

describe('content-script lifecycle helpers', () => {
  test('restores patched SPA history methods during teardown', () => {
    const originalPushState = (() => undefined) as History['pushState'];
    const originalReplaceState = (() => undefined) as History['replaceState'];
    const historyObject = {
      pushState: (() => undefined) as History['pushState'],
      replaceState: (() => undefined) as History['replaceState'],
    };

    restoreHistoryMethods(historyObject, originalPushState, originalReplaceState);

    expect(historyObject.pushState).toBe(originalPushState);
    expect(historyObject.replaceState).toBe(originalReplaceState);
  });

  test('does not replace history methods when teardown receives the originals', () => {
    const originalPushState = (() => undefined) as History['pushState'];
    const originalReplaceState = (() => undefined) as History['replaceState'];
    const historyObject = {
      pushState: originalPushState,
      replaceState: originalReplaceState,
    };

    restoreHistoryMethods(historyObject, originalPushState, originalReplaceState);

    expect(historyObject.pushState).toBe(originalPushState);
    expect(historyObject.replaceState).toBe(originalReplaceState);
  });
});
