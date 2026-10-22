import { describe, expect, test } from 'bun:test';
import {
  ACTIVITY_CARD_IDS,
  activityDay,
  activityPeriodBounds,
  activityWebsiteHost,
  appendActivityHistory,
  matchesActivityEvent,
  normalizeActivityCards,
  parseActivityEvents,
  parseActivityHistory,
  pruneActivityHistory,
  seedActivityHistory,
} from '@/utils/activity/activity-history.js';
import type { ActivityEvent } from '@/utils/types.js';

const now = new Date(2026, 9, 17, 12).getTime();
const event = (timestamp = now, data: ActivityEvent['data'] = {}): ActivityEvent => ({
  id: String(timestamp),
  type: 'email_received',
  timestamp,
  data,
});
const filters = {
  query: '',
  type: 'all',
  address: 'all',
  failures: false,
  from: '',
  to: '',
  day: null,
  hour: null,
};

describe('activity history', () => {
  test('website chart groups URLs by exact normalized host', () => {
    expect(activityWebsiteHost('https://www.GitHub.com/login')).toBe('github.com');
    expect(activityWebsiteHost('github.com/path')).toBe('github.com');
    expect(activityWebsiteHost('evilgithub.com')).not.toBe('github.com');
  });
  test('daily counts survive the detail cap and retain no message data', () => {
    let history = seedActivityHistory([], now);
    for (let i = 0; i < 125; i++)
      history = appendActivityHistory(
        history,
        event(now, { otp: 'secret', address: 'a@example.test' }),
        now
      );
    expect(history.days).toEqual([
      { day: '2026-10-17', counts: { email_received: 125 }, failures: 0 },
    ]);
    expect(JSON.stringify(history)).not.toContain('secret');
    expect(JSON.stringify(history)).not.toContain('example.test');
  });
  test('retention prunes on read and preserves its honest coverage start', () => {
    const start = new Date(2026, 6, 19, 12).getTime();
    const history = seedActivityHistory([event(start), event(now)], now);
    expect(history.days.map((day) => day.day)).toEqual(['2026-10-17']);
    expect(activityDay(history.startedAt)).toBe('2026-07-20');
    expect(pruneActivityHistory(history, new Date(2027, 0, 20).getTime()).days).toEqual([]);
  });
  test('storage boundary drops malformed, duplicate and unknown records', () => {
    expect(
      parseActivityEvents([
        null,
        {},
        event(),
        event(),
        { ...event(), id: 'bad', timestamp: NaN },
        { ...event(), id: 'unknown', type: '__proto__' },
      ])
    ).toEqual([event()]);
    expect(
      parseActivityHistory({
        version: 1,
        startedAt: now,
        days: [{ day: '2026-02-30', counts: {}, failures: 0 }],
      })
    ).toBeNull();
    expect(
      parseActivityHistory({
        version: 1,
        startedAt: now,
        days: [{ day: '2026-10-17', counts: 'bad', failures: 0 }],
      })
    ).toBeNull();
    expect(
      parseActivityHistory({
        version: 1,
        startedAt: now,
        days: [{ day: '2026-10-17', counts: JSON.parse('{"__proto__":1}'), failures: 0 }],
      })
    ).toBeNull();
    expect(parseActivityHistory(seedActivityHistory([event()], now))).not.toBeNull();
  });
  test('search and filters intersect, including translated titles and legacy events', () => {
    const record = event(now, {
      address: 'One@Example.test',
      provider: 'sample',
      outcome: 'failure',
      website: 'github.com',
    });
    expect(
      matchesActivityEvent(record, {
        ...filters,
        query: 'GITHUB',
        address: 'one@example.test',
        failures: true,
        day: activityDay(now),
        hour: 12,
      })
    ).toBe(true);
    expect(
      matchesActivityEvent(record, { ...filters, query: 'localized' }, 'Localized action')
    ).toBe(true);
    expect(matchesActivityEvent(record, { ...filters, type: 'received' })).toBe(true);
    expect(
      matchesActivityEvent(record, { ...filters, type: 'email_received', chartType: 'auto_fill' })
    ).toBe(false);
    expect(matchesActivityEvent(record, { ...filters, from: '2026-10-18' })).toBe(false);
    expect(matchesActivityEvent(record, { ...filters, hour: 11 })).toBe(false);
    expect(
      matchesActivityEvent(
        { ...record, type: 'account_created' },
        { ...filters, type: 'address_created' }
      )
    ).toBe(true);
  });
  test('relative periods use inclusive local calendar days, not 24-hour offsets', () => {
    expect(activityPeriodBounds('week', '', '', now)).toEqual({
      from: '2026-10-11',
      to: '2026-10-17',
    });
    expect(activityPeriodBounds('month', '', '', now)).toEqual({
      from: '2026-09-18',
      to: '2026-10-17',
    });
    expect(activityPeriodBounds('custom', '2026-09-01', '2026-09-02', now)).toEqual({
      from: '2026-09-01',
      to: '2026-09-02',
    });
  });
  test('dashboard preferences preserve order, ignore strangers and append missing cards once', () => {
    const cards = normalizeActivityCards([
      { id: 'sites', visible: false },
      { id: 'sites' },
      { id: 'unknown' },
      null,
    ]);
    expect(cards[0]).toEqual({ id: 'sites', visible: false });
    expect(new Set(cards.map((card) => card.id)).size).toBe(ACTIVITY_CARD_IDS.length);
    expect(cards).toHaveLength(ACTIVITY_CARD_IDS.length);
  });
});
