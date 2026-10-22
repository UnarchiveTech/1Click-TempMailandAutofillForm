import { describe, expect, test } from 'bun:test';
import {
  collectVerificationItems,
  groupVerificationItems,
} from '@/features/address/verification-items.js';
import {
  normalizeVerificationPreferences,
  verificationExpiresAt,
} from '@/utils/otp/verification-policy.js';
import type { Email } from '@/utils/types.js';

const noon = Date.UTC(2026, 9, 14, 12);
const minute = 60_000;
const message = (id: string, offset: number, extra: Partial<Email> = {}): Email => ({
  id,
  received_at: noon + offset * minute,
  from: 'GitHub <noreply@notifications.github.com>',
  otp: id,
  ...extra,
});
const collect = (messages: Email[], now: number, limit = 30) =>
  collectVerificationItems([{ address: 'a@sharklasers.com', emails: messages }], limit, now);

describe('verification time policy', () => {
  test('caps detected one-hour validity at receipt plus thirty minutes', () => {
    expect(verificationExpiresAt(noon, noon + 60 * minute, 30, noon)).toBe(noon + 30 * minute);
    expect(verificationExpiresAt(noon, undefined, 30, noon)).toBe(noon + 30 * minute);
    expect(verificationExpiresAt(noon, noon + 5 * minute, 30, noon)).toBe(noon + 5 * minute);
  });
  test('supports a user limit, seconds-based providers and invalid receipt times', () => {
    expect(verificationExpiresAt(noon / 1000, undefined, 60, noon)).toBe(noon + 60 * minute);
    for (const received of [0, NaN, Infinity, noon + 3 * minute])
      expect(verificationExpiresAt(received, undefined, 30, noon)).toBe(0);
    expect(normalizeVerificationPreferences(undefined)).toEqual({
      maxAgeMinutes: 30,
      grouping: 'address',
    });
    expect(
      normalizeVerificationPreferences({ maxAgeMinutes: Infinity, grouping: 'invalid' })
    ).toEqual({ maxAgeMinutes: 30, grouping: 'address' });
    expect(
      normalizeVerificationPreferences({ maxAgeMinutes: -10, grouping: 'website' }).maxAgeMinutes
    ).toBe(1);
    expect(normalizeVerificationPreferences({ maxAgeMinutes: 2000 }).maxAgeMinutes).toBe(1440);
  });
  test('A at noon and B at 12:10 do not suggest A at 12:41', () => {
    const messages = [message('A', 0, { otpExpiresAt: noon + 60 * minute }), message('B', 10)];
    const at41 = collect(messages, noon + 41 * minute);
    expect(at41.filter((item) => item.status === 'current')).toEqual([]);
    expect(at41).toHaveLength(2);
    expect(
      collect(messages, noon + 11 * minute).find((item) => item.status === 'current')?.value
    ).toBe('B');
  });
  test('a newer short-lived code reserves its lane after expiry; re-reading does not renew it', () => {
    const messages = [message('old', 0), message('new', 10, { otpExpiresAt: noon + 15 * minute })];
    const items = collect(messages, noon + 20 * minute);
    expect(items.find((item) => item.value === 'old')?.status).toBe('earlier');
    expect(items.find((item) => item.value === 'new')?.status).toBe('expired');
    expect(
      collect(messages, noon + 25 * minute).filter((item) => item.status === 'current')
    ).toEqual([]);
  });
  test('an archived newer code still reserves its lane and deleted messages stay excluded', () => {
    const items = collect(
      [
        message('old', 0),
        message('new', 1, { local_archived: true }),
        message('deleted', 2, { local_deleted: true }),
      ],
      noon + 3 * minute
    );
    expect(items.map((item) => item.status)).toEqual(['earlier', 'earlier']);
  });
});

describe('verification grouping', () => {
  test('equal timestamps preserve provider order instead of sorting by arbitrary IDs', () => {
    const items = collect([message('z-newer', 0), message('a-older', 0)], noon);
    expect(items.find((item) => item.status === 'current')?.value).toBe('z-newer');
    expect(items[1]?.status).toBe('earlier');
  });
  test('four GitHub codes form one website section in address mode', () => {
    const items = collect(
      [0, 1, 2, 3].map((offset) => message(String(offset), offset)),
      noon + 4 * minute
    );
    const groups = groupVerificationItems(items, 'address');
    expect(groups).toHaveLength(1);
    expect(groups[0]?.sections).toHaveLength(1);
    expect(groups[0]?.sections[0]?.key).toBe('github.com');
    expect(groups[0]?.sections[0]?.items.map((item) => item.value)).toEqual(['3', '2', '1', '0']);
  });
  test('website mode retains recipients, keeps inbox lanes distinct and includes mixed verification kinds', () => {
    const items = collectVerificationItems(
      [
        {
          address: 'first@sharklasers.com',
          emails: [
            message('code', 0),
            message('link', 1, {
              otp: null,
              magicLinks: [{ url: 'https://github.com/session/abc', score: 10 }],
            }),
          ],
        },
        { address: 'second@burner.kiwi', emails: [message('code', 2)] },
      ],
      30,
      noon + 3 * minute
    );
    const groups = groupVerificationItems(items, 'website');
    expect(groups.map((group) => group.key)).toEqual(['github.com']);
    expect(groups[0]?.count).toBe(3);
    expect(new Set(groups[0]?.sections.map((section) => section.key))).toEqual(
      new Set(['first@sharklasers.com', 'second@burner.kiwi'])
    );
    expect(items.every((item) => item.status === 'current')).toBe(true);
    expect(new Set(items.map((item) => item.id)).size).toBe(3);
  });
  test('same URL across inboxes stays distinct, malformed URLs are ignored and tenant domains stay separate', () => {
    const items = collectVerificationItems(
      ['one', 'two'].map((name) => ({
        address: `${name}@example.com`,
        emails: [
          message('id', 0, {
            from: `a@${name}.github.io`,
            magicLinks: [
              { url: 'https://github.com/login/shared', score: 10 },
              { url: 'javascript:alert(1)', score: 10 },
            ],
          }),
        ],
      })),
      30,
      noon
    );
    expect(items).toHaveLength(4);
    expect(
      groupVerificationItems(items, 'website')
        .map((group) => group.key)
        .sort()
    ).toEqual(['github.com', 'one.github.io', 'two.github.io']);
    expect(groupVerificationItems(items, 'address', 'two@example.com')[0]?.key).toBe(
      'two@example.com'
    );
  });
});
