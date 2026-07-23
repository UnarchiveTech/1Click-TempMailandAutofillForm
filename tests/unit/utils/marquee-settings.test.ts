import { describe, expect, test } from 'bun:test';
import {
  collectIntersectingIds,
  MARQUEE_THRESHOLD,
  normalizeMarquee,
  rectsIntersect,
} from '@/utils/marquee-selection.js';

describe('marquee-selection', () => {
  test('normalizeMarquee orders corners', () => {
    const r = normalizeMarquee({ x: 10, y: 20 }, { x: 5, y: 8 });
    expect(r.left).toBe(5);
    expect(r.top).toBe(8);
    expect(r.right).toBe(10);
    expect(r.bottom).toBe(20);
  });

  test('rectsIntersect detects overlap', () => {
    const a = { left: 0, top: 0, right: 10, bottom: 10 };
    const b = { left: 5, top: 5, right: 15, bottom: 15 };
    const c = { left: 20, top: 20, right: 30, bottom: 30 };
    expect(rectsIntersect(a, b)).toBe(true);
    expect(rectsIntersect(a, c)).toBe(false);
  });

  test('MARQUEE_THRESHOLD is positive', () => {
    expect(MARQUEE_THRESHOLD).toBeGreaterThan(0);
  });

  test('collectIntersectingIds returns empty without DOM items', () => {
    // jsdom-less: empty root with querySelectorAll stub
    const root = {
      querySelectorAll: () => [],
    } as unknown as HTMLElement;
    const ids = collectIntersectingIds(root, '[data-marquee-id]', {
      left: 0,
      top: 0,
      right: 100,
      bottom: 100,
    });
    expect(ids).toEqual([]);
  });
});

describe('provider list excludes demo', () => {
  test('getAllProviderConfigs never returns demo', async () => {
    const { getAllProviderConfigs, loadAllProviderConfigs } = await import(
      '@/utils/email-service.js'
    );
    const all = Object.keys(loadAllProviderConfigs());
    expect(all.includes('demo')).toBe(true);
    const pickable = getAllProviderConfigs();
    expect(pickable.every((p) => p.id !== 'demo')).toBe(true);
    expect(pickable.length).toBeGreaterThan(0);
  });
});

describe('account status helpers', () => {
  test('isLive / isArchived', async () => {
    const { isLive, isArchived } = await import('@/utils/account-status.js');
    expect(
      isLive({
        id: '1',
        address: 'a@b.c',
        token: 't',
        provider: 'guerrilla',
        createdAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        accountStatus: 'active',
      } as never)
    ).toBe(true);
    expect(
      isArchived({
        id: '2',
        address: 'a@b.c',
        token: 't',
        provider: 'guerrilla',
        createdAt: Date.now(),
        expiresAt: 0,
        accountStatus: 'archived',
      } as never)
    ).toBe(true);
  });
});
