import { describe, expect, test } from 'bun:test';
import type { RuntimeMessage } from '@/entrypoints/background/runtime/message-handler';
import {
  handlers,
  requireNumber,
  requireString,
  resolveHandlerKey,
} from '@/entrypoints/background/runtime/message-handler';

describe('worker field-label handler', () => {
  test('returns the real local classification through the registered handler', async () => {
    let response: unknown;
    await handlers.matchKindFromText?.(
      { type: 'matchKindFromText', text: 'Given name' },
      { id: 'test-extension' },
      (value: unknown) => {
        response = value;
      }
    );
    expect(response).toEqual({ success: true, result: { kind: 'firstName', confidence: 0.9 } });
  });
});

// ── requireString ────────────────────────────────────────────────────────────

describe('requireString', () => {
  test('returns the value when it is a non-empty string', () => {
    const msg: RuntimeMessage = { type: 'createAddress', provider: 'guerrilla' };
    expect(requireString(msg, 'provider')).toBe('guerrilla');
  });

  test('throws when the field is missing', () => {
    const msg: RuntimeMessage = { type: 'createAddress' };
    expect(() => requireString(msg, 'provider')).toThrow('provider');
  });

  test('throws when the field is an empty string', () => {
    const msg: RuntimeMessage = { type: 'createAddress', provider: '' };
    expect(() => requireString(msg, 'provider')).toThrow('provider');
  });

  test('throws when the field is not a string', () => {
    const msg = { type: 'createAddress', provider: 123 } as unknown as RuntimeMessage;
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
    // Deliberately malformed payload - the union requires intervalMs, but the
    // browser boundary can deliver anything; requireNumber is the runtime gate.
    const msg = { type: 'updateRefreshInterval' } as unknown as RuntimeMessage;
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
  test('resolves findSiteReplay action handler', () => {
    // Minimal payload (no required fields) - resolveHandlerKey only reads the
    // discriminant, so a structurally-invalid message must still resolve.
    const msg = { action: 'findSiteReplay' } as unknown as RuntimeMessage;
    expect(resolveHandlerKey(msg)).toBe('findSiteReplay');
  });

  test('resolves a known type-based handler', () => {
    const msg: RuntimeMessage = { type: 'createAddress' };
    expect(resolveHandlerKey(msg)).toBe('createAddress');
  });

  test('resolves createAddressWithGesture type-based handler', () => {
    const msg: RuntimeMessage = { type: 'createAddressWithGesture' };
    expect(resolveHandlerKey(msg)).toBe('createAddressWithGesture');
  });

  test('resolves a known action-based handler (direct)', () => {
    const msg: RuntimeMessage = { action: 'hardReset' };
    expect(resolveHandlerKey(msg)).toBe('hardReset');
  });

  test('returns undefined for an unknown type', () => {
    const msg = { type: 'nonExistentHandler' } as unknown as RuntimeMessage;
    expect(resolveHandlerKey(msg)).toBeUndefined();
  });

  test('returns undefined for an unknown action', () => {
    const msg = { action: 'nonExistentAction' } as unknown as RuntimeMessage;
    expect(resolveHandlerKey(msg)).toBeUndefined();
  });

  test('rejects inherited object names as type and action handlers', () => {
    for (const name of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      expect(resolveHandlerKey({ type: name })).toBeUndefined();
      expect(resolveHandlerKey({ action: name })).toBeUndefined();
    }
  });

  test('falls back from an inherited type name to a real action', () => {
    expect(resolveHandlerKey({ type: 'toString', action: 'hardReset' })).toBe('hardReset');
  });

  test('returns undefined when neither type nor action is set', () => {
    const msg = {} as unknown as RuntimeMessage;
    expect(resolveHandlerKey(msg)).toBeUndefined();
  });

  test('prefers type over action when both are set and type is known', () => {
    const msg = { type: 'createAddress', action: 'hardReset' } as unknown as RuntimeMessage;
    expect(resolveHandlerKey(msg)).toBe('createAddress');
  });

  test('falls back to action when type is unknown but action is known', () => {
    const msg = { type: 'unknownType', action: 'hardReset' } as unknown as RuntimeMessage;
    expect(resolveHandlerKey(msg)).toBe('hardReset');
  });
});

// ── legacy aliased action strings (alias map removed) ───────────────────────

// These action strings were previously translated to a canonical handler via the
// `aliases` map (e.g. `setInstance` → `setSelectedInstance`). The map is gone, so
// any stale sender still using them must fail closed (resolve to undefined).

describe('legacy alias actions are no longer resolvable', () => {
  test('setInstance resolves to undefined', () => {
    const msg = { action: 'setInstance' } as unknown as RuntimeMessage;
    expect(resolveHandlerKey(msg)).toBeUndefined();
  });

  test('removeCustomProviderInstance resolves to undefined', () => {
    const msg = { action: 'removeCustomProviderInstance' } as unknown as RuntimeMessage;
    expect(resolveHandlerKey(msg)).toBeUndefined();
  });

  test('getSelectedProviderInstance resolves to undefined', () => {
    const msg = { action: 'getSelectedProviderInstance' } as unknown as RuntimeMessage;
    expect(resolveHandlerKey(msg)).toBeUndefined();
  });

  test('setSelectedProviderInstance resolves to undefined', () => {
    const msg = { action: 'setSelectedProviderInstance' } as unknown as RuntimeMessage;
    expect(resolveHandlerKey(msg)).toBeUndefined();
  });
});
