import { loadClipboardPrivacy, purgeDurationMs } from './clipboard-settings.js';
import { logError, logInfo } from './logger.js';

let purgeTimeoutId: ReturnType<typeof setTimeout> | null = null;

/**
 * Copy text to the clipboard and optionally schedule auto-clear
 * (duration from clipboard privacy settings, or explicit override).
 *
 * Pass durationMs = 0 to skip purge. Omit to use user settings.
 */
export async function copyToClipboardAndSchedulePurge(
  text: string,
  durationMs?: number
): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
    } else {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
    }

    let ms = durationMs;
    if (ms === undefined) {
      try {
        const settings = await loadClipboardPrivacy();
        ms = purgeDurationMs(settings);
      } catch {
        ms = 30000;
      }
    }

    if (purgeTimeoutId) {
      clearTimeout(purgeTimeoutId);
      purgeTimeoutId = null;
    }

    if (ms && ms > 0) {
      logInfo(`Copied to clipboard. Scheduled auto-purge in ${ms / 1000}s.`);
      purgeTimeoutId = setTimeout(async () => {
        purgeTimeoutId = null;
        try {
          if (typeof navigator !== 'undefined' && navigator.clipboard) {
            await navigator.clipboard.writeText('');
            logInfo('Auto-cleared sensitive data from clipboard.');
          }
        } catch (err) {
          logError('Failed to auto-clear clipboard', err);
        }
      }, ms);
    } else {
      logInfo('Copied to clipboard (auto-purge disabled).');
    }

    return true;
  } catch (error) {
    logError('Failed to copy to clipboard', error);
    return false;
  }
}
