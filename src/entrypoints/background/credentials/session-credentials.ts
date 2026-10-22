/**
 * Session credential management for form autofill
 * Handles credential storage, formatting, and clipboard operations
 */

import { browser } from 'wxt/browser';
import { copyToClipboardFromBackground } from '@/utils/clipboard/clipboard.js';
import { ValidationError } from '@/utils/errors.js';
import { tSync } from '@/utils/i18n/i18n-background.js';
import { logError } from '@/utils/logger.js';
import { withLock } from '@/utils/mutex.js';
import { isRecord } from '@/utils/storage/storage-keys.js';
import type { SessionCredentials } from '@/utils/types.js';

export interface UpdateCredentialsMessage {
  type: 'updateSessionCredentials';
  credentials: Partial<SessionCredentials>;
}

export interface MessageSender {
  tab?: { id?: number };
}

export async function handleUpdateSessionCredentials(
  message: UpdateCredentialsMessage,
  sender: MessageSender
): Promise<{ success: boolean; clipboardWritten?: boolean }> {
  const tabId = sender.tab?.id;
  if (tabId === undefined) {
    throw new ValidationError('Credentials can only be updated from a valid browser tab', {
      tabId,
    });
  }

  return withLock('session_credentials_lock', async () => {
    const sessionResult = await browser.storage.session.get('sessionCredentials');
    const sessionCredentials: SessionCredentials = isRecord(sessionResult.sessionCredentials)
      ? sessionResult.sessionCredentials
      : {};
    const autoCopyResult = await browser.storage.local.get('autoCopy');
    const autoCopy = typeof autoCopyResult.autoCopy === 'boolean' ? autoCopyResult.autoCopy : false;

    const updatedCredentials = { ...sessionCredentials, ...message.credentials };
    await browser.storage.session.set({ sessionCredentials: updatedCredentials });

    let clipboardWritten: boolean | undefined;
    if (autoCopy) {
      const clipboardText = buildCredentialsString(updatedCredentials);
      clipboardWritten = await writeToClipboard(clipboardText);
    }

    return { success: true, ...(clipboardWritten !== undefined && { clipboardWritten }) };
  });
}

export function buildCredentialsString(credentials: SessionCredentials): string {
  const fieldOrder = ['website', 'email', 'username', 'password', 'name', 'phone'] as const;
  // The clipboard block is user-visible text, so labels come from the active
  // locale (reusing the saved-login / identity field labels) instead of
  // hardcoded English. This module is background-bundle code, hence the
  // minimal i18n-background module.
  const fieldLabels: Record<(typeof fieldOrder)[number], string> = {
    website: tSync('savedLoginInfo.website'),
    email: tSync('savedLoginInfo.email'),
    username: tSync('identities.username'),
    password: tSync('savedLoginInfo.password'),
    name: tSync('savedLoginInfo.name'),
    phone: tSync('savedLoginInfo.phone'),
  };

  return fieldOrder
    .map((key) => {
      const value = credentials[key];
      return value ? `${fieldLabels[key]}: ${value}` : null;
    })
    .filter(Boolean)
    .join('\n');
}

export async function writeToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    // Delegate to centralized clipboard helper which uses verify-before-wipe
    // + hash-tracked background purge queue (retry/backoff), not a blind
    // setTimeout writeText(''). See src/utils/clipboard/clipboard.ts.
    return await copyToClipboardFromBackground(text);
  } catch (error: unknown) {
    logError(
      'Failed to copy credentials to clipboard:',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
    return false;
  }
}
