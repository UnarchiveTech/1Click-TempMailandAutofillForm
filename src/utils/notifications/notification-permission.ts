import { browser as wxtBrowser } from 'wxt/browser';
import { logError, logWarn } from '@/utils/logger.js';

/**
 * Resolve the browser API at CALL time. Two test-land hazards force this:
 * the `wxt/browser` export snapshots `globalThis.browser` at module
 * evaluation, which unit tests install only later - and sibling tests leak
 * PARTIAL browser globals (e.g. storage-only) that would defeat a whole-object
 * preference. So resolve PER SURFACE: prefer the module export when it
 * actually exposes the requested namespace (tests replace it via
 * `mock.module('wxt/browser')`), otherwise the live global. Same hazard as
 * `getBrowser()` in `utils/clipboard/clipboard.ts`.
 */
function getApi<K extends 'notifications' | 'permissions' | 'tabs'>(surface: K): typeof wxtBrowser {
  const fromModule = wxtBrowser[surface];
  if (fromModule && typeof fromModule === 'object') return wxtBrowser;
  const live = (globalThis as { browser?: typeof wxtBrowser }).browser;
  const fromLive = live?.[surface];
  return fromLive && typeof fromLive === 'object' ? live : wxtBrowser;
}

export type NotificationPermissionStatus = 'granted' | 'denied' | 'unknown';

/**
 * Best-effort, cross-browser check of whether the extension's notifications
 * permission is actually usable.
 *
 * `browser.notifications.getPermissionLevel()` reflects browser/OS-level
 * blocking (e.g. the user turned notifications off for this extension in the
 * browser's site settings), which `browser.permissions.contains()` alone can't
 * see. Falls back to the DOM `Notification.permission` and finally to the
 * manifest permission when the native API is unavailable (Safari, etc.).
 */
export async function getNotificationPermissionStatus(): Promise<NotificationPermissionStatus> {
  // 1) Native API - Chrome + Firefox.
  const notifications = getApi('notifications').notifications as typeof wxtBrowser.notifications & {
    getPermissionLevel?: () => Promise<string>;
  };
  if (typeof notifications.getPermissionLevel === 'function') {
    try {
      const level = await notifications.getPermissionLevel();
      if (level === 'denied') return 'denied';
      if (level === 'granted') return 'granted';
      // 'unspecified' (Firefox) → continue to the finer-grained checks below.
    } catch {
      /* fall through to fallbacks */
    }
  }
  // 2) DOM Notification API (extension pages / service worker contexts).
  try {
    const domPermission = typeof Notification !== 'undefined' ? Notification.permission : undefined;
    if (domPermission === 'denied') return 'denied';
    if (domPermission === 'granted') return 'granted';
  } catch {
    /* ignore */
  }
  // 3) Last resort: is the manifest permission itself still granted?
  try {
    const has = await getApi('permissions').permissions.contains({
      permissions: ['notifications'],
    });
    return has ? 'granted' : 'denied';
  } catch {
    return 'unknown';
  }
}

/**
 * Fire-and-forget notification creation that never rejects - and never throws.
 * When the browser or OS blocks notifications (permission denied at the
 * browser/OS level, quota, display failure), `notifications.create` rejects -
 * swallow and log instead of leaking an unhandled promise rejection into the
 * service worker. When the `notifications` namespace is missing entirely
 * (permission not granted, Firefox variants, or a captured/legacy API surface),
 * `notifications.create` would throw SYNCHRONOUSLY - the guard below turns that
 * into a logged no-op, because callers fire-and-forget from alarm/queue paths
 * whose storage writes must not be unwound by a notification failure.
 * Returns nothing; callers that need to surface failure to the UI (e.g. the
 * settings test-notification button) should await `browser.notifications.create`
 * directly inside their own try/catch instead.
 */
export function createBrowserNotification(
  notificationId: string | undefined,
  options: Parameters<typeof browser.notifications.create>[0]
): void {
  try {
    const notifications = getApi('notifications').notifications as
      | typeof wxtBrowser.notifications
      | undefined;
    if (typeof notifications?.create !== 'function') {
      logWarn('Notifications API unavailable; skipping notification', {
        notificationId,
        title: options.title,
      });
      return;
    }
    const result =
      notificationId === undefined
        ? notifications.create(options)
        : notifications.create(notificationId, options);
    result.catch((error) => {
      logError(
        'Failed to create notification',
        { notificationId, title: options.title },
        error instanceof Error ? error : new Error(String(error))
      );
    });
  } catch (error) {
    logError(
      'Failed to create notification',
      { notificationId, title: options.title },
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

/**
 * Best-effort "open site settings" for the extension's notifications.
 * Chrome-family → chrome://settings/content/notifications (one of the
 * chrome:// pages Chrome lets extensions open); Firefox → about:preferences#privacy.
 * Returns false when the browser blocks the navigation so callers can surface
 * manual instructions instead.
 */
export async function openNotificationSettingsPage(): Promise<boolean> {
  const isFirefox = typeof navigator !== 'undefined' && /Firefox\//i.test(navigator.userAgent);
  const url = isFirefox ? 'about:preferences#privacy' : 'chrome://settings/content/notifications';
  try {
    await getApi('tabs').tabs.create({ url, active: true });
    return true;
  } catch (error) {
    logError(
      'Could not open browser notification settings',
      { url },
      error instanceof Error ? error : new Error(String(error))
    );
    return false;
  }
}
