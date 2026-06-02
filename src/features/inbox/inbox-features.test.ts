import { describe, expect, test } from 'bun:test';
import type { Account } from '@/utils/types';
import { toggleSelect, toggleSelectAll } from './inbox-bulk-actions';
import { canUnarchive } from './inbox-management';

// ── toggleSelectAll ─────────────────────────────────────────────────────────

describe('toggleSelectAll', () => {
  const accounts: Account[] = [
    {
      id: '1',
      address: 'a@test.com',
      provider: 'guerrilla',
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600000,
    },
    {
      id: '2',
      address: 'b@test.com',
      provider: 'guerrilla',
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600000,
    },
    {
      id: '3',
      address: 'c@test.com',
      provider: 'guerrilla',
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600000,
    },
  ];

  test('selects all when none are selected', () => {
    const result = toggleSelectAll(accounts, new Set());
    expect(result.size).toBe(3);
    expect(result.has('1')).toBe(true);
    expect(result.has('2')).toBe(true);
    expect(result.has('3')).toBe(true);
  });

  test('deselects all when all are selected', () => {
    const selected = new Set(['1', '2', '3']);
    const result = toggleSelectAll(accounts, selected);
    expect(result.size).toBe(0);
  });

  test('selects all when some are selected', () => {
    const selected = new Set(['1']);
    const result = toggleSelectAll(accounts, selected);
    expect(result.size).toBe(3);
  });

  test('returns empty set for empty accounts', () => {
    const result = toggleSelectAll([], new Set());
    expect(result.size).toBe(0);
  });
});

// ── toggleSelect ────────────────────────────────────────────────────────────

describe('toggleSelect', () => {
  test('adds id to set when not present', () => {
    const result = toggleSelect(new Set(), '1');
    expect(result.has('1')).toBe(true);
    expect(result.size).toBe(1);
  });

  test('removes id from set when present', () => {
    const result = toggleSelect(new Set(['1', '2']), '1');
    expect(result.has('1')).toBe(false);
    expect(result.has('2')).toBe(true);
    expect(result.size).toBe(1);
  });

  test('does not mutate original set', () => {
    const original = new Set(['1']);
    const result = toggleSelect(original, '2');
    expect(original.size).toBe(1);
    expect(result.size).toBe(2);
  });

  test('handles toggling same id twice', () => {
    let result = toggleSelect(new Set(), '1');
    result = toggleSelect(result, '1');
    expect(result.size).toBe(0);
  });
});

// ── canUnarchive ────────────────────────────────────────────────────────────

describe('canUnarchive', () => {
  test('returns true for guerrilla provider (canUnarchive: true)', () => {
    const account: Account = {
      id: '1',
      address: 'test@guerrilla.com',
      provider: 'guerrilla',
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600000,
      status: 'archived',
    };
    expect(canUnarchive(account)).toBe(true);
  });

  test('returns true for burner provider when not expired (canUnarchive: ifNotExpired)', () => {
    const account: Account = {
      id: '1',
      address: 'test@burner.kiwi',
      provider: 'burner',
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600000,
      status: 'archived',
    };
    expect(canUnarchive(account)).toBe(true);
  });

  test('returns false for burner provider when expired', () => {
    const account: Account = {
      id: '1',
      address: 'test@burner.kiwi',
      provider: 'burner',
      createdAt: Date.now() - 100000,
      expiresAt: Date.now() - 1000,
      status: 'expired',
    };
    expect(canUnarchive(account)).toBe(false);
  });
});
