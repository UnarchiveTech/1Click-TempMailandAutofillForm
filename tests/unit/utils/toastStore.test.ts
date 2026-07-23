// biome-ignore-all lint/suspicious/noExplicitAny: test typings
import { describe, expect, mock, test } from 'bun:test';
import { toastStore } from '@/utils/toastStore.js';

describe('toastStore', () => {
  test('adds and removes toasts correctly', () => {
    toastStore.clear();

    const listener = mock(() => {});
    const unsubscribe = toastStore.subscribe(listener);

    // Initial state notification
    expect(listener).toHaveBeenCalledTimes(1);

    const toastId = toastStore.success('Operation Successful', 5000);
    expect(listener).toHaveBeenCalledTimes(2);

    // Verify it was added
    expect(toastId).toBeDefined();

    toastStore.remove(toastId);
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribe();
  });

  test('different toast types (success, error, warning, info) call add method', () => {
    toastStore.clear();

    let currentToasts: any[] = [];
    const unsubscribe = toastStore.subscribe((toasts) => {
      currentToasts = toasts;
    });

    toastStore.success('Success message');
    toastStore.error('Error message');
    toastStore.warning('Warning message');
    // Cap is 3 - fourth toast drops the oldest
    toastStore.info('Info message');

    expect(currentToasts.length).toBe(3);
    expect(currentToasts[0].type).toBe('error');
    expect(currentToasts[1].type).toBe('warning');
    expect(currentToasts[2].type).toBe('info');
    expect(currentToasts.map((t) => t.message)).toEqual([
      'Error message',
      'Warning message',
      'Info message',
    ]);

    unsubscribe();
  });

  test('caps the maximum number of toasts at 3', () => {
    toastStore.clear();

    let currentToasts: any[] = [];
    const unsubscribe = toastStore.subscribe((toasts) => {
      currentToasts = toasts;
    });

    for (let i = 0; i < 10; i++) {
      toastStore.success(`Message ${i}`);
    }

    expect(currentToasts.length).toBe(3);
    // Oldest dropped; remaining are the last three unique messages
    expect(currentToasts[0].message).toBe('Message 7');
    expect(currentToasts[1].message).toBe('Message 8');
    expect(currentToasts[2].message).toBe('Message 9');

    unsubscribe();
  });

  test('dedupes identical messages within the dedupe window', () => {
    toastStore.clear();

    let currentToasts: any[] = [];
    const unsubscribe = toastStore.subscribe((toasts) => {
      currentToasts = toasts;
    });

    toastStore.success('Copied');
    toastStore.success('Copied');
    toastStore.success('Copied');

    // One live toast, refreshed - not a stack of three
    expect(currentToasts.length).toBe(1);
    expect(currentToasts[0].message).toBe('Copied');

    unsubscribe();
  });
});
