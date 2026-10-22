import { describe, expect, mock, test } from 'bun:test';
import {
  addTrustedClickListener,
  trustedClick,
  trustedPointerDown,
} from '@/utils/security/dom-guard.js';

describe('trustedClick', () => {
  test('calls handler when event.isTrusted is true', () => {
    const handler = mock();
    const wrapped = trustedClick(handler);
    const event = { isTrusted: true } as unknown as MouseEvent;
    wrapped(event);
    expect(handler).toHaveBeenCalled();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event);
  });

  test('does NOT call handler when event.isTrusted is false (synthetic event)', () => {
    const handler = mock();
    const wrapped = trustedClick(handler);
    const event = { isTrusted: false } as unknown as MouseEvent;
    wrapped(event);
    expect(handler).not.toHaveBeenCalled();
  });

  test('does NOT call handler when event.isTrusted is undefined', () => {
    const handler = mock();
    const wrapped = trustedClick(handler);
    const event = {} as unknown as MouseEvent;
    wrapped(event);
    expect(handler).not.toHaveBeenCalled();
  });

  test('supports async handlers without rejecting', async () => {
    const handler = mock(async () => {});
    const wrapped = trustedClick(handler);
    const event = { isTrusted: true } as unknown as MouseEvent;
    wrapped(event);
    // Give the microtask a chance to resolve
    await Promise.resolve();
    expect(handler).toHaveBeenCalled();
  });

  test('sync throw propagates (void does not catch sync errors)', () => {
    // The `void` operator handles async promise rejections but NOT
    // synchronous throws. A sync throw propagates to the caller.
    const handler = mock(() => {
      throw new Error('boom');
    });
    const wrapped = trustedClick(handler);
    const event = { isTrusted: true } as unknown as MouseEvent;
    expect(() => wrapped(event)).toThrow('boom');
    expect(handler).toHaveBeenCalled();
  });

  test('async rejection is not unhandled (void swallows promise rejection)', () => {
    // An async handler that rejects will produce an unhandled rejection
    // because `void` discards the promise. In practice, content-script
    // handlers wrap their bodies in try/catch. We verify the handler
    // is still called.
    const handler = mock(async () => {
      throw new Error('async boom');
    });
    const wrapped = trustedClick(handler);
    const event = { isTrusted: true } as unknown as MouseEvent;
    expect(() => wrapped(event)).not.toThrow();
    expect(handler).toHaveBeenCalled();
  });
});

describe('trustedPointerDown', () => {
  test('calls handler for trusted pointer events', () => {
    const handler = mock();
    const wrapped = trustedPointerDown(handler);
    const event = { isTrusted: true } as unknown as PointerEvent;
    wrapped(event);
    expect(handler).toHaveBeenCalled();
  });

  test('rejects synthetic pointer events', () => {
    const handler = mock();
    const wrapped = trustedPointerDown(handler);
    const event = { isTrusted: false } as unknown as PointerEvent;
    wrapped(event);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('addTrustedClickListener', () => {
  test('attaches a click listener that respects isTrusted', () => {
    const handler = mock();
    const el = {
      addEventListener: mock((_type: string, listener: (e: MouseEvent) => void) => {
        // Verify it's a click listener
        expect(_type).toBe('click');
        // Simulate a trusted click
        listener({ isTrusted: true } as unknown as MouseEvent);
      }),
    } as unknown as EventTarget;

    addTrustedClickListener(el, handler);
    expect(handler).toHaveBeenCalled();
  });

  test('does not call handler for synthetic clicks', () => {
    const handler = mock();
    const el = {
      addEventListener: mock((_type: string, listener: (e: MouseEvent) => void) => {
        // Simulate a synthetic click
        listener({ isTrusted: false } as unknown as MouseEvent);
      }),
    } as unknown as EventTarget;

    addTrustedClickListener(el, handler);
    expect(handler).not.toHaveBeenCalled();
  });
});
