import { describe, expect, test } from 'bun:test';
import { orderAddressList } from '@/features/address/address-list-order.js';
import { buildLabelUsage } from '@/features/address/label-usage.js';
import type { Address, Email } from '@/utils/types.js';

const address = (id: string, expiresAt: number): Address => ({
  id,
  address: `${id}@example.com`,
  expiresAt,
  createdAt: 1,
  provider: 'demo',
  status: 'active',
  accountStatus: 'active',
});
const email = (id: string, received_at: number, unread = false): Email => ({
  id,
  received_at,
  unread,
});

describe('address display order', () => {
  const addresses = [address('a', 300), address('b', 100), address('c', 0)];
  const messages = {
    'A@EXAMPLE.COM': [email('1', 10)],
    'b@example.com': [email('2', 20, true)],
    'c@example.com': [email('3', 30, true), email('4', 31, true)],
  };
  const unread = (list: Email[]) => list.filter((item) => item.unread).length;
  test('custom order is untouched and non-expiring addresses sort last', () => {
    expect(orderAddressList(addresses, 'custom', messages, unread)).toBe(addresses);
    expect(orderAddressList(addresses, 'expiry', messages, unread).map((item) => item.id)).toEqual([
      'b',
      'a',
      'c',
    ]);
    expect(addresses.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });
  test('unread and activity use inbox ownership and case-insensitive bag keys', () => {
    expect(orderAddressList(addresses, 'unread', messages, unread).map((item) => item.id)).toEqual([
      'c',
      'b',
      'a',
    ]);
    expect(orderAddressList(addresses, 'recent', messages, unread).map((item) => item.id)).toEqual([
      'c',
      'b',
      'a',
    ]);
  });
  test('equal metrics retain custom order', () => {
    expect(orderAddressList(addresses, 'unread', {}, unread)).toEqual(addresses);
  });
});

describe('label usage', () => {
  test('scopes colliding IDs, deduplicates bags, excludes deleted and orphaned records', () => {
    const maps = {
      storedEmails: {
        'a@example.com': [email('same', 10), { ...email('deleted', 11), local_deleted: true }],
      },
      archivedEmails: {
        'b@example.com': [email('same', 20)],
        'a@example.com': [email('same', 10)],
      },
    };
    const labels = {
      'a@example.com_same': ['Bank', 'Bank'],
      'b@example.com_same': ['Receipts'],
      'a@example.com_deleted': ['Bank'],
      missing: ['Bank'],
    };
    const usage = buildLabelUsage(labels, maps);
    expect(usage.Bank).toHaveLength(1);
    expect(usage.Bank[0].original_inbox).toBe('a@example.com');
    expect(usage.Receipts).toHaveLength(1);
    expect(usage.Receipts[0]).toMatchObject({
      original_inbox: 'b@example.com',
      local_archived: true,
    });
  });
  test('preserves legacy labels without leaking another inbox’s scoped labels', () => {
    const usage = buildLabelUsage(
      { same: ['Legacy'], 'a@example.com_same': ['Scoped'] },
      {
        storedEmails: { 'a@example.com': [email('same', 1)], 'b@example.com': [email('same', 2)] },
        archivedEmails: {},
      }
    );
    expect(usage.Scoped.map((item) => item.original_inbox)).toEqual(['a@example.com']);
    expect(usage.Legacy.map((item) => item.original_inbox)).toEqual(['b@example.com']);
  });
});
