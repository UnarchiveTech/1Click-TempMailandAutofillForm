import { describe, expect, test } from 'bun:test';
import type { RuntimeMessage } from '@/entrypoints/background/runtime/message-handler';
import {
  aliases,
  requireNumber,
  requireString,
  resolveHandlerKey,
} from '@/entrypoints/background/runtime/message-handler';

// ── requireString ────────────────────────────────────────────────────────────

describe('requireString', () => {
  test('returns the value when it is a non-empty string', () => {
    const msg: RuntimeMessage = { type: 'createInbox', provider: 'guerrilla' };
    expect(requireString(msg, 'provider')).toBe('guerrilla');
  });

  test('throws when the field is missing', () => {
    const msg: RuntimeMessage = { type: 'createInbox' };
    expect(() => requireString(msg, 'provider')).toThrow('provider');
  });

  test('throws when the field is an empty string', () => {
    const msg: RuntimeMessage = { type: 'createInbox', provider: '' };
    expect(() => requireString(msg, 'provider')).toThrow('provider');
  });

  test('throws when the field is not a string', () => {
    const msg = { type: 'createInbox', provider: 123 } as unknown as RuntimeMessage;
    expect(() => requireString(msg, 'provider')).toThrow('provider');
  });
});

// ── requireNumber ────────────────────────────────────────────────────────────

describe('requireNumber', () => {
  test('returns the value when it is a finite number', () => {
    const msg = { type: 'updateRefreshInterval', intervalMs: 30000 } as unknown as RuntimeMessage;
    expect(requireNumber(msg, 'intervalMs')).toBe(30000);
  });

  test('throws when the field is missing', () => {
    const msg: RuntimeMessage = { type: 'updateRefreshInterval' };
    expect(() => requireNumber(msg, 'intervalMs')).toThrow('intervalMs');
  });

  test('throws when the field is NaN', () => {
    const msg = { type: 'updateRefreshInterval', intervalMs: NaN } as unknown as RuntimeMessage;
    expect(() => requireNumber(msg, 'intervalMs')).toThrow('intervalMs');
  });

  test('throws when the field is Infinity', () => {
    const msg = {
      type: 'updateRefreshInterval',
      intervalMs: Infinity,
    } as unknown as RuntimeMessage;
    expect(() => requireNumber(msg, 'intervalMs')).toThrow('intervalMs');
  });

  test('throws when the field is not a number', () => {
    const msg = {
      type: 'updateRefreshInterval',
      intervalMs: '30000',
    } as unknown as RuntimeMessage;
    expect(() => requireNumber(msg, 'intervalMs')).toThrow('intervalMs');
  });
});

// ── resolveHandlerKey ────────────────────────────────────────────────────────

describe('resolveHandlerKey', () => {
  test('resolves a known type-based handler', () => {
    const msg: RuntimeMessage = { type: 'createInbox' };
    expect(resolveHandlerKey(msg)).toBe('createInbox');
  });

  test('resolves a known action-based handler (direct)', () => {
    const msg: RuntimeMessage = { action: 'hardReset' };
    expect(resolveHandlerKey(msg)).toBe('hardReset');
  });

  test('resolves a known action-based handler (alias)', () => {
    const msg: RuntimeMessage = { action: 'removeCustomProviderInstance' };
    expect(resolveHandlerKey(msg)).toBe('removeCustomInstance');
  });

  test('resolves addCustomProviderInstance alias to addCustomInstance', () => {
    const msg: RuntimeMessage = { action: 'addCustomProviderInstance' };
    expect(resolveHandlerKey(msg)).toBe('addCustomInstance');
  });

  test('resolves getSelectedProviderInstance alias to getSelectedInstance', () => {
    const msg: RuntimeMessage = { action: 'getSelectedProviderInstance' };
    expect(resolveHandlerKey(msg)).toBe('getSelectedInstance');
  });

  test('resolves setSelectedProviderInstance alias to setSelectedInstance', () => {
    const msg: RuntimeMessage = { action: 'setSelectedProviderInstance' };
    expect(resolveHandlerKey(msg)).toBe('setSelectedInstance');
  });

  test('resolves setInstance alias to setSelectedInstance', () => {
    const msg: RuntimeMessage = { action: 'setInstance' };
    expect(resolveHandlerKey(msg)).toBe('setSelectedInstance');
  });

  test('returns undefined for an unknown type', () => {
    const msg = { type: 'nonExistentHandler' } as unknown as RuntimeMessage;
    expect(resolveHandlerKey(msg)).toBeUndefined();
  });

  test('returns undefined for an unknown action', () => {
    const msg = { action: 'nonExistentAction' } as unknown as RuntimeMessage;
    expect(resolveHandlerKey(msg)).toBeUndefined();
  });

  test('returns undefined when neither type nor action is set', () => {
    const msg = {} as unknown as RuntimeMessage;
    expect(resolveHandlerKey(msg)).toBeUndefined();
  });

  test('prefers type over action when both are set and type is known', () => {
    const msg = { type: 'createInbox', action: 'hardReset' } as unknown as RuntimeMessage;
    expect(resolveHandlerKey(msg)).toBe('createInbox');
  });

  test('falls back to action when type is unknown but action is known', () => {
    const msg = { type: 'unknownType', action: 'hardReset' } as unknown as RuntimeMessage;
    expect(resolveHandlerKey(msg)).toBe('hardReset');
  });

  test('falls back to aliased action when type is unknown', () => {
    const msg = { type: 'unknownType', action: 'setInstance' } as unknown as RuntimeMessage;
    expect(resolveHandlerKey(msg)).toBe('setSelectedInstance');
  });
});

// ── aliases map integrity ────────────────────────────────────────────────────

describe('aliases', () => {
  test('every alias target is a real handler key', () => {
    for (const [aliasAction, targetHandler] of Object.entries(aliases)) {
      const msg = { action: aliasAction } as unknown as RuntimeMessage;
      const resolved = resolveHandlerKey(msg);
      expect(resolved).toBe(targetHandler);
      expect(resolved).toBeDefined();
    }
  });

  test('aliases is non-empty', () => {
    expect(Object.keys(aliases).length).toBeGreaterThan(0);
  });
});
