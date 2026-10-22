import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

import {
  getEmailLabelCatalog,
  hashLabelColor,
  labelColorFor,
  mergeLabelsIntoCatalog,
  setEmailLabelCatalog,
} from '@/utils/email/email-label-catalog.js';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
const store: Record<string, unknown> = {};
const sessionStore: Record<string, unknown> = {};

const fakeBrowser = {
  storage: {
    local: {
      get: async (keys?: string | string[] | null) => {
        const list = Array.isArray(keys) ? keys : keys ? [keys] : [];
        const result: Record<string, unknown> = {};
        for (const key of list) if (key in store) result[key] = store[key];
        return result;
      },
      set: async (items: Record<string, unknown>) => {
        Object.assign(store, items);
      },
      remove: async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
      },
    },
    session: {
      get: async (keys?: string | string[] | null) => {
        if (keys === null || keys === undefined) return { ...sessionStore };
        const list = Array.isArray(keys) ? keys : [keys];
        const result: Record<string, unknown> = {};
        for (const key of list) if (key in sessionStore) result[key] = sessionStore[key];
        return result;
      },
      set: async (items: Record<string, unknown>) => {
        Object.assign(sessionStore, items);
      },
      remove: async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete sessionStore[key];
      },
    },
  },
};

mock.module('wxt/browser', () => ({ browser: fakeBrowser }));
Object.assign(globalThis, { browser: fakeBrowser });

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
});

describe('hashLabelColor', () => {
  test('is deterministic for the same name', () => {
    expect(hashLabelColor('Work')).toBe(hashLabelColor('Work'));
  });

  test('is case-insensitive', () => {
    expect(hashLabelColor('Work')).toBe(hashLabelColor('work'));
    expect(hashLabelColor('Work')).toBe(hashLabelColor('WORK'));
  });

  test('returns distinct colors for different names', () => {
    const colors = new Set(
      ['Work', 'Personal', 'Banking', 'Shopping', 'Travel'].map(hashLabelColor)
    );
    expect(colors.size).toBe(5);
  });

  test('returns a #rrggbb hex color', () => {
    expect(hashLabelColor('Spam')).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('labelColorFor', () => {
  const defs = [
    { name: 'Work', color: '#ff0000' },
    { name: 'Personal', color: '#00ff00' },
  ];

  test('resolves exact name', () => {
    expect(labelColorFor(defs, 'Work')).toBe('#ff0000');
  });

  test('resolves case-insensitively', () => {
    expect(labelColorFor(defs, 'personal')).toBe('#00ff00');
    expect(labelColorFor(defs, 'PERSONAL')).toBe('#00ff00');
  });

  test('falls back to a stable hash color for unknown labels', () => {
    expect(labelColorFor(defs, 'Spam')).toBe(hashLabelColor('Spam'));
    expect(labelColorFor(defs, 'spam')).toBe(hashLabelColor('Spam'));
    // Different uncataloged labels get different colors.
    expect(labelColorFor(defs, 'Spam')).not.toBe(labelColorFor(defs, 'Receipts'));
  });
});

describe('mergeLabelsIntoCatalog', () => {
  test('appends new labels with a hash color', () => {
    const merged = mergeLabelsIntoCatalog(
      [{ name: 'Work', color: '#ff0000' }],
      ['Work', '  Spam  ']
    );
    expect(merged).toEqual([
      { name: 'Work', color: '#ff0000' },
      { name: 'Spam', color: hashLabelColor('Spam') },
    ]);
  });

  test('does not duplicate existing names (case-insensitive)', () => {
    const merged = mergeLabelsIntoCatalog([{ name: 'Work', color: '#ff0000' }], ['work']);
    expect(merged).toEqual([{ name: 'Work', color: '#ff0000' }]);
    expect(merged).toHaveLength(1);
  });
});

describe('catalog storage round-trip', () => {
  test('writes and reads typed definitions', async () => {
    await setEmailLabelCatalog([
      { name: 'Work', color: '#ff0000' },
      { name: 'Personal', color: '#00ff00' },
    ]);
    expect(store.emailLabelCatalog).toEqual([
      { name: 'Work', color: '#ff0000' },
      { name: 'Personal', color: '#00ff00' },
    ]);
    expect(await getEmailLabelCatalog()).toEqual([
      { name: 'Work', color: '#ff0000' },
      { name: 'Personal', color: '#00ff00' },
    ]);
  });

  test('drops entries missing name or color', async () => {
    store.emailLabelCatalog = [
      { name: 'Work', color: '#ff0000' },
      { name: '' },
      { color: '#00ff00' },
      'garbage',
      42,
      null,
    ];
    expect(await getEmailLabelCatalog()).toEqual([{ name: 'Work', color: '#ff0000' }]);
  });

  test('returns [] when storage is missing or malformed', async () => {
    expect(await getEmailLabelCatalog()).toEqual([]);
    store.emailLabelCatalog = 'nope';
    expect(await getEmailLabelCatalog()).toEqual([]);
    store.emailLabelCatalog = 42;
    expect(await getEmailLabelCatalog()).toEqual([]);
  });
});
