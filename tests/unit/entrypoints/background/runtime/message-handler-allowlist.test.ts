import { describe, expect, test } from 'bun:test';
import {
  CONTENT_SCRIPT_ALLOWED_HANDLERS,
  HANDLER_KEYS,
  type RuntimeMessage,
  resolveHandlerKey,
} from '@/entrypoints/background/runtime/message-handler';

describe('CONTENT_SCRIPT_ALLOWED_HANDLERS', () => {
  test('every allowlisted handler resolves to a real handler key', () => {
    for (const key of CONTENT_SCRIPT_ALLOWED_HANDLERS) {
      const byType = resolveHandlerKey({ type: key } as RuntimeMessage);
      const byAction = resolveHandlerKey({ action: key } as RuntimeMessage);
      expect(byType ?? byAction).toBe(key);
    }
  });

  test('destructive extension-only handlers are not allowlisted', () => {
    const blocked = [
      'deleteAddress',
      'deleteAddresses',
      'archiveAddresses',
      'unarchiveAddresses',
      'renewAddresses',
      'checkEmails',
      'checkEmailsBulk',
      'hardReset',
      'resetAnalytics',
      'clearAllOtps',
      'createAddress',
    ];
    for (const key of blocked) {
      expect(CONTENT_SCRIPT_ALLOWED_HANDLERS.has(key)).toBe(false);
    }
  });

  test('createAddressWithGesture is allowlisted for content scripts', () => {
    expect(CONTENT_SCRIPT_ALLOWED_HANDLERS.has('createAddressWithGesture')).toBe(true);
  });

  test('HANDLER_KEYS includes every registered handler', () => {
    for (const key of HANDLER_KEYS) {
      expect(resolveHandlerKey({ type: key } as RuntimeMessage)).toBe(key);
    }
  });
});
