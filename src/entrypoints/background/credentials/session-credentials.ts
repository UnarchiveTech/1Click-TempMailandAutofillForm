/**
 * Session credential management for form autofill
 * Handles credential storage, formatting, and clipboard operations
 */

import { browser } from 'wxt/browser';
import { ValidationError } from '@/utils/errors.js';
import { logError } from '@/utils/logger.js';
import { isRecord } from '@/utils/storage-keys.js';
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
  if (!sender.tab?.id) {
    throw new ValidationError('Credentials can only be updated from a valid browser tab', {
      tabId: sender.tab?.id,
    });
  }

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
    clipboardWritten = await writeToClipboard(sender.tab.id, clipboardText);
  }

  return { success: true, ...(clipboardWritten !== undefined && { clipboardWritten }) };
}

export function buildCredentialsString(credentials: SessionCredentials): string {
  const fieldOrder: (keyof SessionCredentials)[] = [
    'website',
    'email',
    'username',
    'password',
    'name',
    'phone',
  ];
  const fieldLabels: Record<keyof SessionCredentials, string> = {
    website: 'Website',
    email: 'Email',
    username: 'Username',
    password: 'Password',
    name: 'Name',
    phone: 'Phone',
  };

  return fieldOrder
    .map((key) => {
      const value = credentials[key];
      return value ? `${fieldLabels[key]}: ${value}` : null;
    })
    .filter(Boolean)
    .join('\n');
}

export async function writeToClipboard(tabId: number, text: string): Promise<boolean> {
  if (!text) return false;
  try {
    await browser.scripting.executeScript({
      target: { tabId },
      func: (textToCopy: string, durationMs: number) => {
        navigator.clipboard.writeText(textToCopy);
        setTimeout(async () => {
          try {
            await navigator.clipboard.writeText('');
          } catch {
            // Ignore failures (e.g. document not focused)
          }
        }, durationMs);
      },
      args: [text, 30000],
    });
    return true;
  } catch (error: unknown) {
    logError(
      'Failed to copy credentials to clipboard:',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
    return false;
  }
}
