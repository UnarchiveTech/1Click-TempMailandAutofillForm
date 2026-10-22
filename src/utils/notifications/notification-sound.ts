/**
 * Notification sound - shared by the background service worker (new-email
 * alerts, OTP copy alerts, per-site auto-copy confirmations) and demo mode.
 *
 * Chrome MV3 service workers have no AudioContext, so the beep is delegated
 * to an offscreen audio document (chrome.offscreen, AUDIO_PLAYBACK reason) -
 * the only way real audio reaches the speakers from a service worker, and
 * the common delivery path here. Firefox event pages run in a real document,
 * so the direct Web Audio path still works there and is used as the fallback.
 * When neither is available the OS notification chime (notifications created
 * with `silent: false` when soundEnabled) remains the audible cue.
 */

import { browser } from 'wxt/browser';
import { CONSTANTS } from '@/utils/constants.js';
import { log } from '@/utils/logger.js';
import type { NotificationSettings } from '@/utils/types.js';

/**
 * Minimal shape of chrome.offscreen so we can feature-detect without pulling
 * in DOM types in the service worker.
 */
interface OffscreenApi {
  createDocument?: (opts: {
    url: string;
    reasons: string[];
    justification: string;
  }) => Promise<void>;
  hasDocument?: () => Promise<boolean>;
}

/**
 * Play the notification sound when the user has sound enabled. `soundEnabled`
 * is opt-out (defaults to true), so a failed settings read still beeps rather
 * than silently dropping the cue. Never throws.
 */
export async function playNotificationSoundIfEnabled(): Promise<void> {
  try {
    const { notificationSettings } = (await browser.storage.local.get([
      'notificationSettings',
    ])) as { notificationSettings?: NotificationSettings };
    if (!(notificationSettings?.soundEnabled ?? true)) return;
  } catch {
    /* failed settings read - default to playing */
  }
  await playNotificationSound();
}

/**
 * Play the notification sound unconditionally: offscreen audio document on
 * Chrome, direct Web Audio fallback where a DOM exists. Never throws.
 */
export function playNotificationSound(): Promise<void> {
  return (async () => {
    try {
      const offscreen = (browser as typeof browser & { offscreen?: OffscreenApi }).offscreen;
      if (offscreen?.createDocument) {
        const exists = offscreen.hasDocument
          ? await offscreen.hasDocument().catch(() => false)
          : false;
        if (!exists) {
          const runtime = browser.runtime as unknown as {
            getURL?: (path: string) => string;
          };
          const offscreenUrl =
            typeof runtime.getURL === 'function'
              ? runtime.getURL('offscreen.html')
              : 'offscreen.html';
          await offscreen.createDocument({
            url: offscreenUrl,
            reasons: ['AUDIO_PLAYBACK'],
            justification: 'Play the sound configured for notification alerts',
          });
        }
        await browser.runtime.sendMessage({ type: 'playNotificationSound' });
        return;
      }
    } catch (e) {
      // Offscreen API unavailable/failed (Firefox, older Chrome) - fall
      // through to the direct AudioContext path (works on event pages).
      if (CONSTANTS.DEBUG) log('Offscreen notification sound failed:', e);
    }
    playBeepDirect();
  })();
}

/** Play the beep in THIS context directly (only possible where a DOM exists). */
function playBeepDirect() {
  try {
    // We only initialize an audio context in a DOM environment (popup/sidepanel/
    // Firefox event page). Chrome service workers never reach this branch.
    if (
      typeof AudioContext === 'undefined' &&
      typeof (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ===
        'undefined'
    )
      return;
    const AudioContextClass =
      typeof AudioContext !== 'undefined'
        ? AudioContext
        : (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    const audioContext = new AudioContextClass();

    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = 800; // Hz
    oscillator.type = 'sine';
    gainNode.gain.value = 0.1; // Volume

    const cleanup = () => {
      try {
        if (audioContext.state !== 'closed') {
          void audioContext.close();
        }
      } catch {
        /* ignore cleanup errors */
      }
    };

    oscillator.onended = cleanup;
    setTimeout(cleanup, 500);

    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.2); // 200ms beep
  } catch (e) {
    if (CONSTANTS.DEBUG) log('Failed to play notification sound:', e);
  }
}
